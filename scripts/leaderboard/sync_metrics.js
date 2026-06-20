/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_metrics.js — Server performance metrics builder

   buildServerMetrics() — full metrics for web monitor.

   Cache strategy:
   - When TPS < 15 (shouldSkipHeavy()): use cached entity_counter data
   - When TPS >= 15: full per-dimension scan + chunk density heatmap
   - Full-sync exclusive fields cached into `cachedFullExtras` for
     reuse by micro-sync (so web never loses data between full syncs)
   ══════════════════════════════════════════════════════════════ */

import { world, system } from "@minecraft/server";
import { getTPS } from "../MobuXP/monitor/tps_tracker.js";
import { getEntityCounts } from "../MobuXP/monitor/entity_counter.js";
import { shouldSkipHeavy } from "../MobuXP/shared/tps_gate.js";
import { pushWeatherHistory } from "./sync_history.js";

/* ── Non-mob entity types to exclude from mob count ── */
const NON_MOB_TYPES = new Set([
  "minecraft:item", "minecraft:xp_orb", "minecraft:arrow",
  "minecraft:thrown_trident", "minecraft:fishing_hook",
  "minecraft:area_effect_cloud", "minecraft:ender_pearl",
  "minecraft:egg", "minecraft:snowball", "minecraft:fireball",
  "minecraft:small_fireball", "minecraft:wither_skull",
  "minecraft:shulker_bullet", "minecraft:dragon_fireball",
  "minecraft:evocation_fang", "minecraft:lingering_potion",
  "minecraft:splash_potion", "minecraft:fireworks_rocket",
  "minecraft:tnt", "minecraft:falling_block", "minecraft:leash_knot",
  "minecraft:boat", "minecraft:chest_boat", "minecraft:minecart",
  "minecraft:chest_minecart", "minecraft:hopper_minecart",
  "minecraft:tnt_minecart", "minecraft:command_block_minecart",
  "minecraft:lightning_bolt", "minecraft:painting", "minecraft:item_frame",
  "minecraft:glow_item_frame", "minecraft:armor_stand",
  "minecraft:wind_charge", "minecraft:breeze_wind_charge_projectile",
]);

const DIMENSIONS = [
  { key: "overworld", short: "o", id: "minecraft:overworld" },
  { key: "nether",    short: "n", id: "minecraft:nether" },
  { key: "the_end",   short: "e", id: "minecraft:the_end" },
];

/**
 * Cache for full-sync exclusive fields. Mutable object shared between
 * full sync (writer) and micro sync (reader) so web monitor never
 * loses breakdown / hotspots / land claims data.
 */
export const cachedFullExtras = {};

/**
 * Build server performance metrics for web monitor.
 * Returns metrics object ready to JSON.stringify.
 */
export function buildServerMetrics() {
  const m = _initMetricsShape();

  try { m.tick = system.currentTick; } catch {}

  _populatePlayerData(m);
  _populateEntityData(m);
  _populateDpData(m);
  _populateWorldTime(m);
  _populateWeather(m);
  _populateLandClaims(m);

  return m;
}

// ── Builder steps ───────────────────────────────────────────

function _initMetricsShape() {
  return {
    ts: Date.now(),
    tps: getTPS(),
    players_online: 0,
    entities: { overworld: 0, nether: 0, the_end: 0, total: 0 },
    mobs:     { overworld: 0, nether: 0, the_end: 0, total: 0 },
    items:    { overworld: 0, nether: 0, the_end: 0, total: 0 },
    players_per_dim: { overworld: 0, nether: 0, the_end: 0 },
    player_details: [],
    tick: 0,
  };
}

