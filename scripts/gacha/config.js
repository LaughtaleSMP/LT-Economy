import { world } from "@minecraft/server";

export const CFG = {
  GEM_OBJ: "gem",
  COIN_OBJ: "coin",
  // ── Dynamic pricing (read from eco:pricing DP, cached 5 min) ──
  _pc: null, _pt: 0,
  get _pricing() {
    const now = Date.now();
    if (this._pc && now - this._pt < 300000) return this._pc;
    try {
      const raw = world.getDynamicProperty("eco:pricing");
      if (raw) { this._pc = JSON.parse(raw); this._pt = now; return this._pc; }
    } catch {}
    return null;
  },
  PT_COST_1: 10,
  PT_COST_10: 90,
  get EQ_COST_1()  { return this._pricing?.eq1  ?? 50; },
  get EQ_COST_10() { return this._pricing?.eq10 ?? 450; },
  GEM_REFUND: 5,
  ANIM_TICKS: 72,
  OPEN_TIMEOUT: 1200,
  GUARD_INT: 5,
  REVEAL_INT: 12,
  REVEAL_PAUSE: 22,
  PULL_CD: 40,
  PT_PITY_RARE: 300,
  // EQ pity = total investment / cost-per-pull, clamped [min, max]
  get EQ_PITY_RARE() { return Math.min(80, Math.max(30, Math.round(2000 / (this._pricing?.eq1 ?? 50)))); },
  get EQ_PITY_LEG()  { return Math.min(150, Math.max(60, Math.round(5000 / (this._pricing?.eq1 ?? 50)))); },
  MAX_PENDING: 50,
  ADMIN_TAG: "mimi",
  K_PT_STATS: "pg_s:",
  K_EQ_STATS: "eq_s:",
  K_EQ_PITY: "eq_py:",
  K_EQ_PEND: "eq_p:",
  K_HIST: "hist:",
  K_GLOBAL_HIST: "g_hist",
  K_DISC: "disc_codes",
  K_USED_DISC: "ud:",
  K_PLAYER_REG: "p_reg",
  K_PT_DATA: "pt_d:",
  K_IMPORT_PEND: "imp_p:",
  ACTIONBAR_INT: 10,
  ACTIONBAR_REFRESH: 55,
  CHEST_CACHE_TTL: 60,
  CHEST_SCAN_R: 5,
  CHEST_SCAN_Y: 3,
  LB_LIMIT: 10,
  EXPORT_VER_BULK: "GSALL5",
  CHUNK_SZ: 2800,
};

export const T = { GEM: "cg:", PTPY: "cpp:" };
export const CHEST_BASE = { PARTICLE: "minecraft:amethyst_block", EQUIPMENT: "minecraft:crying_obsidian" };
export const SLOT = { T: 4, B: 22, L2: 11, L1: 12, C: 13, R1: 14, R2: 15 };
export const R_KEYS = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
export const R_INIT = { C: "COMMON", U: "UNCOMMON", R: "RARE", E: "EPIC", L: "LEGENDARY" };
export const HR = "§8-----------------------";
export const EXPORT_VER = "GS5";
export const MARK = "\u00A70\u00A7r\u00A7k\u00A7r";

// [§10.5] Variable Ratio — murah tapi full OP butuh ~1 bulan (20 aktif player, 2j/hari)
// Near-miss zone (U+R) = 44% → tetap seru. RARE 12.7% → diamond ~tiap 8 pull.
// EPIC 2.6% → netherite tool ~tiap 38 pull. LEG 0.26% → jackpot ~tiap 380 pull.
export const R = {
  COMMON:    { color: "§7", label: "Biasa",      glass: "minecraft:gray_stained_glass_pane",   ptW: 55, eqW: 50 },
  UNCOMMON:  { color: "§a", label: "Tak Biasa",   glass: "minecraft:lime_stained_glass_pane",   ptW: 25, eqW: 30 },
  RARE:      { color: "§9", label: "Langka",      glass: "minecraft:blue_stained_glass_pane",   ptW: 13, eqW: 12 },
  EPIC:      { color: "§5", label: "Epik",        glass: "minecraft:purple_stained_glass_pane", ptW: 6,  eqW: 2.5 },
  LEGENDARY: { color: "§6", label: "Legendaris",  glass: "minecraft:yellow_stained_glass_pane", ptW: 1,  eqW: 0.25 },
};

