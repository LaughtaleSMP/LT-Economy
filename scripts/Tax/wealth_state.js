// ============================================================
// Tax/wealth_state.js — Shared state, treasury API, helpers, notif
//
// Berisi state in-memory dan helper murni yang dipakai oleh:
//   - wealth_collect.js (koleksi pajak)
//   - wealth_distribute.js (distribusi treasury)
//   - wealth_admin.js (UI admin)
//
// Tidak ada side-effect saat import (no runInterval/runTimeout di sini).
// Sesuai CODING_STANDARDS §5.1 (Single Responsibility).
// ============================================================

import { world, system } from "@minecraft/server";

// ── Konstanta publik ─────────────────────────────────────────
export const COIN_OBJ        = "coin";
export const RESET_UTC_HOUR  = 13;           // 20:00 WIB
export const MS_PER_DAY      = 86_400_000;
export const CHECK_INTERVAL  = 6_000;        // ticks — cek tiap 5 menit
export const ADMIN_TAG       = "mimi";

// ── DP Keys ──────────────────────────────────────────────────
export const K_PERIOD   = "tax:wealth_period";
export const K_TREASURY = "tax:treasury";
export const K_NOTIF    = "tax:notif:";     // + playerName

// ── Notifikasi offline config ────────────────────────────────
export const NOTIF_TTL_MS    = 30 * MS_PER_DAY;  // 30 hari
export const NOTIF_MAX_COUNT = 5;                // cap 5 notif per player

// ── Tier pajak (descending) ──────────────────────────────────
export const TAX_TIERS = [
  { min: 50_000, rate: 0.020, label: "2.0%%" },
  { min: 20_000, rate: 0.010, label: "1.0%%" },
  { min:  5_000, rate: 0.005, label: "0.5%%" },
];

// ── Auto-distribute config ───────────────────────────────────
export const AUTO_DIST_THRESHOLD   = 500;
export const AUTO_DIST_RESERVE_PCT = 0.10;
export const AUTO_DIST_BOTTOM_PCT  = 0.50;
export const AUTO_DIST_MIN_SHARE   = 10;

// ── Subsidy config ───────────────────────────────────────────
// Earned Income Subsidy (Negative Income Tax).
// Player miskin (saldo < BALANCE_CAP) dapat bonus dari treasury saat
// bermain (kill mob, selesaikan quest). Zero DP writes per aktivitas.
export const SUBSIDY_CFG = {
  KILL_BONUS:   1,         // +1 koin per mob kill
  QUEST_MULT:   0.20,      // +20% dari reward quest
  BALANCE_CAP:  5_000,     // saldo >= ini = tidak eligible
  MIN_TREASURY: 100,       // treasury minimum untuk subsidi aktif
};

// ── Helpers ──────────────────────────────────────────────────
export const fmt = (n) => Math.floor(n).toLocaleString("id-ID");

export function getCurrentPeriod() {
  return Math.floor((Date.now() - RESET_UTC_HOUR * 3_600_000) / MS_PER_DAY);
}

// ── DP I/O wrappers ──────────────────────────────────────────
export function dpGet(key, def) {
  try { return JSON.parse(world.getDynamicProperty(key) ?? "null") ?? def; }
  catch { return def; }
}

export function dpSet(key, val) {
  try { world.setDynamicProperty(key, JSON.stringify(val)); }
  catch (e) { console.warn("[WealthTax] dpSet gagal:", key, e); }
}

export function dpDel(key) {
  try { world.setDynamicProperty(key, undefined); } catch {}
}

// ── Tax tier resolver ────────────────────────────────────────
/** Rate pajak sesuai saldo. Return null jika tidak kena pajak. */
export function getTaxTier(balance) {
  for (const tier of TAX_TIERS) {
    if (balance >= tier.min) return tier;
  }
  return null;
}

// ── Scoreboard cache (refresh 5 menit) ───────────────────────
// Eliminates per-call getObjective() lookup. Safe karena objective
// long-lived; jika dihapus, cache auto-refresh.
let _coinObjCache = null;
let _coinObjTick  = -1;

