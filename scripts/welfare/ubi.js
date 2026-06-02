// ============================================================
// welfare/ubi.js — Universal Basic Income untuk player baru
//
// REFERENSI: Banerjee–Duflo (Nobel 2019) — "threshold exclusion"
// Player baru dengan saldo <median tidak bisa berpartisipasi ekonomi
// premium (gacha, land, auction). UBI mengangkat lantai dalam 7 hari
// pertama agar mereka bisa masuk ekonomi.
//
// MEKANIK:
//   - Player register ≤7 hari → +100 koin/login (sekali/hari)
//   - Bypass semua persyaratan subsidy (cap saldo, treasury minimum)
//   - Sumber dana: dicetak (injection) — legitimate karena menambah
//     produktivitas marginal, bukan hoarding.
//   - Anti-abuse: TIGHT — 1x/hari, pakai period key yang sama dengan
//     daily login, jadi tidak bisa di-exploit dengan relog.
//
// PERFORMA:
//   - Storage: 1 Player DP key "wlf:ubi" per player — {since, lastPeriod, total}
//   - CPU: O(1) per spawn, hanya untuk player first 7 hari
//   - DP writes: 1 write per UBI claim (piggyback on daily login flow)
//   - RAM: 0 persistent in-memory state (semua di Player DP)
//
// ============================================================

import { world, system } from "@minecraft/server";
import { pGet, pSet } from "../player_dp.js";
import { trackFlow } from "../eco_flow.js";
import { DAILY_CFG } from "../daily/config.js";

// ── Konstanta ────────────────────────────────────────────────
const COIN_OBJ          = "coin";
const UBI_KEY           = "wlf:ubi";
const UBI_AMOUNT        = 100;        // koin per hari
const UBI_DAYS          = 7;          // durasi sejak first register (hari)
const RESET_UTC_HOUR    = 13;         // 20:00 WIB — sinkron dengan daily/tax
const MS_PER_DAY        = 86_400_000;

// [PhD-v2] Anti-backfill: player dengan loginDays > EXISTING_THRESHOLD dianggap
// "sudah pernah login sebelum UBI deploy" dan tidak eligible. Ini mencegah
// semua player existing (500+) dari dapat 700 koin sekali jalan saat deploy.
const EXISTING_THRESHOLD = 2; // loginDays >= 2 → existing player, tidak eligible

function getCurrentPeriod() {
  return Math.floor((Date.now() - RESET_UTC_HOUR * 3_600_000) / MS_PER_DAY);
}

function fmt(n) { return Math.floor(n).toLocaleString("id-ID"); }

/**
 * Cek apakah player ini "existing" (sudah main sebelum UBI deploy).
 * Proxy: kalau login totalDays >= threshold, sudah existing.
 *
 * @param {Player} player
 * @returns {boolean}
 */
function isExistingPlayer(player) {
  try {
    const loginData = pGet(player, DAILY_CFG.K_LOGIN, null);
    if (!loginData) return false; // benar-benar player baru
    const totalDays = loginData.totalDays || 0;
    return totalDays >= EXISTING_THRESHOLD;
  } catch { return false; }
}

/**
 * Claim UBI jika eligible. Dipanggil dari daily login flow.
 * Idempotent: kalau sudah claim hari ini, return null.
 *
 * @param {Player} player
 * @returns {{amount:number, day:number, remainingDays:number} | null}
 */