export const PT_POOL = [
  { name: "Slime Trail", tag: "basic_slime", rarity: "COMMON", visual: "minecraft:slime_ball" },
  { name: "Cloud Trail", tag: "basic_cloud", rarity: "COMMON", visual: "minecraft:snowball" },
  { name: "Ice Trail", tag: "basic_ice", rarity: "COMMON", visual: "minecraft:packed_ice" },
  { name: "Static Ring", tag: "elite_stat", rarity: "UNCOMMON", visual: "minecraft:quartz" },
  { name: "Small Ring", tag: "elite_smallr", rarity: "UNCOMMON", visual: "minecraft:glowstone_dust" },
  { name: "SF Ring", tag: "elite_sf", rarity: "UNCOMMON", visual: "minecraft:gold_nugget" },
  { name: "Negative Ring", tag: "elite_neg", rarity: "UNCOMMON", visual: "minecraft:coal" },
  { name: "Gravity Aura", tag: "elite_gravity", rarity: "UNCOMMON", visual: "minecraft:ender_pearl" },
  { name: "E-Static Aura", tag: "epic_estat", rarity: "RARE", visual: "minecraft:amethyst_shard" },
  { name: "Sash Coil", tag: "epic_scoil", rarity: "RARE", visual: "minecraft:prismarine_shard" },
  { name: "Ash Coil", tag: "epic_acoil", rarity: "RARE", visual: "minecraft:iron_nugget" },
  { name: "Sash Coil II", tag: "epic_scoil2", rarity: "RARE", visual: "minecraft:emerald" },
  { name: "Ash Coil II", tag: "epic_acoil2", rarity: "RARE", visual: "minecraft:diamond" },
  { name: "Nature Tree", tag: "legendary_tree", rarity: "EPIC", visual: "minecraft:oak_sapling" },
  { name: "Leaf Storm", tag: "legendary_leaf", rarity: "EPIC", visual: "minecraft:wheat_seeds" },
  { name: "Portal Vortex", tag: "legendary_portal", rarity: "EPIC", visual: "minecraft:magma_cream" },
  { name: "Spectral Sword", tag: "legendary_sword", rarity: "EPIC", visual: "minecraft:blaze_rod" },
  { name: "Anya Special", tag: "adxP", rarity: "LEGENDARY", visual: "minecraft:nether_star" },
];

