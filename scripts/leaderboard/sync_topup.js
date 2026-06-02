/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_topup.js — Web topup queue poller

   SLO: poll cycle success ≥ 95% / 24h. Topup apply latency ≤ 60s p95
        (acceptable since web admin expects async).

   See docs/runbook/topup-queue.md.
   ══════════════════════════════════════════════════════════════ */

import { world, system } from "@minecraft/server";
import { HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { trackFlow } from "../eco_flow.js";
import { SUPABASE_URL, SUPABASE_KEY, isOfflineMode, isCircuitOpen, httpWithTimeout } from "./sync_http.js";
import { dpGet, dpGetChunked } from "./sync_dp.js";
import {
  TOPUP_URL,
  FIRST_TOPUP_BONUS_PCT,
  FIRST_TOPUP_DISPLAY_PCT,
  FIRST_TOPUP_MULTIPLIER,
  FIRST_TOPUP_CURRENCIES,
} from "../topup_info.js";
import { getGem, setGem } from "../gacha/utils/scoreboard.js";

// Re-export bonus constants supaya konsumen lama (welcome/*, baseline) yang
// pernah import dari sini tetap kompatibel — single source tetap topup_info.js.
export { FIRST_TOPUP_BONUS_PCT, FIRST_TOPUP_DISPLAY_PCT };

const ADMIN_KEY = "laughtale-topup";
const TOPUP_EP = `${SUPABASE_URL}/rest/v1/topup_queue`;
const _doneIds = new Set();   // prevents double-processing (bounded to 50)
let _polling = false;
let _pollStartMs = 0;

const STUCK_THRESHOLD_MS = 60_000;
const DONE_IDS_CAP = 50;

// [P0 Funnel] First-topup bonus: gem-only, sekali per player. Konstanta
// (FIRST_TOPUP_BONUS_PCT, FIRST_TOPUP_CURRENCIES) di-import dari topup_info.js
// supaya panel guide & broadcast pakai angka yang sama. Bonus tidak di-charge
// ke daily cap, broadcast saat granted untuk visibility hook.
const K_FIRST_TOPUP = "topup:first:"; // + name → 1 setelah klaim

function _hasClaimedFirstTopup(name) {
  try {
    return world.getDynamicProperty(K_FIRST_TOPUP + name) !== undefined;
  } catch { return false; }
}
/**
 * [Security] Marker write dengan eksplisit success/failure return.
 * Caller harus abort kalau false — kalau bonus diberikan tanpa marker,
 * player bisa exploit dobel-claim.
 */
function _markFirstTopupClaimedSafe(name) {
  try {
    world.setDynamicProperty(K_FIRST_TOPUP + name, 1);
    // Verify write benar-benar nyangkut.
    return world.getDynamicProperty(K_FIRST_TOPUP + name) !== undefined;
  } catch { return false; }
}

/**
 * [Migration] Grandfather player yang sudah pernah topup di world lama
 * supaya tidak double-claim bonus saat migrasi ke world baru.
 *
 * Heuristik: kalau player punya saldo gem > 0 ATAU pernah dapat particle
 * (bitmask > 0), asumsikan mereka pernah topup dan set marker tanpa
 * memberikan bonus. Heuristik ini konservatif (false-positive aman: player
 * yang dapat gem dari refund duplikat juga ter-mark, tapi mereka memang
 * sudah engage dengan ekonomi gem).
 *
 * Idempotent via marker `topup:grandfathered:<name>` — hanya jalan sekali
 * per player per world (tidak re-run setiap login).
 *
 * @param {string} name — player name
 * @param {number} gemBal — current gem balance
 * @param {number} ptMask — particle ownership bitmask (0 = belum punya)
 * @returns {boolean} true kalau player baru saja di-grandfather
 */
const K_GRANDFATHERED = "topup:grandfathered:";

export function maybeGrandfatherFirstTopup(name, gemBal, ptMask) {
  if (!name) return false;
  // Sudah pernah dicek? Skip — hindari log spam tiap login.
  try {
    if (world.getDynamicProperty(K_GRANDFATHERED + name) !== undefined) return false;
  } catch { return false; }
  // Sudah claim normal? Tetap mark grandfathered supaya skip cek di login berikutnya.
  if (_hasClaimedFirstTopup(name)) {
    try { world.setDynamicProperty(K_GRANDFATHERED + name, 1); } catch { }
    return false;
  }
  // Heuristik: punya gem balance atau particle = sudah pernah engage gem ekonomi.
  const eligibleForGrandfather =
    (typeof gemBal === "number" && gemBal > 0) ||
    (typeof ptMask === "number" && ptMask > 0);
  if (!eligibleForGrandfather) return false;

  // Set kedua marker — first-topup (block bonus) + grandfathered (skip future check).
  try {
    world.setDynamicProperty(K_FIRST_TOPUP + name, 1);
    world.setDynamicProperty(K_GRANDFATHERED + name, 1);
    console.log(`[Topup] Grandfathered ${name} (gem=${gemBal} ptMask=${ptMask}) — bonus blocked`);
    return true;
  } catch (e) {
    console.warn(`[Topup] Grandfather marker write gagal untuk ${name}:`, e);
    return false;
  }
}

function _calcFirstTopupBonus(currency, amount) {
  if (!FIRST_TOPUP_CURRENCIES.has(currency)) return 0;
  return Math.floor(amount * FIRST_TOPUP_BONUS_PCT);
}

/**
 * Build broadcast/UX label untuk first-topup bonus.
 * Format: "promo ×N (+P%)" — multiplier framing lebih compelling
 * dari pure percent (Behavioral §5.2). Single source supaya online +
 * offline path konsisten.
 */
function _firstTopupPromoLabel() {
  return `§b×${FIRST_TOPUP_MULTIPLIER} §7(promo §b+${FIRST_TOPUP_DISPLAY_PCT}%%§7)`;
}

// [Behavioral §5.2] Daily spending cap per player per currency.
// Prevents a single admin mistake (or compromised admin key) from
// inflating one account by orders of magnitude. Per-amount limit
// (100k from validation) × N requests was previously unbounded.
const DAILY_CAP = { coin: 500_000, gem: 50_000 };
const K_TOPUP_DAILY = "topup:daily:";   // + UTC-day + ":" + currency + ":" + name
const MS_PER_DAY = 86_400_000;

function _utcDay() { return Math.floor(Date.now() / MS_PER_DAY); }

function _readDailyTotal(name, currency) {
  const key = K_TOPUP_DAILY + _utcDay() + ":" + currency + ":" + name;
  return dpGet(key, 0);
}

function _addDailyTotal(name, currency, amount) {
  const key = K_TOPUP_DAILY + _utcDay() + ":" + currency + ":" + name;
  const cur = dpGet(key, 0);
  try { world.setDynamicProperty(key, JSON.stringify(cur + amount)); } catch { }
}

/**
 * Poll Supabase for pending topup requests from the admin web panel.
 * Called every ~30 s from main.js. Fully async, non-blocking.
 */
export async function pollTopupQueue() {
  if (isOfflineMode()) return;

  // [SRE §7.4] Circuit open → silent skip; 30s polling would spam logs.
  if (isCircuitOpen()) return;

  if (_polling && Date.now() - _pollStartMs > STUCK_THRESHOLD_MS) {
    console.warn("[Topup-Poll] Stuck guard detected, force reset");
    _polling = false;
  }
  if (_polling) return;
  _polling = true;
  _pollStartMs = Date.now();

  try {
    const rows = await _fetchPending();
    if (!rows || rows.length === 0) return;

    for (const row of rows) await _processTopup(row);

    // Keep Set bounded — prune when > cap
    if (_doneIds.size > DONE_IDS_CAP) {
      const a = [..._doneIds];
      _doneIds.clear();
      a.slice(-Math.floor(DONE_IDS_CAP / 2)).forEach(id => _doneIds.add(id));
    }
  } catch (e) {
    if (!e?.circuitOpen) console.warn("[Topup-Poll] Error:", e);
  } finally {
    _polling = false;
  }
}

async function _fetchPending() {
  const getReq = new HttpRequest(`${TOPUP_EP}?status=eq.pending&order=created_at.asc&limit=5`);
  getReq.method = HttpRequestMethod.Get;
  getReq.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
  ];
  const res = await httpWithTimeout(getReq);
  if (res.status < 200 || res.status >= 300) return null;
  return JSON.parse(res.body || "[]");
}

