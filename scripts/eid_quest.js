// ============================================================
// eid_quest.js — Eid Quest: Kill mobs → earn Shards
//
// Quest hanya aktif saat event Eid (toggle via DP "eid:active").
// Reset otomatis setiap jam 08:00 WIB (01:00 UTC).
//
// Quest berrotasi harian (7 set berbeda per hari WIB):
//   Senin:  Sapi 50, Domba 50, Kambing 50   (Classic)
//   Selasa: Ayam 60, Babi 40, Sapi 30       (Farm Mix)
//   Rabu:   Zombie 40, Skeleton 40, Spider 30 (Monster Hunter)
//   Kamis:  Domba 45, Kambing 45, Babi 35   (Pastoral)
//   Jumat:  Sapi 50, Kambing 50             (Qurban Focus)
//   Sabtu:  Sapi 25, Domba 25, Kambing 25   (Weekend Rush — 2x rate)
//   Minggu: Creeper 20, Enderman 15, Witch 10 (Mystery Hunt)
//
// Shard disimpan di scoreboard "lt_shard".
// Progress quest di Player DP key "eid:quest:".
// ============================================================

import { world, system } from "@minecraft/server";
import { pGet, pSet, getOnlinePlayer } from "./player_dp.js";

// ═══════════════════════════════════════════════════════════
// KONFIGURASI — semua magic numbers → named constants
// ═══════════════════════════════════════════════════════════
const EID_ACTIVE_KEY = "eid:active";    // world DP — deadline timestamp
const K_QUEST = "eid:quest:";    // player DP prefix
const TOKEN_OBJ = "lt_shard";      // scoreboard objective
const RESET_UTC_HOUR = 1;               // 01:00 UTC = 08:00 WIB
const MS_PER_DAY = 86_400_000;
const MAX_TOKEN = 2_000_000_000;   // §3.2 overflow cap
const QUEST_CACHE_MAX = 50;              // §1.3 max entries in quest cache
const FLUSH_INTERVAL = 200;             // 10 detik — batch DP write
const EXPIRE_INTERVAL = 6000;            // ~5 menit — auto-expire check
const SB_RESOLVE_INTERVAL = 6000;            // ~5 menit — re-resolve scoreboard
const PROGRESS_NOTIFY = 10;              // notif setiap N kills
const ADMIN_TAG = "mimi";
const MAX_EVENT_DAYS = 90;              // max durasi event
const WIB_OFFSET_HOURS = 7;              // UTC+7