export const EQ_POOL = [
  // ================= COMMON (min. Besi — hadiah hiburan yang tetap berguna) =================
  { id: "minecraft:iron_sword", name: "Pedang Besi", rarity: "COMMON" },
  { id: "minecraft:iron_pickaxe", name: "Beliung Besi", rarity: "COMMON" },
  { id: "minecraft:iron_axe", name: "Kapak Besi", rarity: "COMMON" },
  { id: "minecraft:iron_shovel", name: "Sekop Besi", rarity: "COMMON" },
  { id: "minecraft:iron_helmet", name: "Helm Besi", rarity: "COMMON" },
  { id: "minecraft:iron_boots", name: "Sepatu Besi", rarity: "COMMON" },
  { id: "minecraft:shield", name: "Perisai", rarity: "COMMON" },
  { id: "minecraft:bow", name: "Busur", rarity: "COMMON" },
  { id: "minecraft:arrow", name: "Panah x64", rarity: "COMMON", qty: 64 },
  { id: "minecraft:cooked_beef", name: "Steak x16", rarity: "COMMON", qty: 16 },
  { id: "minecraft:golden_carrot", name: "Wortel Emas x8", rarity: "COMMON", qty: 8 },
  { id: "minecraft:iron_ingot", name: "Iron Ingot x16", rarity: "COMMON", qty: 16 },
  { id: "minecraft:coal", name: "Batu Bara x32", rarity: "COMMON", qty: 32 },
  { id: "minecraft:experience_bottle", name: "Botol XP x8", rarity: "COMMON", qty: 8 },
  { id: "minecraft:lead", name: "Tali x4", rarity: "COMMON", qty: 4 },
  { id: "minecraft:name_tag", name: "Name Tag", rarity: "COMMON" },

  // ================= UNCOMMON (Besi lengkap + material berguna — "lumayan!") =================
  { id: "minecraft:iron_chestplate", name: "Baju Besi", rarity: "UNCOMMON" },
  { id: "minecraft:iron_leggings", name: "Celana Besi", rarity: "UNCOMMON" },
  { id: "minecraft:crossbow", name: "Crossbow", rarity: "UNCOMMON" },
  { id: "minecraft:golden_apple", name: "Apel Emas x4", rarity: "UNCOMMON", qty: 4 },
  { id: "minecraft:ender_pearl", name: "Ender Pearl x8", rarity: "UNCOMMON", qty: 8 },
  { id: "minecraft:obsidian", name: "Obsidian x16", rarity: "UNCOMMON", qty: 16 },
  { id: "minecraft:fishing_rod", name: "Joran Pancing", rarity: "UNCOMMON" },
  { id: "minecraft:experience_bottle", name: "Botol XP x32", rarity: "UNCOMMON", qty: 32 },
  { id: "minecraft:saddle", name: "Pelana", rarity: "UNCOMMON" },
  { id: "minecraft:lapis_lazuli", name: "Lapis Lazuli x32", rarity: "UNCOMMON", qty: 32 },
  { id: "minecraft:emerald", name: "Emerald x8", rarity: "UNCOMMON", qty: 8 },
  { id: "minecraft:firework_rocket", name: "Kembang Api x32", rarity: "UNCOMMON", qty: 32 },
  { id: "minecraft:diamond", name: "Diamond x16", rarity: "UNCOMMON", qty: 16 },
  { id: "minecraft:blaze_rod", name: "Blaze Rod x16", rarity: "UNCOMMON", qty: 16 },

  // ================= RARE (Diamond gear + item langka — "seru!") =================
  { id: "minecraft:diamond_sword", name: "Pedang Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_pickaxe", name: "Beliung Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_axe", name: "Kapak Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_shovel", name: "Sekop Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_helmet", name: "Helm Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_chestplate", name: "Baju Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_leggings", name: "Celana Diamond", rarity: "RARE" },
  { id: "minecraft:diamond_boots", name: "Sepatu Diamond", rarity: "RARE" },
  { id: "minecraft:trident", name: "Trident", rarity: "RARE" },
  { id: "minecraft:totem_of_undying", name: "Totem Abadi", rarity: "RARE" },
  { id: "minecraft:golden_apple", name: "Apel Emas x8", rarity: "RARE", qty: 8 },
  { id: "minecraft:emerald", name: "Emerald x32", rarity: "RARE", qty: 32 },
  { id: "minecraft:netherite_scrap", name: "Netherite Scrap x2", rarity: "RARE", qty: 2 },
  { id: "minecraft:ghast_tear", name: "Ghast Tear x4", rarity: "RARE", qty: 4 },
  { id: "minecraft:phantom_membrane", name: "Phantom Membrane x8", rarity: "RARE", qty: 8 },

  // ================= EPIC (Netherite tools + rare material — WOW!) =================
  // [§10.8 P2W] Hanya TOOLS, bukan armor. Armor harus di-craft sendiri (fair play).
  // [§10.6] Sidegrade: Netherite tool = convenience shortcut, bukan combat dominance.
  { id: "minecraft:netherite_sword", name: "Pedang Netherite", rarity: "EPIC" },
  { id: "minecraft:netherite_pickaxe", name: "Beliung Netherite", rarity: "EPIC" },
  { id: "minecraft:netherite_axe", name: "Kapak Netherite", rarity: "EPIC" },
  { id: "minecraft:enchanted_golden_apple", name: "Apel Ajaib x3", rarity: "EPIC", qty: 3 },
  { id: "minecraft:shulker_shell", name: "Shulker Shell x4", rarity: "EPIC", qty: 4 },
  { id: "minecraft:dragon_breath", name: "Dragon Breath x16", rarity: "EPIC", qty: 16 },
  { id: "minecraft:totem_of_undying", name: "Totem Abadi x2", rarity: "EPIC", qty: 2 },
  { id: "minecraft:netherite_scrap", name: "Netherite Scrap x4", rarity: "EPIC", qty: 4 },

  // ================= LEGENDARY (Jackpot — broadcast ke server!) =================
  { id: "minecraft:netherite_block", name: "Blok Netherite", rarity: "LEGENDARY" },
  { id: "minecraft:mace", name: "Gada", rarity: "LEGENDARY" },
  { id: "minecraft:enchanted_golden_apple", name: "Apel Ajaib x10", rarity: "LEGENDARY", qty: 10 },
  { id: "minecraft:heavy_core", name: "Heavy Core", rarity: "LEGENDARY" },
  { id: "minecraft:nether_star", name: "Bintang Nether", rarity: "LEGENDARY" },
  { id: "minecraft:beacon", name: "Beacon", rarity: "LEGENDARY" },
  { id: "minecraft:elytra", name: "Elytra", rarity: "LEGENDARY" },
  { id: "minecraft:enchanted_book", name: "Wind Burst III", rarity: "LEGENDARY", enchants: [{ id: "wind_burst", level: 3 }] },
  { id: "minecraft:enchanted_book", name: "Swift Sneak III", rarity: "LEGENDARY", enchants: [{ id: "swift_sneak", level: 3 }] },
  { id: "minecraft:wither_skeleton_skull", name: "Wither Skull x3", rarity: "LEGENDARY", qty: 3 },
  { id: "minecraft:netherite_upgrade_smithing_template", name: "Netherite Upgrade", rarity: "LEGENDARY" },
];

