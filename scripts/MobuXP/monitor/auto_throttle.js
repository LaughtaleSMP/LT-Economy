// monitor/auto_throttle.js — Auto Throttle v4.0 — TPS Floor Controller
// ═══════════════════════════════════════════════════════════
// Target: TPS ≥ 15 — proactive & aggressive, invisible to players
//
// PHILOSOPHY:
//   - Clean entities FAR from players → gameplay untouched
//   - Lower thresholds → react BEFORE TPS drops below 15
//   - Mob cap enforcement → prevent lag before it happens
//   - Zero chat spam to players — admin-only alerts
//   - Sim distance + spawn control = invisible performance gains
//
// LEVELS:
//   L0 (≥18): No action — healthy
//   L1 (15-17): Preventive — clean far hostile only (>48 blocks), items untouched
//   L2 (12-14): Aggressive — clean hostile+items (>24), sim distance ↓
//   L3 (8-11): Heavy — clean close (>16), pause spawn, clear weather
//   L4 (<8):   Emergency — nuclear (>10), extended spawn pause
//
// ITEM CLEANUP POLICY:
//   - Items ONLY cleaned when TPS < 15 (Level 2+)
//   - MobCap items: 150 threshold, only cleans if TPS < 15
//   - Force clean: 200+ items regardless of TPS (truly abnormal)
//
// [PERF v4.0]:
//   - Reuse entity_counter cached data for mob cap checks (no extra queries)
//   - Player position cached once per clean cycle
//   - Family-based query for hostile cleanup (1 query/dim)
//   - Cooldown per level to prevent thrashing
// ═══════════════════════════════════════════════════════════

import { world, system } from "@minecraft/server";
import { getTPSAverageLast, getTPSColor } from "./tps_tracker.js";
import { getEntityCounts, DIMS } from "./entity_counter.js";
import { setBar } from "../shared/actionbar_manager.js";

const ADMIN_TAG = "mimi";

// ── Protected entities — never remove ──
const PROTECTED = new Set([
  "minecraft:villager_v2", "minecraft:wandering_trader",
  "minecraft:iron_golem", "minecraft:snow_golem",
  "minecraft:wither", "minecraft:ender_dragon", "minecraft:warden", "minecraft:elder_guardian",
  "minecraft:armor_stand", "minecraft:minecart", "minecraft:boat",
  "minecraft:chest_minecart", "minecraft:hopper_minecart",
  "minecraft:npc", "minecraft:player",
  "minecraft:shulker", // [FIX] Shulker mob jangan dihapus — penting di The End
]);

// ── Throttle tuning ──
const THROTTLE_AVG_SAMPLES = 4;   // ~4s avg (responsif)
const RISE_STABLE_CHECKS = 2;

// Safe distance per level (blocks) — semakin parah, radius aman semakin kecil
const LEVEL_SAFE_DIST = [999, 48, 24, 16, 10];
// Cooldowns per level (ticks)
const LEVEL_HOSTILE_CD = [9999, 200, 100, 60, 20];

// ── Mob cap (uses cached entity_counter data — no extra queries) ──
const MOB_CAP_HOSTILE = 100;
const CAP_SAFE_DIST = 32;
const CAP_CHECK_TICKS = 100;  // 5 detik

// ── Spawn pause durations per level (ticks) ──
const SPAWN_PAUSE_DUR = { 3: 600, 4: 1200 };  // L3=30s, L4=60s
const EMERGENCY_CD = 600;                    // 30s antar trigger

// ── Simulation distance ──
const DEFAULT_SIM_DIST = 6;
const REDUCED_SIM_DIST = 4;

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let _enabled = true;
let _lastHostileCleanTick = 0;
let _lastLevel = 0;
let _rawLevel = 0;
let _pendingRise = 0;
let _levelHoldRise = 0;
let _totalCleaned = 0;
let _lastAlertTick = 0;
let _spawnPaused = false;
let _simDistReduced = false;
let _lastEmergencyTick = 0;
let _lastMobCapAlertTick = 0;  // cooldown khusus MobCap chat (30s)
const MOB_CAP_ALERT_CD = 1200; // 30 detik

// ── Reusable player position cache ──
// [PERF] Built once, reused across all clean operations in the same tick
let _cachedPlayerPos = [];
let _cachedPlayerPosTick = -1;

function isAdmin(p) { try { return p.hasTag(ADMIN_TAG); } catch { return false; } }

function alertAdmins(msg) {
  const now = system.currentTick;
  if (now - _lastAlertTick < 60) return;
  _lastAlertTick = now;
  for (const p of world.getPlayers()) {
    if (isAdmin(p) && !p.hasTag("throttle_mute")) p.sendMessage(msg);
  }
}