export function claimUbiIfEligible(player) {
  try {
    const period = getCurrentPeriod();
    const stored = pGet(player, UBI_KEY, null);

    // Path 1 — Fresh record (belum pernah UBI record dibuat)
    if (stored === null) {
      // Apakah ini existing player yang login pertama kali setelah UBI deploy?
      // Kita HARUS cek di sini, karena hook UBI dipanggil SETELAH processLogin
      // yang sudah menaikkan totalDays. Jadi threshold 2 artinya "sudah pernah
      // login minimal 2 hari" (login hari ini + 1 hari lain).
      if (isExistingPlayer(player)) {
        // Mark as "not eligible" dengan since = -1 sentinel, supaya cek cepat
        // di login berikutnya tanpa baca login data lagi.
        try { pSet(player, UBI_KEY, { since: -1, lastPeriod: -1, total: 0 }); } catch {}
        return null;
      }
      // Player benar-benar baru — inisialisasi record
      const initData = { since: period, lastPeriod: -1, total: 0 };
      return _grantUbi(player, initData, period, 0);
    }

    // Path 2 — Existing UBI record
    // Sentinel: since === -1 artinya "existing player yang tidak eligible"
    if (stored.since === -1) return null;

    // Sudah claim hari ini?
    if (stored.lastPeriod === period) return null;

    // Sudah melewati window 7 hari?
    const daysSinceJoin = period - stored.since;
    if (daysSinceJoin >= UBI_DAYS) return null;

    // Sanity: since di masa depan (shouldn't happen) → recovery
    if (daysSinceJoin < 0) {
      stored.since = period; // reset to today
    }

    return _grantUbi(player, stored, period, Math.max(0, period - stored.since));
  } catch (e) {
    console.warn("[UBI] claim error:", e);
    return null;
  }
}

/**
 * Internal: potong coin & persist UBI state. Separated untuk reuse di dua path.
 */
function _grantUbi(player, data, period, daysSinceJoin) {
  // Give UBI
  try {
    const obj = world.scoreboard.getObjective(COIN_OBJ);
    if (!obj) return null;
    obj.addScore(player, UBI_AMOUNT);
  } catch (e) {
    console.warn("[UBI] addScore fail:", e);
    return null;
  }

  const newData = {
    since: data.since,
    lastPeriod: period,
    total: (data.total || 0) + UBI_AMOUNT,
  };
  try { pSet(player, UBI_KEY, newData); } catch (e) {
    // Write-after-pay: score sudah bertambah. Kalau pSet gagal, ada risk
    // double-claim saat restart — log dan biarkan (eventual consistency).
    console.warn("[UBI] pSet fail (write-after-pay):", e);
  }

  trackFlow("ubi_injection", UBI_AMOUNT);

  return {
    amount: UBI_AMOUNT,
    day: daysSinceJoin + 1,                       // 1..7
    remainingDays: UBI_DAYS - (daysSinceJoin + 1), // 6..0
    total: newData.total,
  };
}

/**
 * Peek status UBI player (tanpa claim). Dipakai UI / debug.
 */
export function getUbiStatus(player) {
  try {
    const period = getCurrentPeriod();
    const stored = pGet(player, UBI_KEY, null);
    if (stored === null) {
      return {
        active: !isExistingPlayer(player), // player baru = belum pernah login
        daysLeft: UBI_DAYS,
        claimedToday: false,
        total: 0,
        amountPerDay: UBI_AMOUNT,
        eligible: !isExistingPlayer(player),
      };
    }
    if (stored.since === -1) {
      return { active: false, daysLeft: 0, claimedToday: false, total: 0, amountPerDay: UBI_AMOUNT, eligible: false };
    }
    const daysSinceJoin = period - stored.since;
    return {
      active: daysSinceJoin < UBI_DAYS,
      daysLeft: Math.max(0, UBI_DAYS - daysSinceJoin),
      claimedToday: stored.lastPeriod === period,
      total: stored.total || 0,
      amountPerDay: UBI_AMOUNT,
      eligible: daysSinceJoin < UBI_DAYS,
    };
  } catch { return null; }
}

/**
 * Format UBI notification line untuk chat.
 */
export function buildUbiMessage(result) {
  if (!result) return "";
  const daysLeftLabel = result.remainingDays === 0
    ? "§c(terakhir)"
    : `§7(${result.remainingDays} hari lagi)`;
  return (
    `\n§8───────────────────` +
    `\n§a  ✦ UBI PEMAIN BARU ✦` +
    `\n§r§8───────────────────` +
    `\n§a  Selamat datang di ekonomi server!` +
    `\n  §eHari §f${result.day}§8/§f${UBI_DAYS}  §8── §a+${fmt(result.amount)} Koin  ${daysLeftLabel}` +
    `\n  §7Total UBI diterima: §e${fmt(result.total)} Koin` +
    `\n§8───────────────────\n`
  );
}

export const UBI_CFG = Object.freeze({
  AMOUNT: UBI_AMOUNT,
  DAYS: UBI_DAYS,
});