export const PT_TAG_SET = new Set(PT_POOL.map(p => p.tag));
export const EQ_IDX = new Map(EQ_POOL.map((it, i) => [it.id, i]));

function buildWeighted(pool, wKey) {
  let total = 0;
  const items = pool.map(it => { const w = R[it.rarity][wKey]; total += w; return { item: it, w }; });
  return { items, total };
}
export const PT_WP = buildWeighted(PT_POOL, "ptW");
export const EQ_WP = buildWeighted(EQ_POOL, "eqW");
export const PT_TOTAL_W = PT_WP.total;
export const EQ_TOTAL_W = EQ_WP.total;
export const PT_RARE = PT_POOL.filter(i => R_KEYS.indexOf(i.rarity) >= 2);
export const EQ_RARE = EQ_POOL.filter(i => R_KEYS.indexOf(i.rarity) >= 2);
export const EQ_LEG = EQ_POOL.filter(i => i.rarity === "LEGENDARY");

export const rand = arr => arr[Math.floor(Math.random() * arr.length)];
export const randW = ({ items, total }) => {
  let r = Math.random() * total;
  for (const { item, w } of items) { r -= w; if (r <= 0) return item; }
  return items[items.length - 1].item;
};

export const SFX = {
  OPEN: { id: "random.click", pitch: 1.3, vol: 0.7 },
  PAY: { id: "random.orb", pitch: 0.8, vol: 1.0 },
  READY: { id: "block.chest.open", pitch: 1.2, vol: 1.0 },
  TIMEOUT: { id: "note.bass", pitch: 0.5, vol: 1.0 },
  BROKE: { id: "note.bass", pitch: 0.6, vol: 1.0 },
  CLAIM: { id: "random.levelup", pitch: 1.0, vol: 1.0 },
  TICK: { id: "note.pling", pitch: 1.5, vol: 0.35 },
  DUP: { id: "random.orb", pitch: 0.6, vol: 0.8 },
  LEG2: { id: "random.anvil_use", pitch: 0.4, vol: 1.0 },
  ADMIN: { id: "random.levelup", pitch: 1.8, vol: 1.0 },
  REVEAL: {
    COMMON: { id: "random.pop", pitch: 1.0, vol: 0.8 },
    UNCOMMON: { id: "random.orb", pitch: 1.1, vol: 1.0 },
    RARE: { id: "note.pling", pitch: 1.5, vol: 1.0 },
    EPIC: { id: "random.levelup", pitch: 1.3, vol: 1.0 },
    LEGENDARY: { id: "ambient.weather.thunder", pitch: 0.5, vol: 2.0 },
  },
};

export const activePlayers = new Map();
export const activeChests = new Map();
export const chestExpected = new Map();
export const lockSet = new Set();
export const lastPull = new Map();
export const pendingDisc = new Map();
export const chestCache = new Map();
export const lastActionBar = new Map();
export const pendingChestInteract = new Set();

export const ck = b => `${Math.floor(b.location.x)},${Math.floor(b.location.y)},${Math.floor(b.location.z)}`;
export const bar = (v, max, len = 10) => { const f = Math.min(Math.round(v / max * len), len); return `§e${"█".repeat(f)}§8${"█".repeat(len - f)}`; };
export const pctStr = (v, total) => total > 0 ? (v / total * 100).toFixed(1) : "0.0";
export const isMark = item => typeof item?.nameTag === "string" && item.nameTag.startsWith(MARK);