// ═══════════════════════════════════════════════════════════
// THROTTLE LEVEL — v3.0 thresholds (react earlier)
// ═══════════════════════════════════════════════════════════
function getThrottleLevel(tps) {
  if (tps >= 18) return 0;
  if (tps >= 15) return 1;
  if (tps >= 12) return 2;
  if (tps >= 8) return 3;
  return 4;
}

function updateCommittedThrottleLevel(rawLevel) {
  _rawLevel = rawLevel;
  if (rawLevel < _lastLevel) {
    // Turun = langsung (recovery cepat)
    _lastLevel = rawLevel;
    _pendingRise = rawLevel;
    _levelHoldRise = 0;
    return;
  }
  if (rawLevel === _lastLevel) { _levelHoldRise = 0; return; }
  // Naik butuh konfirmasi
  if (rawLevel === _pendingRise) _levelHoldRise++;
  else { _pendingRise = rawLevel; _levelHoldRise = 1; }
  if (_levelHoldRise >= RISE_STABLE_CHECKS) {
    _lastLevel = rawLevel;
    _levelHoldRise = 0;
  }
}

// ═══════════════════════════════════════════════════════════
// PLAYER POSITION CACHE — built once per tick, reused across all clean ops
// [PERF] O(P) build, O(1) re-access within same tick
// ═══════════════════════════════════════════════════════════
function getPlayerPos() {
  const now = system.currentTick;
  if (_cachedPlayerPosTick === now) return _cachedPlayerPos;
  const pos = [];
  for (const p of world.getPlayers()) {
    try { pos.push({ x: p.location.x, y: p.location.y, z: p.location.z, dim: p.dimension.id }); } catch { }
  }
  _cachedPlayerPos = pos;
  _cachedPlayerPosTick = now;
  return pos;
}

