// monitor/auto_throttle.js — Auto Throttle v2.0
// [FIX] Level 3 item clean has independent cooldown
// [PERF] Type-filtered entity queries instead of full scan
// [PERF] Cache world.getPlayers() — no double call

import { world, system } from "@minecraft/server";
import { getTPSAverageLast, getTPSColor } from "./tps_tracker.js";
import { getEntityCounts, HOSTILE_ARRAY, DIMS } from "./entity_counter.js";
import { setBar } from "../shared/actionbar_manager.js";

const ADMIN_TAG = "mimi";
const SAFE_DIST = 16;
const SAFE_DIST_SQ = SAFE_DIST * SAFE_DIST;    // precompute squared
const HOSTILE_COOLDOWN = 200;                    // ticks between hostile cleans
const ITEMS_COOLDOWN = 100;                      // ticks between item cleans (independent)

const PROTECTED = new Set([
  "minecraft:villager_v2", "minecraft:wandering_trader",
  "minecraft:iron_golem", "minecraft:snow_golem",
  "minecraft:wither", "minecraft:ender_dragon", "minecraft:warden", "minecraft:elder_guardian",
  "minecraft:armor_stand", "minecraft:minecart", "minecraft:boat",
  "minecraft:chest_minecart", "minecraft:hopper_minecart",
  "minecraft:npc", "minecraft:player",
]);

let _enabled = true;
let _lastHostileCleanTick = 0;    // separate cooldown for hostile
let _lastItemCleanTick = 0;       // [FIX] separate cooldown for items
/** Level yang dipakai semua tindakan (avg TPS + debounce naik) */
let _lastLevel = 0;
/** Level mentah dari rata-rata TPS (untuk transisi) */
let _rawLevel = 0;
let _pendingRise = 0;
let _levelHoldRise = 0;
let _totalCleaned = 0;
let _lastAlertTick = 0;

/** Rata-rata ~6s — spike <1s kebanyakan tidak cukup menarik TPS rata ke bawah ambang. */
const THROTTLE_AVG_SAMPLES = 6;
/** Naik ke level lebih buruk butuh 2x cek interval (≈4s) berturut-turut; turun = langsung. */
const RISE_STABLE_CHECKS = 2;

function isAdmin(p) { try { return p.hasTag(ADMIN_TAG); } catch { return false; } }

function alertAdmins(msg) {
  const now = system.currentTick;
  if (now - _lastAlertTick < 100) return;
  _lastAlertTick = now;
  for (const p of world.getPlayers()) {
    if (isAdmin(p)) p.sendMessage(msg);
  }
}

function getThrottleLevel(tps) {
  if (tps >= 16) return 0;
  if (tps >= 12) return 1;
  if (tps >= 8)  return 2;
  return 3;
}

/**
 * Update _lastLevel: memburuk butuh konfirmasi berulang, membaik langsung
 * (supaya autothrottle tidak "nyala" hanya karena blip sebentar).
 */
function updateCommittedThrottleLevel(rawLevel) {
  _rawLevel = rawLevel;
  if (rawLevel < _lastLevel) {
    _lastLevel = rawLevel;
    _pendingRise = rawLevel;
    _levelHoldRise = 0;
    return;
  }
  if (rawLevel === _lastLevel) {
    _levelHoldRise = 0;
    return;
  }
  // rawLevel > _lastLevel
  if (rawLevel === _pendingRise) {
    _levelHoldRise++;
  } else {
    _pendingRise = rawLevel;
    _levelHoldRise = 1;
  }
  if (_levelHoldRise >= RISE_STABLE_CHECKS) {
    _lastLevel = rawLevel;
    _levelHoldRise = 0;
  }
}

