import { world, system } from "@minecraft/server";
import { getTPSAverageLast } from "./tps_tracker.js";

const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const DIM_SHORT = { "minecraft:overworld": "OW", "minecraft:nether": "N", "minecraft:the_end": "E" };
let _dimIndex = 0;

const _counts    = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0, total: 0 };
const _hostile   = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0 };
const _passive   = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0 };
const _items     = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0 };
const _villagers = { "minecraft:overworld": 0, "minecraft:nether": 0, "minecraft:the_end": 0 };
let _totalHostile = 0;
let _totalPassive = 0;
let _totalItems = 0;
let _totalVillagers = 0;

// [PERF] Known non-mob entity types — skip from total mob count
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
  "minecraft:player",
]);

// ═══════════════════════════════════════════════════════════
// ENTITY COUNTER — rotates 1 dimension per cycle (5s each, 15s full cycle)
// [PERF v2] Uses 3 targeted queries instead of 1 unfiltered getEntities()
//   - families:["monster"] for hostile count (engine-level filter, fast)
//   - type:"minecraft:item" for item count
//   - type:"minecraft:xp_orb" for XP orb count
//   When TPS < 12: skip entirely, keep last cached values
//   When TPS 12-15: extend interval to every other cycle (stagger)
// ═══════════════════════════════════════════════════════════
let _skipNext = false;

system.runInterval(() => {
  // [PERF] Hard skip when TPS is critically low — cached data is still valid
  const tpsAvg = getTPSAverageLast(4);
  if (tpsAvg < 12) return;

  // [PERF] When TPS is stressed (12-15), only scan every other cycle
  if (tpsAvg < 15) {
    _skipNext = !_skipNext;
    if (_skipNext) return;
  }

  const dimId = DIMS[_dimIndex];
  _dimIndex = (_dimIndex + 1) % DIMS.length;

  try {
    const dim = world.getDimension(dimId);

    let hostileCount = 0, itemCount = 0;

    // Query 1: Hostile mobs via engine-level family filter (fast)
    try {
      const hostiles = dim.getEntities({ families: ["monster"] });
      hostileCount = hostiles.length;
    } catch {}

    // Query 2+3: Items and XP orbs via engine-level type filter (fast)
    try {
      itemCount += dim.getEntities({ type: "minecraft:item" }).length;
    } catch {}
    try {
      itemCount += dim.getEntities({ type: "minecraft:xp_orb" }).length;
    } catch {}

    // Query 4: Passive via animal family (only when TPS healthy)
    let passiveCount = 0;
    if (tpsAvg >= 17) {
      try {
        passiveCount = dim.getEntities({ families: ["animal"] }).length;
      } catch {}
    }

    // Query 5: Villagers — always counted, breeding farms are a top lag source
    let villagerCount = 0;
    try {
      villagerCount = dim.getEntities({ families: ["villager"] }).length;
    } catch {}

    const totalInDim = hostileCount + itemCount + passiveCount + villagerCount;

    _counts[dimId]    = totalInDim;
    _hostile[dimId]   = hostileCount;
    _passive[dimId]   = passiveCount;
    _items[dimId]     = itemCount;
    _villagers[dimId] = villagerCount;

    _counts.total   = _counts["minecraft:overworld"] + _counts["minecraft:nether"] + _counts["minecraft:the_end"];
    _totalHostile   = _hostile["minecraft:overworld"] + _hostile["minecraft:nether"] + _hostile["minecraft:the_end"];
    _totalPassive   = _passive["minecraft:overworld"] + _passive["minecraft:nether"] + _passive["minecraft:the_end"];
    _totalItems     = _items["minecraft:overworld"]   + _items["minecraft:nether"]   + _items["minecraft:the_end"];
    _totalVillagers = _villagers["minecraft:overworld"] + _villagers["minecraft:nether"] + _villagers["minecraft:the_end"];
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
    passive: _totalPassive,
    items: _totalItems,
    villagers: _totalVillagers,
    hostilePerDim: {
      OW: _hostile["minecraft:overworld"],
      N:  _hostile["minecraft:nether"],
      E:  _hostile["minecraft:the_end"],
    },
    passivePerDim: {
      OW: _passive["minecraft:overworld"],
      N:  _passive["minecraft:nether"],
      E:  _passive["minecraft:the_end"],
    },
  };
}

export { DIMS, DIM_SHORT };
