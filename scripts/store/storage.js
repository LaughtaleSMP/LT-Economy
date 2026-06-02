// ============================================================
// store/storage.js — Storage layer dengan batched DP writes
//
// STRATEGI:
// - In-memory cache: qty harian & stats player
// - Dirty flag: tandai player yang berubah
// - Batched flush setiap 20 detik (FLUSH_INTERVAL)
// - Player DP untuk data per-player (auto-segregated, tidak bengkak world DP)
// - World DP hanya untuk audit log kecil (rolling 20 entry)
//
// Reset harian otomatis: saat baca, bandingkan period lama vs current,
// kalau beda → reset counter. Tidak perlu scheduler.
// ============================================================

import { world, system } from "@minecraft/server";
import { CFG, currentPeriod } from "./config.js";
import { pGet, pSet, getOnlinePlayer } from "../player_dp.js";

// ── In-memory caches ──
/** @type {Map<string, {period:number, qty:Record<string,number>}>} */
const _dailyCache = new Map();
/** @type {Map<string, {totalSpent:number, totalItems:number, firstBuy:number, lastBuy:number}>} */
const _statsCache = new Map();
const _dirtyDaily = new Set();
const _dirtyStats = new Set();

// ── Audit log (global world DP, rolling) ──
let _auditBuffer = [];
let _auditDirty = false;

// ═══════════════════════════════════════════════════════════
// DAILY QTY — per player, per category, reset 24h
// ═══════════════════════════════════════════════════════════

/**
 * Ambil data qty harian player. Auto-reset kalau periode beda.
 * @param {Player} player
 * @returns {{period:number, qty:Record<string,number>}}
 */
export function getDaily(player) {
  const pid = player.id;
  const period = currentPeriod();

  // Cek cache dulu
  let cached = _dailyCache.get(pid);
  if (cached && cached.period === period) return cached;

  // Baca dari Player DP (fallback world DP via pGet)
  let data = pGet(player, CFG.K_DAILY, null);
  if (!data || data.period !== period) {
    data = { period, qty: {} };
  }

  _dailyCache.set(pid, data);
  return data;
}

/**
 * Tambah qty untuk kategori tertentu. In-memory only, dirty-mark untuk flush.
 * @param {Player} player
 * @param {string} catId
 * @param {number} amount
 */
export function addDailyQty(player, catId, amount) {
  const data = getDaily(player);
  data.qty[catId] = (data.qty[catId] || 0) + amount;
  _dailyCache.set(player.id, data);
  _dirtyDaily.add(player.id);
}

export function getDailyQty(player, catId) {
  const data = getDaily(player);
  return data.qty[catId] || 0;
}

// ═══════════════════════════════════════════════════════════
// STATS — cumulative stats player (lifetime)
// ═══════════════════════════════════════════════════════════

export function getStats(player) {
  const pid = player.id;
  let cached = _statsCache.get(pid);
  if (cached) return cached;

  const data = pGet(player, CFG.K_STATS, { totalSpent: 0, totalItems: 0, firstBuy: 0, lastBuy: 0 });
  _statsCache.set(pid, data);
  return data;
}

export function addStats(player, spent, items) {
  const data = getStats(player);
  data.totalSpent = (data.totalSpent || 0) + spent;
  data.totalItems = (data.totalItems || 0) + items;
  data.lastBuy = Date.now();
  if (!data.firstBuy) data.firstBuy = data.lastBuy;
  _statsCache.set(player.id, data);
  _dirtyStats.add(player.id);
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOG — rolling 20 entry di world DP
// ═══════════════════════════════════════════════════════════

/**
 * @param {{player:string, itemId:string, qty:number, cost:number, ts:number}} entry
 */
export function pushAudit(entry) {
  _auditBuffer.push(entry);
  _auditDirty = true;
}

export function getAuditLog() {
  try {
    const raw = world.getDynamicProperty(CFG.K_AUDIT);
    const persisted = raw ? (JSON.parse(raw) || []) : [];
    // Merge unflushed buffer (terbaru di depan)
    return [..._auditBuffer.slice().reverse(), ...persisted].slice(0, CFG.MAX_AUDIT);
  } catch {
    return _auditBuffer.slice().reverse();
  }
}

// ═══════════════════════════════════════════════════════════
// FLUSH — dipanggil periodik & saat player leave
// ═══════════════════════════════════════════════════════════

/**
 * Flush dirty data ke Player DP / World DP.
 * O(dirty) — hanya menulis yang berubah.
 */
export function flush() {
  // Daily
  for (const pid of _dirtyDaily) {
    try {
      const player = getOnlinePlayer(pid);
      const data = _dailyCache.get(pid);
      if (!data) continue;
      if (player) pSet(player, CFG.K_DAILY, data);
      // Kalau offline, data tetap di cache (akan di-flush saat online lagi / cleanup)
    } catch (e) { console.warn("[Store] flush daily:", e); }
  }
  _dirtyDaily.clear();

  // Stats
  for (const pid of _dirtyStats) {
    try {
      const player = getOnlinePlayer(pid);
      const data = _statsCache.get(pid);
      if (!data) continue;
      if (player) pSet(player, CFG.K_STATS, data);
    } catch (e) { console.warn("[Store] flush stats:", e); }
  }
  _dirtyStats.clear();

  // Audit log
  if (_auditDirty && _auditBuffer.length > 0) {
    try {
      const raw = world.getDynamicProperty(CFG.K_AUDIT);
      const persisted = raw ? (JSON.parse(raw) || []) : [];
      const merged = [..._auditBuffer.slice().reverse(), ...persisted].slice(0, CFG.MAX_AUDIT);
      world.setDynamicProperty(CFG.K_AUDIT, JSON.stringify(merged));
      _auditBuffer = [];
      _auditDirty = false;
    } catch (e) { console.warn("[Store] flush audit:", e); }
  }
}

/** Flush khusus saat 1 player leave — hindari kehilangan data */
export function flushOnLeave(playerId) {
  try {
    const player = getOnlinePlayer(playerId);
    if (player) {
      if (_dirtyDaily.has(playerId)) {
        const data = _dailyCache.get(playerId);
        if (data) pSet(player, CFG.K_DAILY, data);
        _dirtyDaily.delete(playerId);
      }
      if (_dirtyStats.has(playerId)) {
        const data = _statsCache.get(playerId);
        if (data) pSet(player, CFG.K_STATS, data);
        _dirtyStats.delete(playerId);
      }
    }
  } catch {}
  // Lepas cache untuk mencegah leak saat player offline
  _dailyCache.delete(playerId);
  _statsCache.delete(playerId);
}

/** Start batched flush interval */
export function startFlushLoop() {
  system.runInterval(() => {
    if (_dirtyDaily.size === 0 && _dirtyStats.size === 0 && !_auditDirty) return;
    try { flush(); } catch (e) { console.warn("[Store] flush loop:", e); }
  }, CFG.FLUSH_INTERVAL);
}

/**
 * Invalidate semua cache (dipanggil admin /lt:store_reset).
 * Mencegah data lama di-flush setelah reset.
 */
export function invalidateStorageCache() {
  _dailyCache.clear();
  _statsCache.clear();
  _dirtyDaily.clear();
  _dirtyStats.clear();
  _auditBuffer = [];
  _auditDirty = false;
}
