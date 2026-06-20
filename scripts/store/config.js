// ============================================================
// store/config.js — Konfigurasi Store (Bahan Build)
//
// FILOSOFI EKONOMI:
// - Harga DINAMIS ikut basis ekonomi server (eco:pricing.iph)
//   → inflasi naik → harga naik → sink lebih kuat (self-balancing)
// - Tier harian PROGRESIF per-item kategori
//   → pembeli casual (1-5 stack) dapat harga murah
//   → borongan (50+ stack) bayar premium per unit
//   → anti-whale tanpa perlu multiplier saldo yang tidak adil
// - Reset counter 24 jam (pola UTC+7, sinkron Wealth Tax)
//
// PERFORMA:
// - ZERO write per pembelian (in-memory accumulator)
// - Batched flush setiap 20 detik (pola Tax/wealth.js subsidy)
// - Player DP untuk counter harian (tidak bengkak world DP)
// - Max 1 audit log entry per player per flush
//
// BUG-PROOF:
// - Lock per-player (pola Bank.withLock)
// - Re-check state setelah await UI (pola Bank confirm)
// - Int32 clamp saat addScore (pola Wealth Tax)
// - Integer math only (hindari floating point di coin)
// - Atomic: coin dipotong DULU baru item diberikan; jika gagal, refund
// ============================================================

import { world } from "@minecraft/server";

export const CFG = {
  COIN_OBJ:   "coin",
  ADMIN_TAG:  "mimi",

  // ── Feature Flag (kill switch) ──
  // Dikendalikan via world DP "store:enabled".
  // Default true. Admin bisa toggle via /lt:store_toggle (lihat main.js).
  K_ENABLED: "store:enabled",

  // ── Integrasi Ekonomi ──
  // Basis default jika eco:pricing belum diinisialisasi (hitung dari server yang sama)
  DEFAULT_BASIS: 57,

  // ── Tier Pembelian Harian Per-Kategori ──
  // Kurva harga progresif: semakin banyak beli, makin mahal per unit.
  // qty = jumlah unit (1 unit = 1 stack untuk blok, 1 item untuk lainnya)
  // mult = pengali terhadap hargaDasar yang dihitung dari basis
  // Efek: pembeli kasual (rumah biasa) murah; whale (borong 100+) bayar 5x premium
  TIERS: [
    { maxQty: 5,   mult: 1.0, label: "§a" },   // 1-5: harga normal
    { maxQty: 20,  mult: 1.6, label: "§e" },   // 6-20: +60%
    { maxQty: 50,  mult: 2.8, label: "§6" },   // 21-50: +180%
    { maxQty: 100, mult: 4.5, label: "§c" },   // 51-100: +350%
    { maxQty: Infinity, mult: 7.0, label: "§4" }, // 100+: +600% (whale)
  ],

  // ── Reset Period ──
  // Sinkron dengan Wealth Tax: reset jam 20:00 WIB (13:00 UTC)
  RESET_UTC_HOUR: 13,

  // ── Limits ──
  MAX_DAILY_QTY:      200,   // max 200 unit/kategori/hari (hard cap)
  MAX_PER_PURCHASE:   16,    // max 16 unit per tombol buy (menghindari accidental borong)
  MIN_COIN_BALANCE:   0,     // boleh beli dengan saldo berapapun (tidak ada threshold min)

  // ── Cooldown ──
  COOLDOWN_TICKS:     40,    // 2 detik antar klik menu
  PURCHASE_CD_TICKS:  10,    // 0.5 detik antar pembelian

  // ── Storage Keys ──
  // Player DP (per-player, isolated, tidak bengkak world DP)
  K_DAILY: "store:daily",       // {period: int, qty: {catId: int}}
  K_STATS: "store:stats",       // {totalSpent: int, firstBuy: ts}

  // World DP (global)
  K_AUDIT:        "store:audit",        // array kecil, rolling 20 entry terakhir
  MAX_AUDIT:      20,
  FLUSH_INTERVAL: 400,                   // 20 detik (200 = 10s, 400 = 20s)

  // ── UI ──
  HR:      "§8═══════════════════",
  HR_THIN: "§8───────────────────",
};