// ── Daily Quest Rotation (index 0=Minggu → 6=Sabtu per JS getUTCDay) ──
// Game Design PhD: varied quests prevent grind monotony (Raph Koster)
// Bartle: mix of PvE types appeals to different player motivations
const QUEST_ROTATION = [
  // Minggu (0) — Mystery Hunt: rare mobs, low target, high excitement
  { label: "§5Mystery Hunt", quests: [
    { mob: "minecraft:creeper",  label: "§fCreeper",  key: "creeper",  target: 20 },
    { mob: "minecraft:enderman", label: "§fEnderman", key: "enderman", target: 15 },
    { mob: "minecraft:witch",    label: "§fWitch",    key: "witch",    target: 10 },
  ]},
  // Senin (1) — Classic: original Eid quest
  { label: "§aClassic", quests: [
    { mob: "minecraft:cow",   label: "§fSapi",    key: "cow",   target: 50 },
    { mob: "minecraft:sheep", label: "§fDomba",   key: "sheep", target: 50 },
    { mob: "minecraft:goat",  label: "§fKambing", key: "goat",  target: 50 },
  ]},
  // Selasa (2) — Farm Mix: varied livestock
  { label: "§eFarm Mix", quests: [
    { mob: "minecraft:chicken", label: "§fAyam",  key: "chicken", target: 60 },
    { mob: "minecraft:pig",     label: "§fBabi",  key: "pig",     target: 40 },
    { mob: "minecraft:cow",     label: "§fSapi",  key: "cow",     target: 30 },
  ]},
  // Rabu (3) — Monster Hunter: hostile mobs for Killer types
  { label: "§cMonster Hunter", quests: [
    { mob: "minecraft:zombie",   label: "§fZombie",   key: "zombie",   target: 40 },
    { mob: "minecraft:skeleton", label: "§fSkeleton", key: "skeleton", target: 40 },
    { mob: "minecraft:spider",   label: "§fSpider",   key: "spider",   target: 30 },
  ]},
  // Kamis (4) — Pastoral: medium livestock mix
  { label: "§2Pastoral", quests: [
    { mob: "minecraft:sheep", label: "§fDomba",   key: "sheep", target: 45 },
    { mob: "minecraft:goat",  label: "§fKambing", key: "goat",  target: 45 },
    { mob: "minecraft:pig",   label: "§fBabi",    key: "pig",   target: 35 },
  ]},
  // Jumat (5) — Qurban Focus: thematic for Eid
  { label: "§6Qurban Focus", quests: [
    { mob: "minecraft:cow",  label: "§fSapi",    key: "cow",  target: 50 },
    { mob: "minecraft:goat", label: "§fKambing", key: "goat", target: 50 },
  ]},
  // Sabtu (6) — Weekend Rush: halved targets = 2x effective rate
  { label: "§b⚡Weekend Rush", quests: [
    { mob: "minecraft:cow",   label: "§fSapi",    key: "cow",   target: 25 },
    { mob: "minecraft:sheep", label: "§fDomba",   key: "sheep", target: 25 },
    { mob: "minecraft:goat",  label: "§fKambing", key: "goat",  target: 25 },
  ]},
];

/** Get WIB day-of-week (0=Minggu, 6=Sabtu). */
function _getWibDay() {
  const wibMs = Date.now() + WIB_OFFSET_HOURS * 3_600_000;
  return new Date(wibMs).getUTCDay();
}

/** Get today's active quest set (rotates daily based on WIB day). */
function _getActiveQuests() {
  return QUEST_ROTATION[_getWibDay()];
}

/** Get today's quest label for display. */
export function getQuestDayLabel() {
  return _getActiveQuests().label;
}

// Build dynamic lookup table — rebuilt each period
let _questByMobCache = null;
let _questByMobPeriod = -1;

function _getQuestByMob() {
  const period = _getCurrentPeriod();
  if (_questByMobCache && _questByMobPeriod === period) return _questByMobCache;
  _questByMobCache = new Map(_getActiveQuests().quests.map(q => [q.mob, q]));
  _questByMobPeriod = period;
  return _questByMobCache;
}

// ═══════════════════════════════════════════════════════════
// TOKEN SCOREBOARD — lazy-resolve with cache
// ═══════════════════════════════════════════════════════════
let _tokenObj = null;

function ensureTokenObj() {
  if (_tokenObj) return _tokenObj;
  try {
    _tokenObj = world.scoreboard.getObjective(TOKEN_OBJ)
      ?? world.scoreboard.addObjective(TOKEN_OBJ, "Shard");
  } catch (e) {
    console.warn("[EidQuest] ensureTokenObj:", e.message);
  }
  return _tokenObj;
}

// Invalidate periodically (scoreboard bisa hilang saat world reload)
system.runInterval(() => { _tokenObj = null; }, SB_RESOLVE_INTERVAL);

/**
 * Validate token amount — §3.2 anti-exploit
 * @returns {number|null} validated amount or null if invalid
 */
function _validateAmount(amount) {
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_TOKEN);
}

/**
 * Get player's Shard count.
 * @param {Player} player
 * @returns {number}
 */
export function getToken(player) {
  try {
    const score = ensureTokenObj()?.getScore(player.scoreboardIdentity ?? player);
    const n = score ?? 0;
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  } catch { return 0; }
}

