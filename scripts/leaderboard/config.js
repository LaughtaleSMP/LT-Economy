export const LB_CFG = {
  COIN_OBJ:    "coin",
  ADMIN_TAG:   "mimi",

  WEEK_MS:     7 * 24 * 60 * 60 * 1000,
  CHECK_INTERVAL: 1200,

  REWARDS: [
    { rank: 1, coin: 5000, label: "§6#1" },
    { rank: 2, coin: 3000, label: "§f#2" },
    { rank: 3, coin: 1000, label: "§e#3" },
  ],

  STREAK_MULT: [
    { min: 2, mult: 1.25 },
    { min: 3, mult: 1.5 },
    { min: 5, mult: 2.0 },
  ],

  SCORE: {
    kill:  5,
    mine:  1,
    place: 1,
    pvp:   20,
  },

  CATEGORIES: [
    { id: "score",  label: "Keseluruhan", color: "§6", key: "score",  tex: "textures/items/nether_star" },
    { id: "kills",  label: "Top Killer",  color: "§c", key: "kills",  tex: "textures/items/diamond_sword" },
    { id: "mined",  label: "Top Miner",   color: "§b", key: "mined",  tex: "textures/items/diamond_pickaxe" },
    { id: "placed", label: "Top Builder", color: "§a", key: "placed", tex: "textures/items/brick" },
    { id: "pvp",    label: "Top PvP",     color: "§c", key: "pvp",    tex: "textures/items/iron_sword" },
    { id: "land",   label: "Top Land",    color: "§2", key: "land",   tex: "textures/items/map_empty", special: true },
  ],

  MAX_ENTRIES: 10,

  K_WEEK:    "lb:week",
  K_PREV:    "lb:prev",
  K_PENDING: "lb:pend:",
  K_STREAK:  "lb:streak:",

  HR:      "§8═══════════════════",
  HR_THIN: "§8───────────────────",
};
