// auction/config.js

export const CFG = {
  COIN_OBJ:         "coin",
  ADMIN_TAG:        "mimi",

  LISTING_FEE_PCT:  5,
  MAX_LISTINGS:     5,          // per player
  MAX_GLOBAL:       30,         // total active (30×700B ≈ 21KB, aman di bawah 32KB)
  MAX_BUYOUT:       500_000,
  MIN_PRICE:        10,
  DURATION_MS:      24 * 60 * 60 * 1000,   // 24 jam
  MAX_HIST:         15,
  COOLDOWN_TICKS:   60,
  BROADCAST_MIN_PRICE: 1_000,   // broadcast ke server jika harga >= ini
  PRUNE_INTERVAL:   200,        // ticks antara prune
  OLD_RETAIN_MS:    2 * 24 * 3600_000,  // hapus sold/expired setelah 2 hari
  DP_MAX_BYTES:     30_000,     // batas aman DP (32KB - margin)

  // Auction / Bidding War
  MIN_BID_INCREMENT:  50,                  // min increment absolut
  BID_INCREMENT_PCT:  10,                  // min increment % dari current bid
  ANTI_SNIPE_MS:      5 * 60 * 1000,      // extend 5 menit
  ANTI_SNIPE_THRESHOLD_MS: 5 * 60 * 1000, // threshold sebelum expired

  K_LISTINGS:       "auc:list",
  K_HIST:           "auc:hist",
  K_NOTIF:          "auc:notif:",
  K_PEND_ITEMS:     "auc:pend:",
  K_PEND_COIN:      "auc:pend_coin:",
  K_TX:             "auc:tx:",           // transaction journal per player
  K_SETTINGS:       "auc:cfg",

  // UI Design Tokens — matching Daily System premium style
  HR:       "§8═══════════════════",
  HR_THIN:  "§8───────────────────",
  SP:       "",
};

export const SFX = {
  OPEN:   { id: "random.click",   pitch: 1.3, vol: 0.7 },
  BUY:    { id: "random.orb",     pitch: 0.8, vol: 1.0 },
  SOLD:   { id: "random.levelup", pitch: 1.0, vol: 1.0 },
  LIST:   { id: "note.pling",     pitch: 1.2, vol: 0.8 },
  CANCEL: { id: "note.bass",      pitch: 0.6, vol: 0.8 },
  ADMIN:  { id: "random.levelup", pitch: 1.8, vol: 1.0 },
  OFFER:  { id: "note.pling",     pitch: 1.0, vol: 0.8 },
  BID:    { id: "note.pling",     pitch: 1.5, vol: 0.9 },
  OUTBID: { id: "note.bass",      pitch: 0.8, vol: 0.9 },
};

// ═══════════════════════════════════════════════════════════
// KATEGORI ITEM — untuk browse per kategori
// Diurutkan berdasarkan prioritas match (pertama yang cocok menang).
// ═══════════════════════════════════════════════════════════
export const CATEGORIES = [
  { id: "weapon",  label: "Senjata",        color: "§c", icon: "⚔",
    re: /sword|_bow$|bow$|crossbow|trident|mace/ },
  { id: "armor",   label: "Armor",          color: "§9", icon: "◆",
    re: /helmet|chestplate|leggings|boots|turtle_shell|elytra|shield/ },
  { id: "tool",    label: "Tools",          color: "§a", icon: "◆",
    re: /pickaxe|_axe|shovel|hoe|shears|fishing_rod|flint_and_steel|brush|spyglass|compass|clock|lead|name_tag/ },
  { id: "block",   label: "Blok & Material", color: "§6", icon: "■",
    re: /stone|cobble|dirt|sand|gravel|log|wood|plank|wool|concrete|glass|brick|ore|deepslate|ingot|nugget|raw_iron|raw_gold|raw_copper|diamond$|emerald$|amethyst|copper$|quartz|obsidian|netherrack|basalt|clay|dripstone|calcite|tuff/ },
  { id: "food",    label: "Makanan",        color: "§e", icon: "✦",
    re: /apple|bread|beef|pork|chicken|mutton|rabbit|cod|salmon|potato|carrot|melon_slice|cookie|cake|pumpkin_pie|stew|golden_apple|enchanted_golden_apple|sweet_berries|glow_berries|dried_kelp|cooked_|beetroot|honey_bottle/ },
  { id: "potion",  label: "Potion & Efek",  color: "§d", icon: "◆",
    re: /potion|splash_potion|lingering_potion|tipped_arrow|totem|ender_pearl|blaze_powder|ghast_tear|magma_cream|phantom_membrane|brewing_stand|ender_eye/ },
];

/** ID kategori fallback untuk item yang tidak cocok regex manapun */
export const CAT_OTHER    = { id: "other",     label: "Lainnya",   color: "§f", icon: "■" };
export const CAT_ENCHANTED = { id: "enchanted", label: "Enchanted", color: "§5", icon: "✦" };
