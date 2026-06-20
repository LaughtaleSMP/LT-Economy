/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_chat.js — Live Chat bridge (Game ↔ Website)
   v2: Per-player rate limiting, verify code, auto-cleanup.

   SLO: chat relay latency ≤ 10s p95, web poll ≤ 5s.
   PERF: 0 DP writes, minimal allocations, TPS-gated.

   Architecture:
   - Game chat → buffer → batch INSERT every 5s
   - Web chat → polled every 5s → world.sendMessage()
   - Verify: 6-digit code → PATCH chat_verify → player feedback
   - Cleanup: messages > 24h + verify > 24h, every 30 min
   ══════════════════════════════════════════════════════════════ */

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { ModalFormData } from "@minecraft/server-ui";
import { SUPABASE_URL, SUPABASE_KEY } from "./sync_http.js";
import { getTPS } from "../MobuXP/monitor/tps_tracker.js";

// Chat uses its own HTTP calls — independent of OFFLINE_MODE & circuit breaker
// so live chat always works even when other sync modules are disabled.
async function _chatHttp(req) {
  try {
    return await http.request(req);
  } catch (e) {
    console.warn("[Chat] HTTP error:", e);
    return { status: 0, body: "" };
  }
}

const CHAT_EP   = `${SUPABASE_URL}/rest/v1/chat_messages`;
const VERIFY_EP = `${SUPABASE_URL}/rest/v1/chat_verify`;

// ── Config (coding-standards §1.2: named constants) ──
const CHAT_FLUSH_TICKS  = 100;    // 5s
const WEB_POLL_TICKS    = 100;    // 5s
const CLEANUP_TICKS     = 36_000; // 30 min
const MAX_BUFFER         = 20;
const MSG_MAX_AGE_MS     = 24 * 60 * 60 * 1000; // 24h
const VERIFY_MAX_AGE_MS  = 24 * 60 * 60 * 1000; // 24h
const PLAYER_VERIFY_COOLDOWN_MS = 30_000; // 30s per-player cooldown

// ── Buffers & State (coding-standards §1.3: capped) ──
const _chatBuffer = [];
let _lastWebPollId = 0;
let _flushing = false;
let _polling  = false;

// Per-player verify cooldown (coding-standards §1.3: Map with cleanup)
const _verifyCooldown = new Map(); // playerName → lastAttemptMs
const COOLDOWN_MAP_MAX = 50;

// ── Blocklist ──
const BLOCKED_PREFIXES = ["/", "!", ".", "-"];