export const SFX = {
  OPEN:    { id: "random.click",    pitch: 1.3, vol: 0.7 },
  BUY:     { id: "random.orb",      pitch: 1.1, vol: 1.0 },
  SUCCESS: { id: "random.levelup",  pitch: 1.0, vol: 0.9 },
  FAIL:    { id: "note.bass",       pitch: 0.6, vol: 0.8 },
  ADMIN:   { id: "random.levelup",  pitch: 1.8, vol: 1.0 },
  TIERUP:  { id: "note.pling",      pitch: 1.5, vol: 0.8 },
};

// ============================================================
// BASIS PRICING READER — sumber kebenaran tunggal
// Sinkron dengan Gacha & Land (semua baca eco:pricing.iph)
// ============================================================
let _basisCache = null;
let _basisTs = 0;
const BASIS_CACHE_MS = 300_000; // 5 menit (sama dengan Gacha)

export function readBasis() {
  const now = Date.now();
  if (_basisCache !== null && (now - _basisTs) < BASIS_CACHE_MS) return _basisCache;
  try {
    const raw = world.getDynamicProperty("eco:pricing");
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Number.isFinite(p.iph) && p.iph > 0) {
        _basisCache = p.iph;
        _basisTs = now;
        return _basisCache;
      }
    }
  } catch {}
  _basisCache = CFG.DEFAULT_BASIS;
  _basisTs = now;
  return _basisCache;
}

/** Invalidate cache — dipanggil saat admin override harga (jarang) */
export function invalidateBasisCache() {
  _basisCache = null;
  _basisTs = 0;
}

/** Period harian sinkron Wealth Tax */
export function currentPeriod() {
  const MS_PER_DAY = 86_400_000;
  return Math.floor((Date.now() - CFG.RESET_UTC_HOUR * 3_600_000) / MS_PER_DAY);
}

/** Tier lookup berdasarkan qty yang sudah dibeli */
export function getTier(boughtQty) {
  for (const t of CFG.TIERS) {
    if (boughtQty < t.maxQty) return t;
  }
  return CFG.TIERS[CFG.TIERS.length - 1];
}

/**
 * Hitung harga total untuk membeli `requestQty` unit
 * dimana player sudah membeli `alreadyBought` hari ini.
 *
 * Harga progresif per unit — jika melewati batas tier, unit berikutnya
 * dihargai tier yang lebih tinggi.
 *
 * @param {number} baseUnitPrice - harga dasar per 1 unit (dari katalog × basis)
 * @param {number} alreadyBought - qty yang sudah dibeli hari ini untuk kategori ini
 * @param {number} requestQty    - qty yang mau dibeli sekarang
 * @returns {{totalCost: number, breakdown: Array<{qty:number, tierMult:number, cost:number}>}}
 */
export function calcProgressiveCost(baseUnitPrice, alreadyBought, requestQty) {
  let cost = 0;
  const breakdown = [];
  let remaining = requestQty;
  let cursor = alreadyBought;

  for (const tier of CFG.TIERS) {
    if (remaining <= 0) break;
    if (cursor >= tier.maxQty) continue;

    const tierCap = tier.maxQty === Infinity ? remaining : tier.maxQty;
    const canBuyInTier = Math.min(remaining, tierCap - cursor);
    if (canBuyInTier <= 0) continue;

    const tierCost = Math.ceil(baseUnitPrice * tier.mult * canBuyInTier);
    cost += tierCost;
    breakdown.push({ qty: canBuyInTier, tierMult: tier.mult, cost: tierCost });

    cursor += canBuyInTier;
    remaining -= canBuyInTier;
  }

  return { totalCost: cost, breakdown };
}


// ============================================================
// FEATURE FLAG — Kill switch untuk Store
// Default enabled. Admin bisa disable via command tanpa edit code.
// Disimpan sebagai number (0/1) untuk kompatibilitas maksimum.
// ============================================================
export function isStoreEnabled() {
  try {
    const raw = world.getDynamicProperty(CFG.K_ENABLED);
    // Default TRUE jika belum di-set (opt-out, bukan opt-in)
    if (raw === undefined || raw === null) return true;
    // Handle multiple possible types: boolean, number, string
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") return raw === "true" || raw === "1";
    return true;
  } catch { return true; }
}

export function setStoreEnabled(value) {
  try {
    // Simpan sebagai number (0/1) — paling universal di BDS
    world.setDynamicProperty(CFG.K_ENABLED, value ? 1 : 0);
    return true;
  } catch { return false; }
}
