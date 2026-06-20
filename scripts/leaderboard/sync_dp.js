/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_dp.js — DP helpers (read + chunked read)

   Self-contained — tidak import dari module DP lain agar
   sync layer tetap lean dan tidak bergantung pada gacha config.

   Re-export gacha key constants (GK) yang dibutuhkan untuk
   membaca registry & stats player.
   ══════════════════════════════════════════════════════════════ */

import { world } from "@minecraft/server";

export function dpRead(k) {
  try { return world.getDynamicProperty(k); } catch { return undefined; }
}

export function dpGet(k, def) {
  try {
    const raw = dpRead(k);
    if (raw === undefined || raw === null) return def;
    return JSON.parse(raw) ?? def;
  } catch { return def; }
}

export function dpGetChunked(baseKey, def) {
  try {
    const n = dpRead(baseKey + "_cn");
    if (typeof n === "number" && n > 0) {
      let str = "";
      for (let i = 0; i < n; i++) str += (dpRead(baseKey + "_c" + i) ?? "");
      if (!str) return def;
      return JSON.parse(str) ?? def;
    }
    const raw = dpRead(baseKey);
    if (raw !== undefined && raw !== null) return JSON.parse(raw) ?? def;
    return def;
  } catch { return def; }
}

/* ── Gacha DP keys (hardcoded to avoid heavy gacha/config.js import) ── */
export const GK = {
  PLAYER_REG: "p_reg",
  PT_STATS:   "pg_s:",
  EQ_STATS:   "eq_s:",
  COIN_OBJ:   "coin",
  GEM_OBJ:    "gem",
};
