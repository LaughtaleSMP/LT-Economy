// ============================================================
// market/tier.js — Tiered Player Market System
//
// Player diklasifikasikan ke 3 tier berdasarkan saldo koin:
//
//   BEGINNER  : 0      - 4,999    → fee 0%   (no listing fee)
//   MID       : 5,000  - 49,999   → fee 1%   (reduced)
//   PREMIUM   : 50,000+           → fee 3%   (full)
//
// BAGAIMANA DIINTEGRASI:
//   auction/utils/storage.js calcFee() dipanggil saat listing & sale.
//   Tambah parameter playerOrName untuk tier-aware fee.
//   Kalau tidak ada param → fallback ke global fee (backward compat).
//
// ALASAN:
//   Fee beginner 0% → lower barrier entry, player baru bisa jual hasil mining
//   Fee premium 3% → whale tetap bayar lebih banyak (progressive)
//
// PERFORMA:
//   - Tier computed on-demand dari scoreboard
//   - Zero DP reads/writes
//   - String-name resolve via getParticipants() (cached 5 min)
//   - Player entity pakai scoreboardIdentity langsung (O(1))
//
// KEAMANAN:
//   - Tidak pernah throw — semua wrapped try/catch
//   - Fallback ke globalBaseFee kalau resolve gagal
//   - Cache bounded — auto-clear tiap 5 menit
//   - Thread-safe: pure read-only dari scoreboard
// ============================================================

import { world } from "@minecraft/server";

const COIN_OBJ = "coin";

const TIERS = Object.freeze([
  { id: "premium",  min: 50_000, feePct: 3, label: "Premium",  color: "§6" },
  { id: "mid",      min:  5_000, feePct: 1, label: "Menengah", color: "§a" },
  { id: "beginner", min:      0, feePct: 0, label: "Pemula",   color: "§b" },
]);

// ── Objective cache ──────────────────────────────────────────
let _coinObj = null;
let _objResolvedMs = 0;
const OBJ_TTL_MS = 3_600_000; // 1 hour

function getCoinObj() {
  const now = Date.now();
  if (!_coinObj || now - _objResolvedMs > OBJ_TTL_MS) {
    try { _coinObj = world.scoreboard.getObjective(COIN_OBJ); }
    catch { _coinObj = null; }
    _objResolvedMs = now;
  }
  return _coinObj;
}

// ── Name → balance cache (offline player lookup) ─────────────
// Cache 5 menit untuk hindari getParticipants scan berulang.
// Bounded size via LRU eviction.
const _nameCache = new Map(); // name → { bal, ts }
const NAME_CACHE_TTL_MS = 5 * 60_000;
const NAME_CACHE_MAX = 100;

function _pruneCache() {
  if (_nameCache.size <= NAME_CACHE_MAX) return;
  const entries = [];
  for (const [k, v] of _nameCache) entries.push([k, v.ts]);
  entries.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < entries.length - NAME_CACHE_MAX + 10; i++) {
    _nameCache.delete(entries[i][0]);
  }
}

function _resolveNameBalance(name) {
  if (typeof name !== "string" || !name) return 0;
  const cached = _nameCache.get(name);
  const now = Date.now();
  if (cached && now - cached.ts < NAME_CACHE_TTL_MS) return cached.bal;

  const obj = getCoinObj();
  if (!obj) return 0;
  try {
    for (const ident of obj.getParticipants()) {
      try {
        if (ident.displayName === name) {
          const bal = obj.getScore(ident) ?? 0;
          const safeBal = Number.isFinite(bal) ? Math.max(0, bal) : 0;
          _nameCache.set(name, { bal: safeBal, ts: now });
          _pruneCache();
          return safeBal;
        }
      } catch {}
    }
  } catch {}
  // Not found — cache 0 to avoid re-scanning
  _nameCache.set(name, { bal: 0, ts: now });
  _pruneCache();
  return 0;
}

function _getPlayerBalance(player) {
  const obj = getCoinObj();
  if (!obj) return 0;
  try {
    const bal = obj.getScore(player.scoreboardIdentity ?? player) ?? 0;
    return Number.isFinite(bal) ? Math.max(0, bal) : 0;
  } catch { return 0; }
}

/**
 * Get player balance via any identifier.
 * @param {import("@minecraft/server").Player|string} playerOrName
 */
function getBalance(playerOrName) {
  if (!playerOrName) return 0;
  if (typeof playerOrName === "string") return _resolveNameBalance(playerOrName);
  if (typeof playerOrName === "object") return _getPlayerBalance(playerOrName);
  return 0;
}

/**
 * Classify a player into a market tier based on balance.
 * Pure function — no side effects.
 *
 * @param {import("@minecraft/server").Player|string} playerOrName
 * @returns {{id:string, min:number, feePct:number, label:string, color:string, balance:number}}
 */
export function getPlayerTier(playerOrName) {
  const bal = getBalance(playerOrName);
  for (const t of TIERS) {
    if (bal >= t.min) return { ...t, balance: bal };
  }
  return { ...TIERS[TIERS.length - 1], balance: bal };
}

/**
 * Get tier-aware fee percentage.
 * Fallback ke globalBaseFee kalau player tidak bisa di-resolve.
 *
 * @param {import("@minecraft/server").Player|string|null|undefined} playerOrName
 * @param {number} globalBaseFee - fallback (default 3)
 * @returns {number} percent (0-100)
 */
export function getTierFeePct(playerOrName, globalBaseFee) {
  const fallback = Number.isFinite(globalBaseFee) ? globalBaseFee : 3;
  if (!playerOrName) return fallback;
  try {
    const tier = getPlayerTier(playerOrName);
    const pct = tier.feePct;
    return Number.isFinite(pct) && pct >= 0 ? pct : fallback;
  } catch { return fallback; }
}

/**
 * Calculate tier-aware fee in absolute coins.
 *
 * @param {number} price
 * @param {import("@minecraft/server").Player|string|null} playerOrName
 * @param {number} globalBaseFee
 */
export function calcTierFee(price, playerOrName, globalBaseFee) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const pct = getTierFeePct(playerOrName, globalBaseFee);
  return Math.ceil(price * pct / 100);
}

/**
 * Export tier list (readonly copy) for UI display.
 */
export function getTierList() {
  return TIERS.map(t => ({ ...t }));
}

/**
 * Format tier as short label for chat.
 */
export function formatTier(tier) {
  if (!tier) return "";
  return `${tier.color || ""}${tier.label || ""}§r`;
}

/**
 * Clear name cache — useful for testing / admin reset.
 */
export function clearTierCache() {
  _nameCache.clear();
  _coinObj = null;
  _objResolvedMs = 0;
}