function isNearPlayer(loc, dimId, playerPos, safeDistSq) {
  for (const pp of playerPos) {
    if (pp.dim !== dimId) continue;
    const dx = loc.x - pp.x, dy = loc.y - pp.y, dz = loc.z - pp.z;
    if (dx * dx + dy * dy + dz * dz < safeDistSq) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// CLEAN HOSTILE — families:["monster"] (1 query/dim, not 30+)
// ═══════════════════════════════════════════════════════════
function cleanHostileMobs(safeDist = 16) {
  const sq = safeDist * safeDist;
  let removed = 0;
  const pp = getPlayerPos();
  for (const dimId of DIMS) {
    try {
      const dim = world.getDimension(dimId);
      for (const e of dim.getEntities({ families: ["monster"] })) {
        try {
          if (PROTECTED.has(e.typeId)) continue;
          if (e.nameTag && e.nameTag.trim()) continue;
          if (isNearPlayer(e.location, dimId, pp, sq)) continue;
          e.remove();
          removed++;
        } catch { }
      }
    } catch { }
  }
  return removed;
}

// ── Protected item types — never remove even as ground drops ──
const PROTECTED_ITEMS = new Set([
  "minecraft:trident",
  "minecraft:elytra",
  "minecraft:totem_of_undying",
  "minecraft:enchanted_book",
  "minecraft:nether_star",
  // [FIX] Shulker box — semua varian warna dilindungi agar tidak hilang saat di-drop
  "minecraft:shulker_box",
  "minecraft:white_shulker_box",   "minecraft:orange_shulker_box",
  "minecraft:magenta_shulker_box", "minecraft:light_blue_shulker_box",
  "minecraft:yellow_shulker_box",  "minecraft:lime_shulker_box",
  "minecraft:pink_shulker_box",    "minecraft:gray_shulker_box",
  "minecraft:light_gray_shulker_box", "minecraft:cyan_shulker_box",
  "minecraft:purple_shulker_box",  "minecraft:blue_shulker_box",
  "minecraft:brown_shulker_box",   "minecraft:green_shulker_box",
  "minecraft:red_shulker_box",     "minecraft:black_shulker_box",
]);

function _isProtectedItem(e) {
  try {
    const comp = e.getComponent("minecraft:item");
    if (comp && comp.itemStack) return PROTECTED_ITEMS.has(comp.itemStack.typeId);
  } catch { }
  return false;
}

// ═══════════════════════════════════════════════════════════
// CLEAN ITEMS — only far from players (player-safe)
// ═══════════════════════════════════════════════════════════
function cleanItemsFar(safeDist = 32) {
  const sq = safeDist * safeDist;
  let removed = 0;
  const pp = getPlayerPos();
  for (const dimId of DIMS) {
    try {
      const dim = world.getDimension(dimId);
      // [PERF] 2 targeted queries instead of unfiltered getEntities
      for (const type of ["minecraft:item", "minecraft:xp_orb"]) {
        try {
          for (const e of dim.getEntities({ type })) {
            try {
              if (isNearPlayer(e.location, dimId, pp, sq)) continue;
              if (type === "minecraft:item" && _isProtectedItem(e)) continue;
              e.remove();
              removed++;
            } catch { }
          }
        } catch { }
      }
    } catch { }
  }
  return removed;
}

/** Clean ALL items (for manual clean button in UI) */
function cleanGroundItems() {
  let removed = 0;
  for (const dimId of DIMS) {
    try {
      const dim = world.getDimension(dimId);
      for (const type of ["minecraft:item", "minecraft:xp_orb"]) {
        try {
          for (const e of dim.getEntities({ type })) {
            try {
              if (type === "minecraft:item" && _isProtectedItem(e)) continue;
              e.remove(); removed++;
            } catch { }
          }
        } catch { }
      }
    } catch { }
  }
  return removed;
}

// ═══════════════════════════════════════════════════════════
// CLEAN PROJECTILES — arrows only (tridents are valuable, never remove)
// ═══════════════════════════════════════════════════════════
function cleanProjectiles() {
  let removed = 0;
  for (const dimId of DIMS) {
    try {
      const dim = world.getDimension(dimId);
      for (const e of dim.getEntities({ type: "minecraft:arrow" })) {
        try { e.remove(); removed++; } catch { }
      }
    } catch { }
  }
  return removed;
}

// ═══════════════════════════════════════════════════════════
// SPAWN PAUSE — gamerule domobspawning
// ═══════════════════════════════════════════════════════════
function pauseSpawn(durationTicks) {
  if (_spawnPaused) return;
  _spawnPaused = true;
  try { world.getDimension("minecraft:overworld").runCommand("gamerule domobspawning false"); } catch { }
  system.runTimeout(() => {
    _spawnPaused = false;
    try { world.getDimension("minecraft:overworld").runCommand("gamerule domobspawning true"); } catch { }
    alertAdmins(`§8[§aThrottle§8] §aMob spawn resumed.`);
  }, durationTicks);
}

// ═══════════════════════════════════════════════════════════
// SIMULATION DISTANCE CONTROL
// ═══════════════════════════════════════════════════════════
function reduceSimDist() {
  if (_simDistReduced) return;
  _simDistReduced = true;
  try { world.getDimension("minecraft:overworld").runCommand(`gamerule simulationdistance ${REDUCED_SIM_DIST}`); } catch { }
  alertAdmins(`§8[§eThrottle§8] §eSim dist → ${REDUCED_SIM_DIST}`);
}

function restoreSimDist() {
  if (!_simDistReduced) return;
  _simDistReduced = false;
  try { world.getDimension("minecraft:overworld").runCommand(`gamerule simulationdistance ${DEFAULT_SIM_DIST}`); } catch { }
  alertAdmins(`§8[§aThrottle§8] §aSim dist → ${DEFAULT_SIM_DIST}`);
}

// ═══════════════════════════════════════════════════════════
// MAIN THROTTLE CHECK — 40 tick (2s)
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  if (!_enabled) return;
  const tps = getTPSAverageLast(THROTTLE_AVG_SAMPLES);
  const prevCommitted = _lastLevel;
  updateCommittedThrottleLevel(getThrottleLevel(tps));
  const level = _lastLevel;
  const now = system.currentTick;

  // ── Alert admins on level change ──
  if (level !== prevCommitted) {
    if (level > 0) {
      alertAdmins(`§8[§cThrottle§8] ${getTPSColor(tps)}TPS §7avg:§f${tps} §8→ §eL${level}`);
    } else {
      alertAdmins(`§8[§aThrottle§8] §aTPS recovered §f${tps} §8→ §aL0`);
    }
  }

  // ── Recovery: restore sim distance when healthy ──
  if (level <= 1 && _simDistReduced) restoreSimDist();

  // ── Level 1+: Clean far hostile mobs ──
  if (level >= 1 && now - _lastHostileCleanTick >= LEVEL_HOSTILE_CD[level]) {
    _lastHostileCleanTick = now;
    const dist = LEVEL_SAFE_DIST[level];
    const removed = cleanHostileMobs(dist);
    _totalCleaned += removed;
    if (removed > 0) {
      alertAdmins(`§8[§eThrottle§8] §eL${level} hostile: §f${removed} §edihapus §8(>${dist}blk)`);
    }
  }


  // ── Level 2+: Reduce simulation distance ──
  if (level >= 2) reduceSimDist();

  // ── Level 3+: Pause spawn + clear weather + clean projectiles ──
  if (level >= 3 && now - _lastEmergencyTick >= EMERGENCY_CD) {
    _lastEmergencyTick = now;
    pauseSpawn(SPAWN_PAUSE_DUR[level] || 600);
    try { world.getDimension("minecraft:overworld").runCommand("weather clear"); } catch { }
    const proj = cleanProjectiles();
    _totalCleaned += proj;
    if (level >= 4) {
      // L4: broadcast singkat ke semua (1 baris, tidak spam)
      for (const p of world.getPlayers()) {
        try { p.sendMessage(`§8[§8Server§8]§8 §7Optimizing...`); } catch { }
      }
    }
    alertAdmins(
      `§8[§cThrottle§8] §cL${level} EMERGENCY §8— spawn paused ${(SPAWN_PAUSE_DUR[level] || 600) / 20}s` +
      (proj > 0 ? `, §f${proj} §eprojectile dihapus` : "")
    );
  }
}, 40);

