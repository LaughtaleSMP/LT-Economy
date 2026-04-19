// Bank/config.js

export const CFG = {
  COIN_OBJ:          "coin",
  ADMIN_TAG:         "mimi",

  // Transfer
  TAX_PERCENT:        5,
  MIN_TRANSFER:       10,
  MAX_TRANSFER:       5_000,
  DAILY_LIMIT:        25_000,

  // Cooldown & request
  COOLDOWN_TICKS:     80,
  MAX_PENDING_REQ:    5,
  REQUEST_EXPIRE_MS:  5 * 60 * 1000,
  MAX_HISTORY:        20,

  // Storage keys
  K_HIST:        "bank:hist:",
  K_REQ_IN:      "bank:req_in:",
  K_DAILY:       "bank:daily:",
  K_SETTINGS:    "bank:settings",
  K_NOTIF_PEND:  "bank:notif_pend:",

  HR: "§8──────────────────",
};
