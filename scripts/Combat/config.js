export const CFG = {
  COIN_OBJ:   "coin",
  ADMIN_TAG:  "mimi",
  PVP_TAG:    "pvp:on",

  MIN_COIN_TO_ENABLE:  100,
  KILL_REWARD_PCT:     10,
  MIN_REWARD:          10,
  MAX_REWARD:          500,

  ILLEGAL_KILL_PENALTY_PCT: 20,
  ILLEGAL_KILL_MAX_PENALTY: 1000,
  ILLEGAL_KILL_KICK_THRESHOLD: 3,
  ILLEGAL_KILL_WINDOW_MS: 600_000,

  STREAK_MULTIPLIER: [
    { min: 0,  mult: 1.0 },
    { min: 3,  mult: 1.5 },
    { min: 5,  mult: 2.0 },
    { min: 10, mult: 3.0 },
  ],
  STREAK_DECAY_MS:      600_000,

  COMBAT_TAG_TICKS:     300,
  COMBAT_LOG_PCT:       15,
  KILL_CD_MS:           60_000,
  GLOBAL_KILL_CD_MS:    30_000,
  TOGGLE_CD_TICKS:      200,
  SAFE_TICKS:           100,

  HUD_INT:              40,
  DEFAULT_HUD_MODE:     "sidebar",

  LAND_DP_KEY:          "mimi_land",

  K_STATS:       "cs:",
  K_LOG:         "c:log",
  K_HUD_MODE:    "ch:",
  K_HUD_ENABLED: "cho:",
  K_DEBT:        "cd:",

  HR:       "§8═══════════════════",
  HR_THIN:  "§8───────────────────",
};
