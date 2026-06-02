export const CFG = {
  COIN_OBJ:          "coin",
  ADMIN_TAG:         "mimi",

  // [PhD-v2] Pajak transfer FLAT 2% — hapus tiered bracket
  // Rationale (Fisher MV=PQ): transaction friction tinggi membunuh velocity.
  // Velocity saat ini 0.0159 (hoarding economy). Target: 0.04+ dalam 30 hari.
  // Real-world reference: QRIS 0.7%, Stripe 2.9% — 2% flat masih revenue-positive.
  // Daily limit 25k & free transfer 8x dipertahankan sebagai anti-abuse.
  TAX_PERCENT:        2,
  MIN_TRANSFER:       10,
  MAX_TRANSFER:       5_000,
  DAILY_LIMIT:        25_000,
  FREE_TRANSFERS:     8,
  // Flat tax — semua bracket extra 0 untuk backward compatibility dengan calcTax()
  TAX_BRACKETS: [
    { max: Infinity, extra: 0 },
  ],

  COOLDOWN_TICKS:     80,
  MAX_PENDING_REQ:    5,
  REQUEST_EXPIRE_MS:  5 * 60 * 1000,
  MAX_HISTORY:        20,
  MAX_GLOBAL_HIST:    10,

  K_HIST:        "bank:hist:",
  K_REQ_IN:      "bank:req_in:",
  K_DAILY:       "bank:daily:",
  K_SETTINGS:    "bank:settings",
  K_NOTIF_PEND:  "bank:notif_pend:",
  K_GLOBAL_HIST: "bank:global_hist",

  HR: "§8══════════════════════",
};