/**
 * Add tokens to player (capped at MAX_TOKEN).
 * @returns {boolean} success
 */
export function addToken(player, amount) {
  const validated = _validateAmount(amount);
  if (validated === null) return false;
  try {
    const cur = getToken(player);
    const newVal = Math.min(cur + validated, MAX_TOKEN);
    ensureTokenObj()?.setScore(player.scoreboardIdentity ?? player, newVal);
    return true;
  } catch { return false; }
}

/**
 * Deduct tokens from player.
 * @returns {boolean} success
 */
export function deductToken(player, amount) {
  const validated = _validateAmount(amount);
  if (validated === null) return false;
  const cur = getToken(player);
  if (cur < validated) return false;
  try {
    ensureTokenObj()?.setScore(player.scoreboardIdentity ?? player, cur - validated);
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════
// EID ACTIVE — cached DP read (avoid DP read on every entityDie)
// ═══════════════════════════════════════════════════════════
let _eidActiveCache = false;
let _eidDeadlineCache = 0;
let _eidCacheTs = 0;
const EID_CACHE_TTL = 5000; // 5 detik TTL

function _refreshEidCache() {
  try {
    const v = world.getDynamicProperty(EID_ACTIVE_KEY);
    if (typeof v === "number" && v > 0) {
      _eidDeadlineCache = v;
      _eidActiveCache = Date.now() < v;
    } else if (v === true || v === "true") {
      // Legacy boolean support
      _eidDeadlineCache = 0;
      _eidActiveCache = true;
    } else {
      _eidDeadlineCache = 0;
      _eidActiveCache = false;
    }
    _eidCacheTs = Date.now();
  } catch {
    _eidActiveCache = false;
    _eidDeadlineCache = 0;
  }
}

/**
 * Check if Eid event is active (cached, TTL 5s).
 */
export function isEidActive() {
  if (Date.now() - _eidCacheTs > EID_CACHE_TTL) _refreshEidCache();
  return _eidActiveCache;
}

/**
 * Get remaining time string for the event.
 */
export function getEidTimeLeft() {
  if (Date.now() - _eidCacheTs > EID_CACHE_TTL) _refreshEidCache();
  if (_eidDeadlineCache <= 0) return null;
  const remaining = _eidDeadlineCache - Date.now();
  if (remaining <= 0) return null;
  const days = Math.floor(remaining / MS_PER_DAY);
  const hours = Math.floor((remaining % MS_PER_DAY) / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return `${days}h ${hours}j ${mins}m`;
  if (hours > 0) return `${hours}j ${mins}m`;
  return `${mins}m`;
}

// ═══════════════════════════════════════════════════════════
// QUEST PROGRESS — per-player, daily reset at 08:00 WIB
// ═══════════════════════════════════════════════════════════
function _getCurrentPeriod() {
  return Math.floor((Date.now() - RESET_UTC_HOUR * 3_600_000) / MS_PER_DAY);
}

// In-memory cache with cap — §1.3 compliant
const _questCache = new Map(); // playerId → { period, [key]: count, [key_done]: bool, ... }
const _questDirty = new Set();

function _getDefaultQuest() {
  // Dynamic default — only period field is needed; quest keys are added on increment
  return { period: -1 };
}

function _evictOldestIfNeeded() {
  if (_questCache.size < QUEST_CACHE_MAX) return;
  // Evict first (oldest) entry not in dirty set
  for (const [pid] of _questCache) {
    if (!_questDirty.has(pid)) {
      _questCache.delete(pid);
      return;
    }
  }
  // All dirty — evict first anyway (will be re-loaded from DP)
  const first = _questCache.keys().next().value;
  if (first !== undefined) _questCache.delete(first);
}

function _getQuestProgress(playerId) {
  if (_questCache.has(playerId)) return _questCache.get(playerId);
  const p = getOnlinePlayer(playerId);
  const def = _getDefaultQuest();
  const v = p ? pGet(p, K_QUEST, def) : def;
  // Reset if period changed
  const curPeriod = _getCurrentPeriod();
  if (v.period !== curPeriod) {
    const fresh = _getDefaultQuest();
    fresh.period = curPeriod;
    _evictOldestIfNeeded();
    _questCache.set(playerId, fresh);
    _questDirty.add(playerId);
    return fresh;
  }
  _evictOldestIfNeeded();
  _questCache.set(playerId, v);
  return v;
}

function _setQuestProgress(playerId, data) {
  _questCache.set(playerId, data);
  _questDirty.add(playerId);
}

/**
 * Get quest info for UI display.
 * @returns {{ quests: Array<{label, key, current, target, done}>, token: number, dayLabel: string }}
 */
export function getEidQuestInfo(player) {
  const progress = _getQuestProgress(player.id);
  const token = getToken(player);
  const activeDay = _getActiveQuests();
  const quests = activeDay.quests.map(q => ({
    label: q.label,
    key: q.key,
    current: Math.min(progress[q.key] ?? 0, q.target),
    target: q.target,
    done: !!progress[q.key + "_done"],
  }));
  return { quests, token, dayLabel: activeDay.label };
}

/**
 * Get countdown string to next quest reset (08:00 WIB = 01:00 UTC).
 */
export function getEidQuestReset() {
  const now = Date.now();
  const todayReset = Math.floor((now - RESET_UTC_HOUR * 3_600_000) / MS_PER_DAY) * MS_PER_DAY + RESET_UTC_HOUR * 3_600_000;
  let next = todayReset + MS_PER_DAY;
  if (next <= now) next += MS_PER_DAY;
  const rem = next - now;
  const h = Math.floor(rem / 3_600_000);
  const m = Math.floor((rem % 3_600_000) / 60_000);
  return `${h}j ${m}m`;
}

// ═══════════════════════════════════════════════════════════
// KILL HANDLER — track mob kills for quest
// ═══════════════════════════════════════════════════════════
world.afterEvents.entityDie.subscribe(ev => {
  // Early return chain — cheapest checks first (§1.2)
  if (!_eidActiveCache && Date.now() - _eidCacheTs < EID_CACHE_TTL) return;
  if (!isEidActive()) return;

  const dead = ev.deadEntity;
  const killer = ev.damageSource?.damagingEntity;
  if (!killer || !dead) return;
  if (killer.typeId !== "minecraft:player") return;

  // O(1) lookup with daily-rotated quest table
  const questMap = _getQuestByMob();
  const quest = questMap.get(dead.typeId);
  if (!quest) return;

  const progress = _getQuestProgress(killer.id);
  const doneKey = quest.key + "_done";

  // Already claimed today
  if (progress[doneKey]) return;

  // Increment (cap to target to prevent over-counting)
  const cur = progress[quest.key] ?? 0;
  if (cur >= quest.target) return; // safety
  progress[quest.key] = cur + 1;

  // Check completion
  if (progress[quest.key] >= quest.target) {
    progress[doneKey] = true;
    // Award token
    if (addToken(killer, 1)) {
      const newTotal = getToken(killer);
      const dayLabel = _getActiveQuests().label;
      try {
        killer.sendMessage(
          `\n§8═══════════════════` +
          `\n§6  ◆ QUEST SELESAI!` +
          `\n§8═══════════════════` +
          `\n  ${quest.label} §a✓ ${quest.target}/${quest.target}` +
          `\n  §a+1 §6Shard ◆ §8(Total: §6${newTotal}§8)` +
          `\n  §8Mode: ${dayLabel}` +
          `\n§8═══════════════════\n`
        );
        killer.playSound("random.levelup", { pitch: 1.2, volume: 1.0 });
      } catch { }
    }
  } else if (progress[quest.key] % PROGRESS_NOTIFY === 0) {
    // Progress notification every N kills
    try {
      killer.sendMessage(`§8[§6◆ Quest§8] ${quest.label}§8: §e${progress[quest.key]}§8/§e${quest.target}`);
    } catch { }
  }

  _setQuestProgress(killer.id, progress);
});

// ═══════════════════════════════════════════════════════════
// FLUSH — batch write dirty quest data (§1.1 throttled DP write)
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  if (_questDirty.size === 0) return;
  for (const pid of _questDirty) {
    const data = _questCache.get(pid);
    if (!data) { _questDirty.delete(pid); continue; }
    try {
      const p = getOnlinePlayer(pid);
      if (p) {
        pSet(p, K_QUEST, data);
        _questDirty.delete(pid);
      }
    } catch (e) {
      console.warn("[EidQuest] Flush failed:", pid, e.message);
    }
  }
}, FLUSH_INTERVAL);

// Cleanup on leave — §1.3 mandatory Map cleanup
world.afterEvents.playerLeave.subscribe(ev => {
  const pid = ev.playerId;
  // Flush before cleanup — player might still be valid briefly
  if (_questDirty.has(pid)) {
    const data = _questCache.get(pid);
    if (data) {
      try {
        const p = getOnlinePlayer(pid);
        if (p) pSet(p, K_QUEST, data);
      } catch { }
    }
  }
  _questDirty.delete(pid);
  _questCache.delete(pid);
});

// ═══════════════════════════════════════════════════════════
// ADMIN: toggle event via scriptevent
// /scriptevent eid:toggle on <hari>   — aktifkan selama X hari
// /scriptevent eid:toggle off         — matikan manual
// /scriptevent eid:toggle             — cek status & sisa waktu
// ═══════════════════════════════════════════════════════════

/**
 * Format deadline to WIB string (safe UTC+7 conversion).
 */
function _formatWIB(timestamp) {
  const d = new Date(timestamp);
  // Manual UTC+7 offset (handles day rollover correctly)
  const utcH = d.getUTCHours();
  const wibH = (utcH + WIB_OFFSET_HOURS) % 24;
  // If overflow, date is +1
  const dayShift = (utcH + WIB_OFFSET_HOURS) >= 24 ? 1 : 0;
  const wibDate = new Date(timestamp + dayShift * MS_PER_DAY);
  return `${wibDate.getUTCDate()}/${wibDate.getUTCMonth() + 1} ${String(wibH).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} WIB`;
}

system.afterEvents.scriptEventReceive.subscribe(ev => {
  if (ev.id !== "eid:toggle") return;
  const src = ev.sourceEntity;
  // Console (no sourceEntity) = admin; in-game player needs admin tag
  const isAdmin = !src || src.hasTag?.(ADMIN_TAG);
  if (!isAdmin) {
    src?.sendMessage?.("\u00a78[\u00a7cEid\u00a78]\u00a7c Akses ditolak.");
    return;
  }
  const reply = (msg) => {
    if (src) src.sendMessage(msg);
    // Always log to console so BDS console can see feedback
    console.warn(msg.replace(/\u00a7./g, ""));
  };
  const args = (ev.message ?? "").trim().split(/\s+/);
  const cmd = args[0]?.toLowerCase();

  if (cmd === "on") {
    // \u00a73.3 input validation \u2014 cap days to sane range
    const rawDays = parseInt(args[1]);
    const days = Number.isFinite(rawDays) && rawDays > 0
      ? Math.min(rawDays, MAX_EVENT_DAYS)
      : 7; // default 7 hari
    const deadline = Date.now() + days * MS_PER_DAY;
    world.setDynamicProperty(EID_ACTIVE_KEY, deadline);
    _refreshEidCache(); // invalidate cache immediately
    const endStr = _formatWIB(deadline);
    world.sendMessage(`\u00a78[\u00a76\u25c6 Eid Adha\u00a78] \u00a7aEvent aktif selama \u00a7f${days} hari\u00a7a! \u00a77Kill sapi/domba/kambing untuk dapatkan \u00a76Shard\u00a77. Berakhir: \u00a7e${endStr}`);
    reply(`[Eid] Event AKTIF selama ${days} hari. Deadline: ${endStr}`);
  } else if (cmd === "off") {
    world.setDynamicProperty(EID_ACTIVE_KEY, 0);
    _refreshEidCache(); // invalidate cache immediately
    world.sendMessage("\u00a78[\u00a76\u25c6 Event\u00a78] \u00a77Event telah \u00a7cberakhir\u00a77.");
    reply("[Eid] Event NONAKTIF.");
  } else {
    const timeLeft = getEidTimeLeft();
    const active = isEidActive();
    const status = active ? `AKTIF (sisa: ${timeLeft})` : "NONAKTIF";
    reply(`[Eid] Status: ${status} | Cache: ${_questCache.size} entries, ${_questDirty.size} dirty`);
    reply(`[Eid] Usage: /scriptevent eid:toggle on <hari> | off`);
  }
});

// ═══════════════════════════════════════════════════════════
// AUTO-EXPIRE — cek tiap 5 menit, broadcast saat event berakhir
// ═══════════════════════════════════════════════════════════
let _wasActive = false;

// Init _wasActive from DP at startup + migrate legacy scoreboard
system.run(() => {
  _refreshEidCache();
  _wasActive = _eidActiveCache;
  ensureTokenObj();

  // One-time migration: qurban_token / event_token → lt_shard
  const _legacyObjs = ["qurban_token", "event_token"];
  for (const legacyName of _legacyObjs) {
    try {
      const oldObj = world.scoreboard.getObjective(legacyName);
      if (oldObj) {
        const newObj = ensureTokenObj();
        if (newObj) {
          for (const p of oldObj.getParticipants()) {
            const score = oldObj.getScore(p) ?? 0;
            if (score > 0) {
              const existing = newObj.getScore(p) ?? 0;
              newObj.setScore(p, existing + score);
            }
          }
          world.scoreboard.removeObjective(legacyName);
          console.warn(`[EidQuest] Migrated ${legacyName} → lt_shard`);
        }
      }
    } catch (e) { console.warn(`[EidQuest] Migration ${legacyName}:`, e.message); }
  }
});

system.runInterval(() => {
  try {
    _refreshEidCache(); // also refreshes the isEidActive cache
    const nowActive = _eidActiveCache;

    // Event just expired
    if (_wasActive && !nowActive && _eidDeadlineCache === 0) {
      // Check if DP still has old deadline (hasn't been zeroed yet)
      const v = world.getDynamicProperty(EID_ACTIVE_KEY);
      if (typeof v === "number" && v > 0 && Date.now() >= v) {
        world.setDynamicProperty(EID_ACTIVE_KEY, 0);
        _refreshEidCache();
        world.sendMessage("§8[§6◆ Event§8] §7Event telah §cberakhir otomatis§7.");
        console.warn("[EidQuest] Event auto-expired.");
      }
    }
    _wasActive = nowActive;
  } catch { }
}, EXPIRE_INTERVAL);

// ═══════════════════════════════════════════════════════════
// STARTUP — §8 health check & monitoring
// ═══════════════════════════════════════════════════════════
system.runTimeout(() => {
  console.warn(
    `[EidQuest] Loaded: Shard quest system` +
    (isEidActive() ? ` [EVENT ACTIVE — ${getEidTimeLeft()} left]` : "") +
    ` | Cache: ${_questCache.size}/${QUEST_CACHE_MAX}` +
    ` | Intervals: flush=${FLUSH_INTERVAL}t, expire=${EXPIRE_INTERVAL}t, sb=${SB_RESOLVE_INTERVAL}t`
  );
}, 60);
