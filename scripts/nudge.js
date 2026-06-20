// nudge.js — Visibility nudge: random tip 1 baris di header form populer.
//
// Tujuan: surface fitur baru (gem premium) di hot path tanpa spam.
// Dipanggil saat build body form Bank/Store. Return string (1 baris) atau ""
// kalau player sudah lihat tip hari ini.
//
// Iron rule compliance:
// - 1 DP write per player per hari max (timestamp di player DP entity, bukan world)
// - Tidak ada per-tick / per-event setDynamicProperty
// - Storage di player DP supaya tidak makan budget world DP 1MB

import { pGetRaw, pSetRaw } from "./player_dp.js";
import { bumpMetric } from "./welcome_metrics.js";
import { TOPUP_URL } from "./topup_info.js";

const K_TIP_LASTSHOWN = "tip:lastshown:";   // → UTC-day epoch (number)
const MS_PER_DAY      = 86_400_000;

// Pool of tips untuk gem promo. Rotate random supaya tidak monoton.
// Pertahankan ≤45 char per tip biar muat di body form (visual budget).
const TIPS = Object.freeze([
  `§e✦ §fTopup §8── §b${TOPUP_URL}`,
  `§e✦ §fTopup pertama §a+50%% bonus §8── §b${TOPUP_URL}`,
  `§b✦ §fBayar land pakai gem §a= diskon 99%%`,
  `§d✦ §fSkin partikel hanya bisa pakai §bGem`,
  `§e✦ §fGem §atidak naik §fsaat inflasi koin`,
  `§b✦ §fLihat detail §8── §e/guide §8→ §dGem`,
]);

function _utcDay() { return Math.floor(Date.now() / MS_PER_DAY); }

/**
 * Generate header tip string untuk insert ke body form.
 * Idempotent per hari: sekali tampil, sisa hari ini tidak akan muncul lagi.
 *
 * @param {Player} player
 * @returns {string} — 1 line (with trailing \n) atau "" kalau cooldown
 */
export function getNudgeLine(player) {
  if (!player) return "";
  try {
    const last = pGetRaw(player, K_TIP_LASTSHOWN);
    const today = _utcDay();
    if (typeof last === "number" && last >= today) return "";

    // Belum lihat hari ini — pilih 1 tip random, mark lastshown.
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    try { pSetRaw(player, K_TIP_LASTSHOWN, today); } catch {}
    bumpMetric("nudge_shown");
    return `  ${tip}\n`;
  } catch { return ""; }
}
