// topup_info.js — Single source of truth untuk topup metadata.
// Cross-pack note: Mimi Land sync manual di config.js (`topup-url`).

export const TOPUP_URL = "store.laughtale.my.id";

// ── First-topup bonus (P0 funnel) ───────────────────────────
// Bonus diberikan sekali per player saat topup pertama. Gem-only.
// Tujuan: kickstart konversi (target penetrasi gem 10%+).
//
// Tuning history:
//   v1 (2026-05) — BONUS_PCT 0.5  (+50%, multiplier 1.5×)
//   v2 (2026-05) — BONUS_PCT 1.0  (+100%, multiplier 2× — promo "Gem ×2")
//
// Mengubah angka di sini → otomatis sync ke welcome chat, panel guide,
// broadcast, dan sync_topup logic. JANGAN duplikasi di tempat lain.
export const FIRST_TOPUP_BONUS_PCT  = 1.0;
export const FIRST_TOPUP_DISPLAY_PCT = Math.round(FIRST_TOPUP_BONUS_PCT * 100);
// Multiplier total receive: bayar X gem → terima MULT × X gem (sekali).
export const FIRST_TOPUP_MULTIPLIER  = 1 + FIRST_TOPUP_BONUS_PCT;
// Currencies eligible — ekspansi ke "coin" perlu review behavioral §5.2.
export const FIRST_TOPUP_CURRENCIES  = Object.freeze(new Set(["gem"]));