function _populatePlayerData(m) {
  try {
    const allPlayers = world.getPlayers();
    m.players_online = allPlayers.length;
    for (const p of allPlayers) {
      try {
        const dimId = p.dimension?.id || "minecraft:overworld";
        const dimKey = dimId.replace("minecraft:", "");
        if (m.players_per_dim[dimKey] !== undefined) m.players_per_dim[dimKey]++;

        const detail = { name: p.name, dim: dimKey };
        try {
          const loc = p.location;
          detail.x = Math.floor(loc.x);
          detail.y = Math.floor(loc.y);
          detail.z = Math.floor(loc.z);
        } catch {}
        try { detail.gamemode = p.getGameMode?.() || "unknown"; } catch {}
        try { detail.pvp = p.hasTag("pvp:on"); } catch {}
        m.player_details.push(detail);
      } catch {}
    }
  } catch {}
}

function _populateEntityData(m) {
  // TPS-aware: low TPS reuses cached entity_counter data
  if (shouldSkipHeavy()) {
    _populateFromCache(m);
  } else {
    _populateFromFullScan(m);
  }
}

function _populateFromCache(m) {
  const ec = getEntityCounts();
  m.entities.overworld = ec.perDim.OW;
  m.entities.nether    = ec.perDim.N;
  m.entities.the_end   = ec.perDim.E;
  m.entities.total     = ec.total;
  m.mobs.total         = ec.hostile + ec.passive + (ec.villagers || 0);
  m.items.total        = ec.items;
  if (cachedFullExtras.entity_breakdown) m.entity_breakdown = cachedFullExtras.entity_breakdown;
  if (cachedFullExtras.entity_hotspots)  m.entity_hotspots  = cachedFullExtras.entity_hotspots;
}

function _populateFromFullScan(m) {
  const typeCounts = {};
  const chunkCounts = {};
  const chunkTypes = {};  // per-chunk entity type breakdown for hotspot recommendations

  for (const d of DIMENSIONS) {
    try {
      const dim = world.getDimension(d.id);
      let entTotal = 0, mobCount = 0, itemCount = 0;

      for (const e of dim.getEntities()) {
        entTotal++;
        const tid = e.typeId || "";
        if (tid === "minecraft:player") continue;

        const short = tid ? tid.replace("minecraft:", "") : "";
        if (short) {
          typeCounts[short] = (typeCounts[short] || 0) + 1;
        }

        // Collect chunk position for entity density heatmap
        try {
          const loc = e.location;
          const cx = Math.floor(loc.x) >> 4;
          const cz = Math.floor(loc.z) >> 4;
          const ck = d.short + ':' + cx + ',' + cz;
          chunkCounts[ck] = (chunkCounts[ck] || 0) + 1;
          // Track entity types per chunk (for hotspot recommendations)
          if (short) {
            if (!chunkTypes[ck]) chunkTypes[ck] = {};
            chunkTypes[ck][short] = (chunkTypes[ck][short] || 0) + 1;
          }
        } catch {}

        if (tid === "minecraft:item") { itemCount++; continue; }
        if (!NON_MOB_TYPES.has(tid)) { mobCount++; }
      }

      m.entities[d.key] = entTotal;
      m.entities.total += entTotal;
      m.mobs[d.key] = mobCount;
      m.mobs.total += mobCount;
      m.items[d.key] = itemCount;
      m.items.total += itemCount;
    } catch {}
  }

  m.entity_breakdown = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, count]) => ({ id, count }));

  m.entity_hotspots = Object.entries(chunkCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k, c]) => {
      const parts = k.split(':');
      const [cx, cz] = parts[1].split(',').map(Number);
      // Top 3 entity types in this chunk for actionable recommendations
      const ct = chunkTypes[k] || {};
      const top = Object.entries(ct)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, n]) => t + ':' + n);
      return { d: parts[0], x: cx * 16 + 8, z: cz * 16 + 8, c, top };
    });

  // Cache for micro-sync (so web monitor always has breakdown data)
  cachedFullExtras.entity_breakdown = m.entity_breakdown;
  cachedFullExtras.entity_hotspots  = m.entity_hotspots;
}