// ── Sanitize (coding-standards §3.3) ──
function _sanitize(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/[§\n\r\t"\\]/g, "").trim().substring(0, max || 200);
}

/**
 * Chat capture via Mimi Inka's scriptevent "chat:message".
 *
 * WHY NOT beforeEvents.chatSend?
 *   Mimi Inka (separate behavior pack) subscribes to beforeEvents.chatSend
 *   and calls event.cancel = true on ALL messages (line 53 of Mimi Inka main.js).
 *   When Bedrock processes beforeEvents, if any subscriber cancels the event
 *   the remaining subscribers may not receive it, or may receive it with
 *   cancel=true before they can read the message.
 *
 *   Mimi Inka ALSO fires a scriptevent "chat:message" with JSON payload
 *   containing { player_name, message } (lines 22-27 of Mimi Inka main.js).
 *   This fires via system.run() AFTER the beforeEvent phase, so it always
 *   triggers regardless of cancel state.
 *
 * This listener captures that scriptevent to reliably buffer chat messages.
 * (coding-standards §3.2: input validation before processing)
 */
system.afterEvents.scriptEventReceive.subscribe(ev => {
  try {
    if (ev.id !== "chat:message") return;

    let data;
    try { data = JSON.parse(ev.message); } catch { return; }

    const name = data?.player_name;
    const msg  = data?.message;
    if (!name || !msg || typeof msg !== "string") return;

    // Skip commands (not chat messages)
    if (BLOCKED_PREFIXES.some(p => msg.startsWith(p))) return;
    if (msg.length > 200) return;

    // Buffer (coding-standards §1.3: capped)
    if (_chatBuffer.length < MAX_BUFFER) {
      _chatBuffer.push({
        source: "game",
        player_name: _sanitize(name, 20),
        message: _sanitize(msg, 200),
      });
    }
  } catch (e) {
    console.warn("[Chat] Buffer error:", e);
  }
});

// ── Player join → system message ──
world.afterEvents.playerSpawn.subscribe(ev => {
  try {
    if (!ev.initialSpawn) return; // only first spawn = login
    const name = ev.player?.name;
    if (!name) return;
    if (_chatBuffer.length < MAX_BUFFER) {
      _chatBuffer.push({
        source: "system",
        player_name: _sanitize(name, 20),
        message: "bergabung ke server",
      });
    }
  } catch {}
});

/**
 * Get Live Chat verified info for a player.
 * Used by welcome.js to embed in the existing greeting banner.
 * Returns { verified: boolean, webCount: number }
 */
export async function getChatVerifiedInfo(playerName) {
  try {
    const safeName = encodeURIComponent(playerName);

    // Check if verified account exists
    const acctReq = new HttpRequest(
      `${SUPABASE_URL}/rest/v1/chat_accounts?gamertag=eq.${safeName}&select=gamertag`
    );
    acctReq.method = HttpRequestMethod.Get;
    acctReq.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    ];
    const acctRes = await _chatHttp(acctReq);
    if (acctRes.status < 200 || acctRes.status >= 300) return { verified: false, webCount: 0 };
    const acctRows = JSON.parse(acctRes.body || "[]");
    if (!acctRows.length) return { verified: false, webCount: 0 };

    // Count web messages in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const countReq = new HttpRequest(
      `${CHAT_EP}?source=eq.web&created_at=gte.${since}&select=id`
    );
    countReq.method = HttpRequestMethod.Get;
    countReq.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    ];
    const countRes = await _chatHttp(countReq);
    let webCount = 0;
    try {
      const countRows = JSON.parse(countRes.body || "[]");
      webCount = countRows.length || 0;
    } catch {}

    return { verified: true, webCount };
  } catch {
    return { verified: false, webCount: 0 };
  }
}

// ── Player leave → system message + cooldown cleanup ──
world.afterEvents.playerLeave.subscribe(ev => {
  try {
    _verifyCooldown.delete(ev.playerName);
    if (_chatBuffer.length < MAX_BUFFER) {
      _chatBuffer.push({
        source: "system",
        player_name: _sanitize(ev.playerName, 20),
        message: "meninggalkan server",
      });
    }
  } catch {}
});

// ── Player death → system message ──
const _DEATH_CAUSE = {
  entityAttack: "dibunuh oleh",
  entityExplosion: "meledak oleh",
  projectile: "ditembak oleh",
  fire: "terbakar",
  fireTick: "terbakar",
  lava: "terjatuh ke lava",
  drowning: "tenggelam",
  fall: "jatuh dari ketinggian",
  void: "jatuh ke void",
  starve: "kelaparan",
  suffocation: "tertimpa blok",
  lightning: "tersambar petir",
  freezing: "membeku",
  magma: "terbakar di magma",
  anvil: "tertimpa anvil",
  flyIntoWall: "menabrak dinding",
  magic: "terkena sihir",
  wither: "terkena efek wither",
  thorns: "terkena thorns",
};

world.afterEvents.entityDie.subscribe(ev => {
  try {
    const dead = ev.deadEntity;
    if (!dead?.typeId || dead.typeId !== "minecraft:player") return;
    const name = dead.name || dead.nameTag;
    if (!name) return;

    const src = ev.damageSource;
    const cause = src?.cause || "unknown";
    const killer = src?.damagingEntity;

    let deathMsg;
    if (killer && killer.typeId === "minecraft:player" && killer.name) {
      deathMsg = `dibunuh oleh ${_sanitize(killer.name, 20)}`;
    } else if (killer && killer.typeId) {
      const mobName = killer.typeId.replace("minecraft:", "");
      deathMsg = `dibunuh oleh ${mobName}`;
    } else {
      deathMsg = _DEATH_CAUSE[cause] || "mati";
    }

    if (_chatBuffer.length < MAX_BUFFER) {
      _chatBuffer.push({
        source: "system",
        player_name: _sanitize(name, 20),
        message: deathMsg,
      });
    }
  } catch {}
});