// ═══════════════════════════════════════════════════════════
// MOB CAP ENFORCEMENT — uses cached entity_counter data (ZERO extra queries)
// Prevents entity count from growing to lag-causing levels
// [PERF v4.0] No more independent getEntityCounts() + cleanHostileMobs() double-scan
//   Only triggers actual clean queries when threshold exceeded
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  if (!_enabled) return;
  const ec = getEntityCounts();  // [PERF] This reads cached data, no queries
  const now = system.currentTick;

  // Hard cap hostile — only scan & clean if cached count exceeds threshold
  if (ec.hostile > MOB_CAP_HOSTILE) {
    const removed = cleanHostileMobs(CAP_SAFE_DIST);
    _totalCleaned += removed;
    if (removed > 0 && now - _lastMobCapAlertTick >= MOB_CAP_ALERT_CD) {
      _lastMobCapAlertTick = now;
      alertAdmins(`§8[§6MobCap§8] §eHostile §f${ec.hostile}§8>${MOB_CAP_HOSTILE}: §f${removed} §edihapus`);
    }
  }


}, CAP_CHECK_TICKS);

// Dual-layer density cap: chunk (20/type) + region 4×4 chunks (50/type).
// Dimension rotation: 1 dim/cycle → 3 queries instead of 9. Full scan every 30s.
// Per-family skip gate: if cached total < cap, no chunk can exceed → skip query.
const CHUNK_DENSITY_CAP    = 20;
const REGION_DENSITY_CAP   = 50;
const CHUNK_DENSITY_TRIGGER = 250;

const DENSITY_FAMILIES = Object.freeze(["monster", "animal", "villager"]);

// Boss/special mobs — never density-capped (separate from PROTECTED which guards throttle cleanup)
const DENSITY_PROTECTED = new Set([
  "minecraft:wither", "minecraft:ender_dragon", "minecraft:warden",
  "minecraft:elder_guardian", "minecraft:shulker",
]);

// Map family name → cached count accessor for skip gate
const _FAMILY_COUNT_KEY = Object.freeze({
  monster: "hostile", animal: "passive", villager: "villagers",
});

let _densityDimIdx = 0;

function _buildDensityMaps(entities) {
  const chunkMap  = new Map();
  const regionMap = new Map();
  for (const e of entities) {
    try {
      const tid = e.typeId;
      if (!tid || DENSITY_PROTECTED.has(tid)) continue;
      if (e.nameTag?.trim()) continue;
      const loc = e.location;
      const cx = Math.floor(loc.x) >> 4, cz = Math.floor(loc.z) >> 4;
      const ck = cx + "," + cz;
      const rk = (cx >> 2) + "," + (cz >> 2);

      let cm = chunkMap.get(ck);
      if (!cm) { cm = new Map(); chunkMap.set(ck, cm); }
      let rm = regionMap.get(rk);
      if (!rm) { rm = new Map(); regionMap.set(rk, rm); }

      let ca = cm.get(tid);
      if (!ca) { ca = []; cm.set(tid, ca); }
      ca.push(e);

      let ra = rm.get(tid);
      if (!ra) { ra = []; rm.set(tid, ra); }
      ra.push(e);
    } catch { }
  }
  return { chunkMap, regionMap };
}