async function _processTopup(row) {
  const { id, player_name, amount, currency, admin_key } = row;

  // Validate
  if (admin_key !== ADMIN_KEY) {
    await _markTopup(row, "failed", "Invalid key");
    return;
  }
  if (!player_name || typeof amount !== "number" || amount <= 0 || amount > 100000) {
    await _markTopup(row, "failed", "Invalid data");
    return;
  }

  // Already processed locally? Just retry marking
  if (_doneIds.has(id)) {
    await _markTopup(row, "done", "OK (re-mark)");
    return;
  }

  const obj = currency === "coin" ? "coin" : "gem";
  const safeName = player_name.replace(/["\\\n]/g, "");

  // [Behavioral] Daily cap check — block if cumulative day total would exceed.
  const cap = DAILY_CAP[obj];
  if (cap !== undefined) {
    const todayTotal = _readDailyTotal(safeName, obj);
    if (todayTotal + amount > cap) {
      _doneIds.add(id);
      const msg = `Daily cap exceeded (${todayTotal}+${amount} > ${cap} ${obj})`;
      await _markTopup(row, "failed", msg);
      console.warn(`[Topup] CAP BLOCKED ${safeName}: ${msg}`);
      return;
    }
  }

  // Try online player first
  const onlineResult = _tryApplyOnline(safeName, obj, amount);
  if (onlineResult.applied) {
    _doneIds.add(id);
    _addDailyTotal(safeName, obj, amount);

    // [P0] First-topup bonus check (online path)
    const bonus = _grantFirstTopupBonusOnline(onlineResult.player, safeName, obj, amount);
    const bonusMsg = bonus > 0 ? ` +${bonus} bonus 1st-topup` : "";

    await _markTopup(row, "done", `+${amount} ${obj} → ${safeName} (online)${bonusMsg}`);
    console.log(`[Topup] OK online: +${amount} ${obj} → ${safeName}${bonusMsg}`);

    try {
      onlineResult.player?.sendMessage(
        `§a[+] §f${amount} ${obj === "gem" ? "Gem" : "Koin"} §7ditambahkan oleh Admin.`
      );
      // Sound: topup biasa = orb (subtle), first-bonus = levelup epic.
      try { onlineResult.player?.playSound("random.orb", { pitch: 1.0, volume: 0.9 }); } catch { }
      if (bonus > 0) {
        onlineResult.player?.sendMessage(
          `§a§lSelamat! §r§aTopup pertama §f→ ${_firstTopupPromoLabel()}§a = §bbonus §b+${bonus} ${obj === "gem" ? "Gem" : "Koin"}§a!`
        );
        try { onlineResult.player?.playSound("random.levelup", { pitch: 1.3, volume: 1.0 }); } catch { }
      }
      // [PhD-v5 Marketing] Broadcast topup ke semua player — Social Proof.
      // Hanya gem (monetisasi). Tidak tampilkan jumlah (privasi player).
      if (obj === "gem") {
        try {
          world.sendMessage(
            `§8[§bTopup§8] §f${safeName} §dbaru saja topup §bGem§d! ` +
            `§8Topup di §b${TOPUP_URL}`
          );
        } catch { }
      }
    } catch { }
    return;
  }

  // Offline — store as pending DP
  await _processOffline(row, id, safeName, obj, amount);
}

/**
 * [P0] Apply first-topup bonus pada path online.
 * Dipanggil setelah amount utama sudah di-credit. Bonus tidak counted ke
 * daily cap (terpisah dari amount user). Idempotent via DP marker.
 *
 * [Security] Mark claimed DULU, baru kasih bonus. Kalau marker gagal write,
 * abort (false-negative aman). Kalau bonus dikasih dulu lalu marker gagal,
 * player bisa retry topup dan dapat bonus berkali-kali (exploit).
 *
 * @returns {number} bonus amount (0 kalau bukan first topup atau currency tidak eligible)
 */
function _grantFirstTopupBonusOnline(player, safeName, obj, amount) {
  const bonus = _calcFirstTopupBonus(obj, amount);
  if (bonus <= 0) return 0;
  if (_hasClaimedFirstTopup(safeName)) return 0;
  const sb = world.scoreboard.getObjective(obj);
  if (!sb || !player) return 0;

  // [Security §3] Mark claimed BEFORE giving bonus — prevents dobel-claim
  // kalau scoreboard write gagal. False-negative (player tidak dapat bonus)
  // bisa di-fix manual oleh admin; false-positive (dobel bonus) tidak.
  if (!_markFirstTopupClaimedSafe(safeName)) {
    console.warn(`[Topup] First-bonus marker write gagal untuk ${safeName} — abort bonus`);
    return 0;
  }

  try {
    if (obj === "gem") {
      if (!setGem(player, getGem(player) + bonus)) throw new Error("setGem failed");
    } else {
      sb.addScore(player, bonus);
    }
    trackFlow("topup_first_bonus", bonus);
    // Broadcast ke seluruh server — visibility hook gratis untuk konversi.
    try {
      world.sendMessage(
        `§a§f${safeName} §abaru saja melakukan §dtopup pertama§a! ` +
        `§7Mereka dapat §apromo ${_firstTopupPromoLabel()} §7= §abonus §b+${bonus} ${obj === "gem" ? "Gem" : "Koin"}§7. ` +
        `§8topup di §b${TOPUP_URL}`
      );
    } catch { }
    return bonus;
  } catch (e) {
    // [Security] Rollback marker — bonus tidak ter-credit, jadi player harus
    // tetap eligible di topup berikutnya.
    try { world.setDynamicProperty(K_FIRST_TOPUP + safeName, undefined); } catch { }
    console.warn(`[Topup] First-bonus apply gagal untuk ${safeName} — marker di-rollback:`, e);
    return 0;
  }
}

function _tryApplyOnline(safeName, obj, amount) {
  let applied = false;
  let player = null;
  try {
    for (const p of world.getPlayers()) {
      if (p.name === safeName) { player = p; break; }
    }
    if (player) {
      if (obj === "gem") {
        const before = getGem(player);
        const target = before + amount;
        if (setGem(player, target)) {
          // [FIX] Verify-after-write: baca ulang untuk memastikan value benar-benar tersimpan.
          const after = getGem(player);
          if (after !== target) {
            // Tag write mungkin gagal silent — force direct scoreboard write sebagai fallback.
            console.warn(`[Topup] VERIFY MISMATCH ${safeName}: target=${target} got=${after}, forcing scoreboard`);
            try {
              const sbObj = world.scoreboard.getObjective(obj);
              if (sbObj) sbObj.setScore(player.scoreboardIdentity ?? player, target);
            } catch (e2) { console.warn("[Topup] Scoreboard force-write failed:", e2); }
          }
          applied = true;
          trackFlow("topup", amount);
          console.log(`[Topup] GEM APPLY ${safeName}: before=${before} +${amount} = target=${target}, readback=${after}`);
        } else {
          console.warn(`[Topup] setGem returned false for ${safeName}: before=${before} target=${target}`);
        }
      } else {
        const sb = world.scoreboard.getObjective(obj);
        if (sb) {
          sb.addScore(player, amount);
          applied = true;
          trackFlow("topup", amount);
        }
      }
    } else {
      console.log(`[Topup] Player "${safeName}" not found online (${[...world.getPlayers()].map(p => p.name).join(', ')})`);
    }
  } catch (e) {
    console.warn(`[Topup] _tryApplyOnline error for ${safeName}:`, e);
  }
  return { applied, player };
}

async function _processOffline(row, id, safeName, obj, amount) {
  try {
    const pid = _findPlayerId(safeName);
    if (!pid) {
      _doneIds.add(id);
      await _markTopup(row, "failed", `Player "${safeName}" tidak ditemukan di registry`);
      console.warn(`[Topup] Player not found: ${safeName}`);
      return;
    }

    // [P0] Hitung bonus first-topup dulu (offline path) supaya digabung ke pending.
    // [Security] Mark claimed BEFORE write — sama alasan dengan online path.
    let bonus = 0;
    if (!_hasClaimedFirstTopup(safeName)) {
      const tentative = _calcFirstTopupBonus(obj, amount);
      if (tentative > 0) {
        if (_markFirstTopupClaimedSafe(safeName)) {
          bonus = tentative;
        } else {
          console.warn(`[Topup] First-bonus marker write gagal untuk ${safeName} (offline) — abort bonus`);
        }
      }
    }
    const totalCredit = amount + bonus;

    // Read current pending/registry value, then ADD
    const regKey = obj === "gem" ? "gacha:pend_gem:" : "gacha:pend_coin:";
    const existing = dpGet(regKey + pid, null);
    const reg = dpGetChunked("p_reg", {});
    const regBal = obj === "gem" ? (reg[pid]?.gem ?? 0) : (reg[pid]?.coin ?? 0);
    const base = existing !== null ? existing : regBal;
    const newBal = base + totalCredit;

    try {
      world.setDynamicProperty(regKey + pid, JSON.stringify(newBal));
    } catch (e) {
      // [Security] Rollback marker — bonus belum benar-benar di-credit ke pending,
      // jadi marker tidak boleh tetap set (player akan stuck "claimed" tanpa pernah
      // dapat bonus). Marker rollback aman karena belum ada side-effect lain.
      if (bonus > 0) {
        try { world.setDynamicProperty(K_FIRST_TOPUP + safeName, undefined); } catch { }
      }
      _doneIds.add(id);
      await _markTopup(row, "failed", `DP write error: ${e?.message || e}`);
      return;
    }

    // Bonus marker sudah diset di awal — di sini cuma track flow + broadcast.
    // [PhD-v5 Marketing] Broadcast topup ke semua player — Social Proof (offline path).
    if (obj === "gem") {
      try {
        world.sendMessage(
          `§8[§bTopup§8] §f${safeName} §dbaru saja topup §bGem§d! ` +
          `§8Topup di §b${TOPUP_URL}`
        );
      } catch { }
    }

    if (bonus > 0) {
      trackFlow("topup_first_bonus", bonus);
      try {
        world.sendMessage(
          `§a§f${safeName} §abaru saja melakukan §dtopup pertama§a! ` +
          `§7Mereka dapat §apromo ${_firstTopupPromoLabel()} §7= §abonus §b+${bonus} ${obj === "gem" ? "Gem" : "Koin"}§7. ` +
          `§8topup di §b${TOPUP_URL}`
        );
      } catch { }
    }

    _doneIds.add(id);
    _addDailyTotal(safeName, obj, amount);
    const bonusMsg = bonus > 0 ? ` +${bonus} bonus 1st-topup` : "";
    await _markTopup(row, "done", `+${amount} ${obj} → ${safeName} (offline, pending ${newBal})${bonusMsg}`);
    console.log(`[Topup] OK offline: +${amount} ${obj} → ${safeName} (pending=${newBal})${bonusMsg}`);
  } catch (e) {
    _doneIds.add(id);
    await _markTopup(row, "failed", `Error: ${e?.message || e}`);
    console.warn(`[Topup] FAIL ${safeName}:`, e);
  }
}

/** Find player ID from gacha registry by name. */
function _findPlayerId(name) {
  try {
    const reg = dpGetChunked("p_reg", {});
    for (const [id, info] of Object.entries(reg)) {
      if (info.name === name) return id;
    }
  } catch { }
  return null;
}

/** Mark a topup row as done/failed via POST upsert. */
async function _markTopup(row, status, msg) {
  try {
    const req = new HttpRequest(`${TOPUP_EP}?on_conflict=id`);
    req.method = HttpRequestMethod.Post;
    req.body = JSON.stringify({
      id: row.id,
      player_name: row.player_name,
      amount: row.amount,
      currency: row.currency || "gem",
      status,
      admin_key: row.admin_key,
      admin_note: row.admin_note || "",
      created_at: row.created_at,
      processed_at: new Date().toISOString(),
      result_msg: msg,
    });
    req.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Content-Type", "application/json"),
      new HttpHeader("Prefer", "resolution=merge-duplicates,return=minimal"),
    ];
    await httpWithTimeout(req);
  } catch (e) {
    if (!e?.circuitOpen) console.warn("[Topup] Mark error:", e);
  }
}

// [Anti-leak] Prune topup:daily:* keys older than today.
// Auto-scheduled hourly + once at startup (delayed 60s).
export function pruneTopupDailyKeys() {
  try {
    const today = _utcDay();
    const ids = world.getDynamicPropertyIds();
    let removed = 0;
    for (const id of ids) {
      if (!id.startsWith(K_TOPUP_DAILY)) continue;
      // key format: topup:daily:<DAY>:<currency>:<name>
      const after = id.substring(K_TOPUP_DAILY.length);
      const colonIdx = after.indexOf(":");
      if (colonIdx < 0) continue;
      const day = parseInt(after.substring(0, colonIdx), 10);
      if (Number.isFinite(day) && day < today) {
        try { world.setDynamicProperty(id, undefined); removed++; } catch { }
      }
    }
    if (removed > 0) console.log(`[Topup] Pruned ${removed} stale daily-cap key(s)`);
  } catch (e) {
    console.warn("[Topup] Prune error:", e);
  }
}

// Schedule prune: 60s after startup, then every hour.
system.runTimeout(() => {
  pruneTopupDailyKeys();
  system.runInterval(pruneTopupDailyKeys, 72_000); // 1h = 72k ticks
}, 1_200);

/**
 * Mark offline topup_queue entries as delivered when player logs in.
 * Finds entries with status=done and result_msg containing '(offline'
 * for the given player_name, then updates result_msg to show delivery.
 *
 * Fire-and-forget — errors are silent since the gems are already applied.
 */
export async function markOfflineDelivered(playerName, currency) {
  if (isOfflineMode() || isCircuitOpen()) return;
  try {
    // 1. Fetch offline entries for this player
    const cur = currency || "gem";
    const url = `${TOPUP_EP}?player_name=eq.${encodeURIComponent(playerName)}&status=eq.done&result_msg=like.*offline*&currency=eq.${cur}&order=created_at.desc&limit=10`;
    const getReq = new HttpRequest(url);
    getReq.method = HttpRequestMethod.Get;
    getReq.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    ];
    const getRes = await httpWithTimeout(getReq);
    if (getRes.status < 200 || getRes.status >= 300) return;
    const rows = JSON.parse(getRes.body || "[]");
    if (!rows.length) return;

    // 2. Update each entry — change result_msg to reflect delivery
    for (const row of rows) {
      try {
        const patchReq = new HttpRequest(`${TOPUP_EP}?id=eq.${row.id}`);
        patchReq.method = HttpRequestMethod.Patch;
        patchReq.body = JSON.stringify({
          result_msg: row.result_msg.replace("(offline", "(online, delivered on login"),
          processed_at: new Date().toISOString(),
        });
        patchReq.headers = [
          new HttpHeader("apikey", SUPABASE_KEY),
          new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
          new HttpHeader("Content-Type", "application/json"),
          new HttpHeader("Prefer", "return=minimal"),
        ];
        await httpWithTimeout(patchReq);
      } catch { }
    }
    console.log(`[Topup] Marked ${rows.length} offline entry(s) as delivered for ${playerName}`);
  } catch (e) {
    // Silent — gems already applied, this is just UI status update
    if (!e?.circuitOpen) console.warn("[Topup] markOfflineDelivered error:", e);
  }
}