function _populateDpData(m) {
  try {
    const totalBytes = world.getDynamicPropertyTotalByteCount?.() ?? 0;
    m.dp_bytes = totalBytes;
    m.dp_max = 1_048_576;
    m.dp_pct = totalBytes > 0 ? Math.round(totalBytes / 1_048_576 * 100) : 0;

    m.dp_breakdown = _buildDpBreakdown();

    cachedFullExtras.dp_bytes     = m.dp_bytes;
    cachedFullExtras.dp_max       = m.dp_max;
    cachedFullExtras.dp_pct       = m.dp_pct;
    cachedFullExtras.dp_breakdown = m.dp_breakdown;
  } catch {}
}

function _buildDpBreakdown() {
  const allIds = world.getDynamicPropertyIds();
  const cats = {
    Gacha:   { pfx: ["pg_s:","eq_s:","eq_py:","eq_p:","hist:","ud:","imp_p:","p_reg","g_hist","gacha:pend_gem:","gacha:pend_coin:","gacha:sess_ref:"], keys: 0, bytes: 0 },
    Daily:   { pfx: ["daily:login:","daily:quest:","daily:weekly:","daily:monthly:","daily:stats:"], keys: 0, bytes: 0 },
    Bank:    { pfx: ["bank:hist:","bank:global_hist","bank:req_in:","bank:daily:","bank:notif_pend:"], keys: 0, bytes: 0 },
    Auction: { pfx: ["auc:notif:","auc:pend:","auc:pend_coin:","auc:tx:","auc:hist"], keys: 0, bytes: 0 },
    Combat:  { pfx: ["cs:","ch:","cho:","cd:","cdm:","c:log"], keys: 0, bytes: 0 },
    Land:    { pfx: ["mimi_land","mimi:ls:"], keys: 0, bytes: 0 },
    System:  { pfx: ["_ls:","mcleaner:","welcome:seen:","xp:daily_coin:","disc_codes"], keys: 0, bytes: 0 },
  };

  for (const id of allIds) {
    for (const info of Object.values(cats)) {
      let matched = false;
      for (const pfx of info.pfx) {
        if (id === pfx || id.startsWith(pfx)) { matched = true; break; }
      }
      if (matched) {
        info.keys++;
        // Estimate bytes from key name + average value size (avoid per-key DP reads)
        info.bytes += id.length + 120;
        break;
      }
    }
  }

  const out = {};
  for (const [cat, info] of Object.entries(cats)) {
    if (info.keys > 0) out[cat] = { k: info.keys, b: info.bytes };
  }
  return out;
}

function _populateWorldTime(m) {
  try {
    m.world_time = world.getTimeOfDay?.() ?? 0;
    m.world_day  = world.getDay?.() ?? 0;
    cachedFullExtras.world_day = m.world_day;
  } catch {}
}

// Weather transition tracker — in-memory log untuk forecasting di sisi web.
// Cap 50 transition. State hilang saat BDS restart (acceptable; web client juga punya local fallback).
let _wxLastState = null;        // 'clear' | 'rain' | 'thunder'
let _wxLastChangeMs = 0;        // ms timestamp transisi terakhir
let _wxLastChangeWT = 0;        // world_time saat transisi mulai (untuk tod field)
let _wxLastChangeDay = 0;       // world_day saat transisi mulai
const _WX_LOG_CAP = 50;
if (!cachedFullExtras.weather_log) cachedFullExtras.weather_log = [];

/**
 * Track weather transition. Dipanggil dari full-sync (_populateWeather) dan
 * juga dari micro-sync untuk menangkap transisi yang terjadi di antara full sync.
 * Idempotent — multiple calls dengan same state tidak menggandakan log.
 */
