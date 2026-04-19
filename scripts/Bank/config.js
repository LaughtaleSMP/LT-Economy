// ============================================================
// Bank/config.js — Konfigurasi Sistem Bank Koin
// Sesuaikan nilai di bawah untuk mengubah perilaku bank.
// ============================================================

export const CFG = {
  // ── Scoreboard (HARUS sama dengan Gacha) ─────────────────
  COIN_OBJ:          "coin",

  // ── Transfer ─────────────────────────────────────────────
  TAX_PERCENT:        5,         // Pajak bawaan (%) — admin bisa ubah via menu
  MIN_TRANSFER:       10,        // Minimal koin per transaksi
  MAX_TRANSFER:       5_000,   // Maksimal koin per transaksi
  DAILY_LIMIT:        25_000,   // Batas total transfer keluar per hari (reset tiap hari)

  // ── Cooldown ─────────────────────────────────────────────
  COOLDOWN_TICKS:     80,        // Cooldown buka menu bank (~4 detik @20tps)

  // ── Request Koin ─────────────────────────────────────────
  MAX_PENDING_REQ:    5,                // Maks request masuk tertunda per player
  REQUEST_EXPIRE_MS:  5 * 60 * 1000,   // Request kadaluarsa setelah 5 menit

  // ── Riwayat ──────────────────────────────────────────────
  MAX_HISTORY:        20,        // Maks entri riwayat per player

  // ── Admin ─────────────────────────────────────────────────
  ADMIN_TAG:         "mimi",     // Harus sama dengan tag admin Gacha

  // ── Storage Keys (jangan ubah kecuali migrasi) ───────────
  K_HIST:     "bank:hist:",      // + playerId  → array riwayat
  K_REQ_IN:   "bank:req_in:",   // + playerId  → array request masuk
  K_DAILY:    "bank:daily:",    // + playerId  → { total, date }
  K_SETTINGS: "bank:settings",  // global settings (tax, dll)

  // ── UI ───────────────────────────────────────────────────
  HR: "§8──────────────────",
};