// ═══════════════════════════════════════════════════════════
// CLEAN HOSTILE — type-filtered queries per hostile type
// [PERF] dim.getEntities({ type }) instead of full scan
// ═══════════════════════════════════════════════════════════
function cleanHostileMobs() {
  let removed = 0;

  // Cache player positions once
  const playerPositions = [];
  for (const p of world.getPlayers()) {
    try { playerPositions.push({ x: p.location.x, y: p.location.y, z: p.location.z, dim: p.dimension.id }); } catch {}
  }

  for (const dimId of DIMS) {
    try {
      const dim = world.getDimension(dimId);

      // Query each hostile type individually (type-filtered = faster than full scan)
      for (const typeId of HOSTILE_ARRAY) {
        if (PROTECTED.has(typeId)) continue;
        try {
          for (const e of dim.getEntities({ type: typeId })) {
            try {
              if (e.nameTag && e.nameTag.trim()) continue;

              // Distance check — skip entities near players
              const loc = e.location;
              let nearPlayer = false;
              for (const pp of playerPositions) {
                if (pp.dim !== dimId) continue;
                const dx = loc.x - pp.x, dy = loc.y - pp.y, dz = loc.z - pp.z;
                if (dx * dx + dy * dy + dz * dz < SAFE_DIST_SQ) { nearPlayer = true; break; }
              }
              if (nearPlayer) continue;

              e.remove();
              removed++;
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }
  return removed;
}

// ═══════════════════════════════════════════════════════════
// CLEAN GROUND ITEMS — type-filtered queries
// [PERF] Only queries "minecraft:item" and "minecraft:xp_orb"
// ═══════════════════════════════════════════════════════════
function cleanGroundItems() {
  let removed = 0;
  for (const dimId of DIMS) {
    try {
      const dim = world.getDimension(dimId);

      // Type-filtered: only items
      try {
        for (const e of dim.getEntities({ type: "minecraft:item" })) {
          try { e.remove(); removed++; } catch {}
        }
      } catch {}

      // Type-filtered: only xp orbs
      try {
        for (const e of dim.getEntities({ type: "minecraft:xp_orb" })) {
          try { e.remove(); removed++; } catch {}
        }
      } catch {}
    } catch {}
  }
  return removed;
}

// ═══════════════════════════════════════════════════════════
// THROTTLE CHECK — 40 tick interval (2 seconds)
// Separated from HUD to reduce unnecessary work
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  if (!_enabled) return;
  const tps = getTPSAverageLast(THROTTLE_AVG_SAMPLES);
  const prevCommitted = _lastLevel;
  updateCommittedThrottleLevel(getThrottleLevel(tps));
  const level = _lastLevel;
  const now = system.currentTick;

  // Alert admins on level change (level ter-commit, TPS = rata-rata ~6s)
  if (level > 0 && level !== prevCommitted) {
    const col = getTPSColor(tps);
    alertAdmins(
      `§8[§cMonitor§8] ${col}TPS §7~${THROTTLE_AVG_SAMPLES}s:§f${tps} §8- §eThrottle L${level}`,
    );
  }

  // Level 2+: Clean hostile mobs (independent cooldown)
  if (level >= 2 && now - _lastHostileCleanTick >= HOSTILE_COOLDOWN) {
    _lastHostileCleanTick = now;
    const mobsRemoved = cleanHostileMobs();
    _totalCleaned += mobsRemoved;
    if (mobsRemoved > 0) {
      alertAdmins(`§8[§cMonitor§8] §eAuto-clean: §f${mobsRemoved} §ehostile mob dihapus`);
    }
  }

  // [FIX] Level 3: Clean items — SEPARATE cooldown from hostile clean
  if (level >= 3 && now - _lastItemCleanTick >= ITEMS_COOLDOWN) {
    _lastItemCleanTick = now;
    const itemsRemoved = cleanGroundItems();
    _totalCleaned += itemsRemoved;
    if (itemsRemoved > 0) {
      alertAdmins(`§8[§cMonitor§8] §eAuto-clean: §f${itemsRemoved} §eitem/orb dihapus`);
    }
  }
}, 40);  // check every 2 seconds (was 20 = 1s)

// ═══════════════════════════════════════════════════════════
// HUD UPDATE — 20 tick interval (1 second), admin-only
// [PERF] Cache getPlayers() once, no double call
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  if (!_enabled) return;
  const tpsAvg = getTPSAverageLast(THROTTLE_AVG_SAMPLES);
  const level = _lastLevel;

  // [PERF] Single getPlayers() call
  const players = world.getPlayers();
  let hasMonitor = false;

  for (const p of players) {
    if (!isAdmin(p) || !p.hasTag("monitor")) continue;
    hasMonitor = true;

    const ec = getEntityCounts();
    const col = getTPSColor(tpsAvg);
    const lvl = level > 0 ? ` §c[L${level}]` : "";
    const bar = `${col}${tpsAvg} TPS${lvl} §8| §fE:${ec.total} §8| §cH:${ec.hostile} §8| §eI:${ec.items} §8| §bP:${players.length}`;
    setBar(p, bar, 15, 25);
  }

  // Early exit optimization — if no monitors, skip entirely next tick
  // (still checks because tags can change)
}, 20);

export function isThrottleEnabled() { return _enabled; }
export function setThrottleEnabled(v) { _enabled = v; }
export function getThrottleLevel_() { return _lastLevel; }
export function getTotalCleaned() { return _totalCleaned; }
export function resetTotalCleaned() { _totalCleaned = 0; }
export function manualCleanHostile() { return cleanHostileMobs(); }
export function manualCleanItems() { return cleanGroundItems(); }
