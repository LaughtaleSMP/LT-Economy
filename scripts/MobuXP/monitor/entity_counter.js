// monitor/entity_counter.js — Optimized Entity Counter v2.0
// [PERF] Type-filtered queries instead of full getEntities() scan
// [PERF] Round-robin 1 dimension per tick (stagger load across 3 ticks)

import { world, system } from "@minecraft/server";

const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const DIM_SHORT = { "minecraft:overworld": "OW", "minecraft:nether": "N", "minecraft:the_end": "E" };
let _dimIndex = 0;

// Cached counts per dimension
const _counts  = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0, total: 0 };
const _hostile = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0 };
const _items   = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0 };
let _totalHostile = 0;
let _totalItems = 0;

const HOSTILE_IDS = new Set([
  "minecraft:zombie", "minecraft:zombie_villager", "minecraft:husk", "minecraft:drowned",
  "minecraft:skeleton", "minecraft:stray", "minecraft:creeper", "minecraft:spider",
  "minecraft:cave_spider", "minecraft:enderman", "minecraft:witch", "minecraft:slime",
  "minecraft:phantom", "minecraft:endermite", "minecraft:silverfish", "minecraft:vex",
  "minecraft:blaze", "minecraft:ghast", "minecraft:magma_cube", "minecraft:wither_skeleton",
  "minecraft:hoglin", "minecraft:zoglin", "minecraft:piglin_brute",
  "minecraft:pillager", "minecraft:vindicator", "minecraft:evoker", "minecraft:ravager",
  "minecraft:breeze", "minecraft:shulker",
]);

// Convert Set to Array once for type-filtered queries
const HOSTILE_ARRAY = [...HOSTILE_IDS];

// ═══════════════════════════════════════════════════════════
// SCAN INTERVAL — 100 tick (5s), 1 dim per tick = ~15s full cycle
// [PERF v2] Hostile count: 1x families:["monster"] query
//           Items: 2x type queries (item + xp_orb)
//           Total: 1x unfiltered .length
//           = 4 getEntities() calls total (was 33)
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  const dimId = DIMS[_dimIndex];
  _dimIndex = (_dimIndex + 1) % DIMS.length;

  try {
    const dim = world.getDimension(dimId);

    // Count items + xp_orbs — 2 cheap type-filtered queries
    let itemCount = 0;
    try { itemCount += dim.getEntities({ type: "minecraft:item" }).length; } catch {}
    try { itemCount += dim.getEntities({ type: "minecraft:xp_orb" }).length; } catch {}

    // [PERF] Count hostile mobs — 1 query via families filter (was 30 queries)
    let hostileCount = 0;
    try { hostileCount = dim.getEntities({ families: ["monster"] }).length; } catch {}

    // Total entity count — single unfiltered call, just .length (no iteration)
    let totalInDim = 0;
    try { totalInDim = dim.getEntities().length; } catch {}

    _counts[dimId]   = totalInDim;
    _hostile[dimId]  = hostileCount;
    _items[dimId]    = itemCount;

    // Recompute totals
    _counts.total = _counts["minecraft:overworld"] + _counts["minecraft:nether"] + _counts["minecraft:the_end"];
    _totalHostile = _hostile["minecraft:overworld"] + _hostile["minecraft:nether"] + _hostile["minecraft:the_end"];
    _totalItems   = _items["minecraft:overworld"]   + _items["minecraft:nether"]   + _items["minecraft:the_end"];
  } catch {}
}, 100);

export function getEntityCounts() {
  return {
    total: _counts.total,
    perDim: {
      OW: _counts["minecraft:overworld"],
      N:  _counts["minecraft:nether"],
      E:  _counts["minecraft:the_end"],
    },
    hostile: _totalHostile,
    items: _totalItems,
    hostilePerDim: {
      OW: _hostile["minecraft:overworld"],
      N:  _hostile["minecraft:nether"],
      E:  _hostile["minecraft:the_end"],
    },
  };
}

export { HOSTILE_IDS, HOSTILE_ARRAY, DIMS, DIM_SHORT };