export function trackWeatherTransition(weatherStr) {
  const nowMs = Date.now();
  let curWT = 0, curDay = 0;
  try { curWT = world.getTimeOfDay?.() ?? 0; } catch {}
  try { curDay = world.getDay?.() ?? 0; } catch {}

  if (_wxLastState === null) {
    _wxLastState = weatherStr;
    _wxLastChangeMs = nowMs;
    _wxLastChangeWT = curWT;
    _wxLastChangeDay = curDay;
    cachedFullExtras.weather_since_ms = nowMs;
    return;
  }
  if (_wxLastState !== weatherStr) {
    const dur = nowMs - _wxLastChangeMs;
    // Filter: <30s (kemungkinan /weather command spam) atau >2 jam (server pause)
    if (dur >= 30000 && dur <= 7200000) {
      cachedFullExtras.weather_log.push({
        wx: _wxLastState,
        startMs: _wxLastChangeMs,
        endMs: nowMs,
        dur: dur
      });
      if (cachedFullExtras.weather_log.length > _WX_LOG_CAP) {
        cachedFullExtras.weather_log = cachedFullExtras.weather_log.slice(-_WX_LOG_CAP);
      }
      // Persist ke Supabase untuk akumulasi sample jangka panjang.
      // Fire-and-forget; gagal HTTP tidak block weather state update.
      try {
        pushWeatherHistory(_wxLastState, _wxLastChangeMs, nowMs, _wxLastChangeWT, _wxLastChangeDay);
      } catch (e) {
        console.warn("[WX-Push] " + (e?.message || e));
      }
    }
    _wxLastState = weatherStr;
    _wxLastChangeMs = nowMs;
    _wxLastChangeWT = curWT;
    _wxLastChangeDay = curDay;
    cachedFullExtras.weather_since_ms = nowMs;
  }
}

function _populateWeather(m) {
  try {
    const ow = world.getDimension("overworld");
    let weatherStr = "clear";
    try {
      const w = ow?.getWeather?.();
      if (w === "Rain") weatherStr = "rain";
      else if (w === "Thunder") weatherStr = "thunder";
    } catch {
      // API tidak available, default clear
    }
    m.weather = weatherStr;
    cachedFullExtras.weather = weatherStr;

    trackWeatherTransition(weatherStr);
    m.weather_log = cachedFullExtras.weather_log;
    m.weather_since_ms = cachedFullExtras.weather_since_ms;
  } catch {}
}

function _populateLandClaims(m) {
  try {
    const lands = _readLandClaimsFromBridge();
    if (lands && lands.length) {
      m.land_claims = lands;
      cachedFullExtras.land_claims = lands;
    } else if (cachedFullExtras.land_claims) {
      m.land_claims = cachedFullExtras.land_claims;
    }
  } catch {}
}

// Mimi Land claims via scoreboard cross-pack bridge.
// DPs are behavior-pack-scoped, so we use the _land_export
// scoreboard that Mimi Land addon writes to every 5 min.
function _readLandClaimsFromBridge() {
  const sb = world.scoreboard.getObjective("_land_export");
  if (!sb) return null;

  let chunkCount = 0;
  try { chunkCount = sb.getScore("_cc") || 0; } catch {}
  if (chunkCount <= 0) return null;

  // Reconstruct JSON from participant names
  const chunkMap = {};
  for (const p of sb.getParticipants()) {
    const name = p.displayName;
    if (!name || !name.startsWith("_c") || name === "_cc") continue;
    // Format: "_cINDEX:DATA"
    const colIdx = name.indexOf(":");
    if (colIdx < 0) continue;
    const idxStr = name.substring(2, colIdx);
    const data = name.substring(colIdx + 1);
    const idx = parseInt(idxStr);
    if (!isNaN(idx)) chunkMap[idx] = data;
  }

  // Assemble in order
  let raw = "";
  for (let i = 0; i < chunkCount; i++) raw += chunkMap[i] || "";
  if (raw.length <= 2) return null;

  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) return null;

  return entries.map(e => {
    if (typeof e === "string") {
      // Pipe-delimited: n|o|x1|z1|x2|z2|d|pub|daysInactive
      const p = e.split("|");
      return {
        n: p[0] || "?", o: p[1] || "?",
        x1: parseInt(p[2]) || 0, z1: parseInt(p[3]) || 0,
        x2: parseInt(p[4]) || 0, z2: parseInt(p[5]) || 0,
        d: p[6] || "o", pub: parseInt(p[7]) || 0,
        di: p[8] !== undefined ? parseInt(p[8]) : -1,
      };
    }
    return e;
  });
}