// Zero-allocation cull: count alive in-place, remove from end without filter()
function _cullExcess(map, cap, alreadyRemoved) {
  let removed = 0;
  for (const [, typeMap] of map) {
    for (const [, entities] of typeMap) {
      let aliveCount = 0;
      for (let i = 0; i < entities.length; i++) {
        if (!alreadyRemoved.has(entities[i])) aliveCount++;
      }
      if (aliveCount <= cap) continue;
      let toRemove = aliveCount - cap;
      for (let i = entities.length - 1; i >= 0 && toRemove > 0; i--) {
        if (alreadyRemoved.has(entities[i])) continue;
        try { entities[i].remove(); alreadyRemoved.add(entities[i]); removed++; } catch { }
        toRemove--;
      }
    }
  }
  return removed;
}

system.runInterval(() => {
  if (!_enabled) return;
  const ec = getEntityCounts();
  if (ec.total <= CHUNK_DENSITY_TRIGGER) return;

  // Rotate 1 dimension per cycle — 3 queries/cycle instead of 9
  const dimId = DIMS[_densityDimIdx];
  _densityDimIdx = (_densityDimIdx + 1) % DIMS.length;

  let chunkRemoved = 0, regionRemoved = 0;

  try {
    const dim = world.getDimension(dimId);
    const removed = new Set();
    for (const family of DENSITY_FAMILIES) {
      // Skip gate: if global count for this family < cap, no chunk can exceed it
      const countKey = _FAMILY_COUNT_KEY[family];
      if (countKey && (ec[countKey] || 0) < CHUNK_DENSITY_CAP) continue;
      try {
        const entities = dim.getEntities({ families: [family] });
        const { chunkMap, regionMap } = _buildDensityMaps(entities);
        chunkRemoved  += _cullExcess(chunkMap,  CHUNK_DENSITY_CAP,  removed);
        regionRemoved += _cullExcess(regionMap, REGION_DENSITY_CAP, removed);
      } catch { }
    }
  } catch { }

  const total = chunkRemoved + regionRemoved;
  if (total > 0) {
    _totalCleaned += total;
    const parts = [];
    if (chunkRemoved  > 0) parts.push(`§f${chunkRemoved} §echunk(>${CHUNK_DENSITY_CAP})`);
    if (regionRemoved > 0) parts.push(`§f${regionRemoved} §eregion(>${REGION_DENSITY_CAP})`);
    alertAdmins(`§8[§6DensityCap§8] ${parts.join(" §7+ ")} §edihapus`);
  }
}, 200);

// ═══════════════════════════════════════════════════════════
// ADMIN HUD — 20 tick (1s), admins with "monitor" tag only
// NO player warnings (tanpa ganggu player)
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  if (!_enabled) return;
  const tpsAvg = getTPSAverageLast(THROTTLE_AVG_SAMPLES);
  const level = _lastLevel;
  const players = world.getPlayers();
  const ec = getEntityCounts();

  for (const p of players) {
    if (isAdmin(p) && p.hasTag("monitor")) {
      const col = getTPSColor(tpsAvg);
      const lvl = level > 0 ? ` §8[§cL${level}§8]§c` : "";
      const sim = _simDistReduced ? " §eSIM↓" : "";
      const sp = _spawnPaused ? " §cSP" : "";
      const bar = `${col}${tpsAvg} TPS${lvl}${sim}${sp} §8| §fE:${ec.total} §cH:${ec.hostile} §eI:${ec.items} §2V:${ec.villagers} §bP:${players.length}`;
      setBar(p, bar, 15, 25);
    }
  }
}, 20);

system.run(() => {
  try { world.getDimension("minecraft:overworld").runCommand("gamerule domobspawning true"); } catch { }
  try { world.getDimension("minecraft:overworld").runCommand(`gamerule simulationdistance ${DEFAULT_SIM_DIST}`); } catch { }
});

export function isThrottleEnabled() { return _enabled; }
export function setThrottleEnabled(v) { _enabled = v; }
export function getThrottleLevel_() { return _lastLevel; }
export function getTotalCleaned() { return _totalCleaned; }
export function resetTotalCleaned() { _totalCleaned = 0; }
export function isSpawnPaused() { return _spawnPaused; }
export function manualCleanHostile() { return cleanHostileMobs(16); }
export function manualCleanItems() { return cleanGroundItems(); }
export function isThrottleChatMuted(player) { try { return player.hasTag("throttle_mute"); } catch { return false; } }
export function toggleThrottleChatMute(player) {
  try {
    if (player.hasTag("throttle_mute")) { player.removeTag("throttle_mute"); return false; }
    else { player.addTag("throttle_mute"); return true; }
  } catch { return false; }
}