/**
 * Process verify code: GET matching row → PATCH verified=true
 * (coding-standards §5.3: defensive coding, fallback)
 */
async function _processVerify(playerName, code) {
  try {
    const safeName = encodeURIComponent(playerName);
    const url = `${VERIFY_EP}?code=eq.${code}&player_name=eq.${safeName}&verified=eq.false&order=created_at.desc&limit=1`;

    const getReq = new HttpRequest(url);
    getReq.method = HttpRequestMethod.Get;
    getReq.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    ];

    const getRes = await _chatHttp(getReq);
    if (getRes.status < 200 || getRes.status >= 300) return;

    const rows = JSON.parse(getRes.body || "[]");
    if (!rows.length) {
      _sendPlayerMsg(playerName, "§c[Chat] Kode verifikasi tidak valid atau sudah kadaluarsa.");
      return;
    }

    // PATCH verified=true
    const rowId = rows[0].id;
    const patchReq = new HttpRequest(`${VERIFY_EP}?id=eq.${rowId}`);
    patchReq.method = HttpRequestMethod.Patch;
    patchReq.body = JSON.stringify({ verified: true });
    patchReq.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Content-Type", "application/json"),
      new HttpHeader("Prefer", "return=minimal"),
    ];

    const patchRes = await _chatHttp(patchReq);
    if (patchRes.status >= 200 && patchRes.status < 300) {
      _sendPlayerMsg(playerName, "§a[Chat] Gamertag terverifikasi! Kembali ke website untuk buat PIN.");

    }
  } catch (e) {
    console.warn("[Chat] Verify error:", e);
  }
}

function _sendPlayerMsg(name, msg) {
  try {
    const p = world.getPlayers().find(x => x.name === name);
    if (p) p.sendMessage(msg);
  } catch {}
}

/**
 * Flush buffered game chat to Supabase (batch INSERT).
 * TPS-gated: skip when server is stressed.
 */