export function getCoinObj() {
  const now = system.currentTick;
  if (_coinObjCache && now - _coinObjTick < 6000) return _coinObjCache;
  try { _coinObjCache = world.scoreboard.getObjective(COIN_OBJ); }
  catch { _coinObjCache = null; }
  _coinObjTick = now;
  return _coinObjCache;
}

// ── Treasury API ─────────────────────────────────────────────
export function getTreasury() {
  return dpGet(K_TREASURY, 0);
}

export function setTreasury(val) {
  dpSet(K_TREASURY, Math.max(0, Math.floor(val)));
}

/** Admin: ambil sebagian treasury untuk redistribusi. */
export function drainTreasury(amount) {
  const cur = dpGet(K_TREASURY, 0);
  const actual = Math.min(cur, Math.max(0, Math.floor(amount)));
  if (actual > 0) setTreasury(cur - actual);
  return actual;
}

// ── Subsidy state (in-memory, batched flush) ─────────────────
let _treasuryCache = -1;
let _subsidyDrained = 0;

export function refreshTreasuryCache() {
  _treasuryCache = getTreasury();
}

export function getTreasuryCache() {
  if (_treasuryCache < 0) refreshTreasuryCache();
  return _treasuryCache;
}

export function isSubsidyEligible(coinBalance) {
  if (_treasuryCache < 0) refreshTreasuryCache();
  return coinBalance < SUBSIDY_CFG.BALANCE_CAP
      && _treasuryCache > SUBSIDY_CFG.MIN_TREASURY;
}

/** Deduct amount from treasury cache. Returns actual amount given. Zero DP cost. */
export function trySubsidize(amount) {
  if (_treasuryCache <= SUBSIDY_CFG.MIN_TREASURY) return 0;
  const give = Math.min(Math.floor(amount), _treasuryCache - SUBSIDY_CFG.MIN_TREASURY);
  if (give <= 0) return 0;
  _treasuryCache -= give;
  _subsidyDrained += give;
  return give;
}

/** Helper: check eligibility + give subsidy + add to scoreboard. */
export function applySubsidy(player, amount) {
  try {
    const obj = getCoinObj();
    if (!obj) return 0;
    const bal = obj.getScore(player) ?? 0;
    if (!isSubsidyEligible(bal)) return 0;
    const sub = trySubsidize(Math.max(1, Math.floor(amount)));
    if (sub > 0) obj.addScore(player, sub);
    return sub;
  } catch { return 0; }
}

/** Drain accumulated subsidy amount and reset counter. */
export function flushSubsidyDrain() {
  const drain = _subsidyDrained;
  _subsidyDrained = 0;
  return drain;
}

/** Restore drain counter on flush failure (retry next cycle). */
export function restoreSubsidyDrain(amount) {
  _subsidyDrained += amount;
}

// ── Notifikasi offline ───────────────────────────────────────
// Structure: [{ m: "message", t: timestamp }, ...]
// TTL: notif > 30 hari auto-prune saat push berikutnya.
export function pushOfflineNotif(playerName, msg) {
  try {
    const key = K_NOTIF + playerName;
    const raw = world.getDynamicProperty(key);
    let list = raw ? JSON.parse(raw) : [];

    // Backward compat: format lama (string[]) → new format
    if (list.length > 0 && typeof list[0] === "string") {
      list = list.map(m => ({ m, t: Date.now() }));
    }

    // Prune notif > 30 hari
    const cutoff = Date.now() - NOTIF_TTL_MS;
    list = list.filter(n => n && n.t > cutoff);

    list.push({ m: msg, t: Date.now() });
    world.setDynamicProperty(key, JSON.stringify(list.slice(-NOTIF_MAX_COUNT)));
  } catch {}
}

/** Drain semua notif pending untuk player (dipanggil di spawn event). */
export function drainOfflineNotifs(playerName) {
  try {
    const key = K_NOTIF + playerName;
    const raw = world.getDynamicProperty(key);
    if (!raw) return [];
    dpDel(key);
    const parsed = JSON.parse(raw);
    return parsed.map(n => (typeof n === "string" ? n : n?.m)).filter(Boolean);
  } catch { return []; }
}