export async function flushChatBuffer() {
  if (_flushing) return;
  if (_chatBuffer.length === 0) return;

  // TPS gate (coding-standards §1.2)
  var tps = 20;
  try { tps = getTPS(); if (tps < 15) return; } catch {}

  _flushing = true;
  try {
    const batch = _chatBuffer.splice(0, _chatBuffer.length);
    if (batch.length === 0) return;

    const req = new HttpRequest(CHAT_EP);
    req.method = HttpRequestMethod.Post;
    req.body = JSON.stringify(batch);
    req.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Content-Type", "application/json"),
      new HttpHeader("Prefer", "return=minimal"),
    ];


    const res = await _chatHttp(req);
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[Chat] Flush fail (${res.status})`);
    } else {
      // success — silent
    }
  } catch (e) {
    console.warn("[Chat] Flush error:", e);
  } finally {
    _flushing = false;
  }
}

/**
 * Poll Supabase for web chat → relay to game.
 * TPS-gated, skip if no players online.
 */
export async function pollWebChat() {
  if (_polling) return;

  const players = world.getPlayers();
  if (players.length === 0) return;

  // TPS gate
  try { if (getTPS() < 15) return; } catch {}

  _polling = true;
  try {
    let url = `${CHAT_EP}?source=eq.web&order=id.asc&limit=10`;
    if (_lastWebPollId > 0) {
      url += `&id=gt.${_lastWebPollId}`;
    } else {
      url += `&created_at=gte.${new Date(Date.now() - 30_000).toISOString()}`;
    }

    const req = new HttpRequest(url);
    req.method = HttpRequestMethod.Get;
    req.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    ];

    const res = await _chatHttp(req);
    if (res.status < 200 || res.status >= 300) return;

    const rows = JSON.parse(res.body || "[]");
    if (!rows.length) return;

    for (const row of rows) {
      const safeName = _sanitize(row.player_name || "Web", 20);
      const safeMsg  = _sanitize(row.message || "", 200);
      if (!safeMsg.length) continue;

      // Distinct web chat format: [WEB] tag with different color
      try {
        world.sendMessage(`§8[§bWEB§8] §f${safeName}§8: §7${safeMsg}`);
      } catch {}

      if (row.id > _lastWebPollId) _lastWebPollId = row.id;
    }
  } catch (e) {
    console.warn("[Chat] Poll error:", e);
  } finally {
    _polling = false;
  }
}

/**
 * Cleanup: old messages (>24h) + expired verify codes (>24h).
 * TPS-gated, called every 30 min.
 */
export async function cleanupOldChat() {

  // TPS gate — cleanup is deferrable
  try { if (getTPS() < 18) return; } catch {}

  // Clean chat messages
  try {
    const cutoff = new Date(Date.now() - MSG_MAX_AGE_MS).toISOString();
    const req = new HttpRequest(`${CHAT_EP}?created_at=lt.${cutoff}`);
    req.method = HttpRequestMethod.Delete;
    req.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Prefer", "return=minimal"),
    ];
    await _chatHttp(req);
  } catch {}

  // Clean expired verify codes
  try {
    const vCutoff = new Date(Date.now() - VERIFY_MAX_AGE_MS).toISOString();
    const req2 = new HttpRequest(`${VERIFY_EP}?created_at=lt.${vCutoff}`);
    req2.method = HttpRequestMethod.Delete;
    req2.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Prefer", "return=minimal"),
    ];
    await _chatHttp(req2);
  } catch {}


}

// ── Schedules (coding-standards §1.4: intervals ≥ 100 ticks) ──
system.runTimeout(() => { flushChatBuffer().catch(() => {}); }, 200);
system.runInterval(() => { flushChatBuffer().catch(() => {}); }, CHAT_FLUSH_TICKS);

system.runTimeout(() => { pollWebChat().catch(() => {}); }, 300);
system.runInterval(() => { pollWebChat().catch(() => {}); }, WEB_POLL_TICKS);

system.runTimeout(() => { cleanupOldChat().catch(() => {}); }, 2_400);
system.runInterval(() => { cleanupOldChat().catch(() => {}); }, CLEANUP_TICKS);

// ── /lt:auth — open form popup for gamertag verification ──
async function _openAuthForm(player) {
  try {
    const name = player.name;

    // Per-player cooldown
    const now = Date.now();
    const la = _verifyCooldown.get(name) || 0;
    if (now - la < PLAYER_VERIFY_COOLDOWN_MS) {
      player.sendMessage("§c[Auth] Tunggu 30 detik sebelum coba lagi.");
      return;
    }

    const form = new ModalFormData()
      .title("§8 ♦ §eLIVE CHAT AUTH§r §8♦ §r")
      .textField(
        "§f Masukkan kode 6 digit dari website\n§7 Buka laughtalesmp.my.id/monitor \u2192 Live Chat \u2192 Daftar",
        "Contoh: 482917",
        { defaultValue: "" }
      );

    const res = await form.show(player);
    if (res.canceled) return;

    const code = String(res.formValues?.[0] || "").trim().replace(/[^0-9]/g, "");
    if (!/^\d{6}$/.test(code)) {
      player.sendMessage("§c[Auth] Kode harus 6 digit angka.");
      return;
    }

    _verifyCooldown.set(name, Date.now());
    if (_verifyCooldown.size > COOLDOWN_MAP_MAX) {
      const first = _verifyCooldown.keys().next().value;
      _verifyCooldown.delete(first);
    }

    player.sendMessage("§e[Auth] §7Memverifikasi kode...");
    await _processVerify(name, code);
  } catch (e) {
    if (e?.message?.includes("UI")) return; // player closed form
  }
}

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:auth",
        description: "Verifikasi gamertag untuk Live Chat",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => _openAuthForm(player));
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[Chat] /lt:auth registration failed:", e); }
});

// Startup covered by LT-Economy unified banner
