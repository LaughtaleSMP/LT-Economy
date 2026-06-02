/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_pricing.js — Dynamic pricing & policy adjustment

   Three sub-systems running once per full sync:
   1. updateDynamicPricing() — coin triple-anchor + dampening + floor
   2. updateEcoPolicy()      — income vs sink pressure → adj
   3. updateStagflation()    — supply growth + unemployment → stimulus

   All write DP only when significant change detected (skip-spam guard).
   PRICING_CFG / POLICY_CFG frozen at module-level (zero realloc).
   ══════════════════════════════════════════════════════════════ */

import { world } from "@minecraft/server";
import { tryTriggerStimulus } from "../welfare/stagflation.js";

// Pricing & Policy Constants (module-level — zero realloc per sync).
//
// DAMP_ALPHA derivation: EMA formula α = 2/(N+1) where N = effective lookback.
//   α=0.5 → N=3 samples. Sync interval = 5 min → window ≈ 15 min.
//   Rationale: balance responsiveness to market shocks vs. noise resistance.
//   Half-life ≈ 1.4 samples (≈ 7 min) — most weight on last 2-3 syncs.
export const PRICING_CFG = Object.freeze({
  BASIS_FLOOR:    25,    // floor — anti-crash exploit
  BASIS_CEIL:     300,   // ceil  — anti-runaway inflasi (eq1 max = 300×0.15 = 45⛃)
  DAMP_ALPHA:     0.3,   // EMA: lower α = faster response to price drops
  MAX_DELTA_PCT:  0.15,  // ±15% per sync
});

// Sync cadence — derived constant (avoid magic number).
// Full sync = every 5 min → 12 syncs/hour.
const SYNCS_PER_HOUR = 12;

// Flow classification sets (frozen, module-level)
// Income = coin diciptakan (naikkan supply)
// Sink   = coin dibakar (turunkan supply)
// Neutral = transfer internal (net-zero, tidak pengaruh supply)
// NOTE: Hanya flow keys yang berdampak ke COIN supply yang masuk INCOME/SINK.
// Gem-only keys (topup_first_bonus, gacha_gem_cost, gacha_gem_refund, land_buy_gem)
// sengaja TIDAK di sini supaya tidak kontaminasi coin pressure calc.
// `topup` saat ini bisa coin atau gem (admin choice) — tracked sebagai TODO
// untuk split jadi `topup_coin` + `topup_gem`. Sementara dianggap coin-skewed
// karena sebagian besar topup historis adalah coin.
export const INCOME_KEYS = Object.freeze(new Set([
  "mob_kill", "topup", "gacha_refund", "pvp_refund",
  "weekly_reward", "first_sale", "tax_distribute",
]));
export const SINK_KEYS = Object.freeze(new Set([
  "gacha_cost", "bank_tax", "auction_fee", "wealth_tax",
  "store_sink", "mob_penalty", "pvp_penalty", "land_ppn",
]));

export const POLICY_CFG = Object.freeze({
  HIGH_INFLATION:  0.08,
  MED_INFLATION:   0.04,
  HIGH_DEFLATION: -0.08,
  MED_DEFLATION:  -0.04,
  ADJ_MAX:         10,
  ADJ_MIN:        -5,
});

/**
 * Update dynamic pricing DP (eco:pricing) using coin triple-anchor
 * with EMA dampening, delta clamp, and absolute floor/ceiling.
 *
 * @param {object} summary — gachaLB.summary (n, coin{}, gem{})
 * @param {object} flow    — eco_flow consumeFlow() result
 */
export function updateDynamicPricing(summary, flow) {
  try {
    const n = summary.n || 1;
    const mobKill = Math.abs(flow.mob_kill || 0);
    // Income/hour/player. Flow accumulates over 1 sync window;
    // multiply by SYNCS_PER_HOUR to project hourly rate.
    const incPerHour = n > 0 ? (mobKill * SYNCS_PER_HOUR / n) : 0;
    const med = summary.coin?.median || 0;
    const avg = summary.coin?.avg || 0;
    const cA1 = incPerHour;
    const cA2 = med * 0.02;
    const cA3 = avg * 0.01;
    const rawBasis = Math.max(cA1, cA2, cA3, PRICING_CFG.BASIS_FLOOR);

    let prevBasis = _readPrevBasis();
    if (prevBasis < PRICING_CFG.BASIS_FLOOR) prevBasis = PRICING_CFG.BASIS_FLOOR;

    // 1. EMA — blend basis lama dengan target baru
    let dampedBasis = PRICING_CFG.DAMP_ALPHA * prevBasis
                    + (1 - PRICING_CFG.DAMP_ALPHA) * rawBasis;

    // 2. Clamp delta ±MAX_DELTA_PCT per sync
    const maxUp   = prevBasis * (1 + PRICING_CFG.MAX_DELTA_PCT);
    const maxDown = prevBasis * (1 - PRICING_CFG.MAX_DELTA_PCT);
    if (dampedBasis > maxUp)   dampedBasis = maxUp;
    if (dampedBasis < maxDown) dampedBasis = maxDown;

    // 3. Floor + ceiling absolut
    let coinBasis = dampedBasis;
    if (coinBasis < PRICING_CFG.BASIS_FLOOR) coinBasis = PRICING_CFG.BASIS_FLOOR;
    if (coinBasis > PRICING_CFG.BASIS_CEIL)  coinBasis = PRICING_CFG.BASIS_CEIL;

    const iph = Math.round(coinBasis * 100) / 100;

    // Skip DP write kalau basis praktis tidak berubah (≤1% delta)
    // DAN eq1/eq10 juga tidak berubah (multiplier tetap sama).
    const absChange = Math.abs(coinBasis - prevBasis);
    const basisChanged = prevBasis === PRICING_CFG.BASIS_FLOOR
                       || absChange / prevBasis > 0.01;

    const pricing = _buildPricingObject(iph, coinBasis, cA1, cA2, cA3, rawBasis, prevBasis);

    // [FIX] Deteksi perubahan multiplier: jika eq1/eq10 di DP berbeda dari
    // yang baru dihitung, force write. Tanpa ini, perubahan multiplier
    // tidak pernah ter-apply karena coinBasis skip guard.
    let multiplierChanged = false;
    try {
      const pRaw = world.getDynamicProperty("eco:pricing");
      if (typeof pRaw === "string") {
        const old = JSON.parse(pRaw);
        if (old.eq1 !== pricing.eq1 || old.eq10 !== pricing.eq10) multiplierChanged = true;
      }
    } catch (_) { multiplierChanged = true; }

    if (basisChanged || multiplierChanged) {
      world.setDynamicProperty("eco:pricing", JSON.stringify(pricing));
      _logPricingDelta(iph, pricing, prevBasis, coinBasis);
    }

    // Cross-pack bridge: export pricing ke scoreboard
    _writePricingBridge(pricing, iph);
  } catch (pe) {
    console.warn("[Eco-Pricing]", pe);
  }
}

/**
 * Update eco policy adjustment DP (eco:policy) based on
 * income/sink pressure ratio.
 */
export function updateEcoPolicy(summary, flow) {
  try {
    const totalSupply = summary.coin?.total || 1;

    // Scan flow sekali — zero allocation (no Object.entries array)
    let income = 0, sink = 0;
    for (const k in flow) {
      if (!Object.prototype.hasOwnProperty.call(flow, k)) continue;
      const v = flow[k];
      if (!Number.isFinite(v) || v === 0) continue;
      const absV = v < 0 ? -v : v;
      if (INCOME_KEYS.has(k))    income += absV;
      else if (SINK_KEYS.has(k)) sink   += absV;
    }

    const incomeRatio = income / totalSupply;
    const sinkRatio   = sink   / totalSupply;
    const pressure    = incomeRatio - sinkRatio;

    const prev = _readPrevPolicyAdj();
    const adj = _computeNewAdj(prev, pressure);

    // Skip DP write kalau tidak ada perubahan signifikan
    const hasActivity = (income + sink) > 1;
    const shouldWrite = adj !== prev || hasActivity;

    if (shouldWrite) {
      world.setDynamicProperty("eco:policy", JSON.stringify({
        t: Date.now(),
        adj,
        income: Math.round(income),
        sink: Math.round(sink),
        pressure: +(pressure * 100).toFixed(2),
      }));
      if (adj !== prev) {
        console.log(
          `[Eco-Policy] adj=${adj} (was ${prev}) | ` +
          `income=${Math.round(income)} sink=${Math.round(sink)} ` +
          `pressure=${(pressure * 100).toFixed(1)}%`
        );
      }
    }
  } catch (pe) {
    console.warn("[Eco-Policy]", pe);
  }
}

/**
 * Update stagflation detector. Compute supply growth + unemployment,
 * trigger stimulus if both high.
 */
export function updateStagflation(summary, bankLog, auctionLog) {
  try {
    const prevSupply = _readPrevSupply();
    const curSupply = Number.isFinite(summary.coin?.total)
      ? Math.max(0, summary.coin.total) : 0;

    let supplyGrowthPct = 0;
    if (prevSupply > 1000 && curSupply > 0) {
      const growthPerSync = ((curSupply - prevSupply) / prevSupply) * 100;
      if (Number.isFinite(growthPerSync)) {
        // Project per-sync growth → weekly rate (12 syncs/h × 24h × 7d).
        // Capped ±50% to absorb bootstrap spikes from low prevSupply.
        const SYNCS_PER_WEEK = SYNCS_PER_HOUR * 24 * 7;
        supplyGrowthPct = Math.max(-50, Math.min(50, growthPerSync * SYNCS_PER_WEEK));
      }
    }
    try { world.setDynamicProperty("stag:prev_supply", String(curSupply)); } catch {}

    const totalPlayers = Number.isFinite(summary.n) ? Math.max(0, summary.n) : 0;
    const activeTx = (Array.isArray(bankLog) ? bankLog.length : 0)
                   + (Array.isArray(auctionLog) ? auctionLog.length : 0);
    const avgTxPerPlayer = totalPlayers > 0 ? activeTx / totalPlayers : 0;
    const unemploymentPct = avgTxPerPlayer < 0.5
      ? Math.min(100, (1 - avgTxPerPlayer / 0.5) * 100)
      : 0;

    tryTriggerStimulus({ supplyGrowthPct, unemploymentPct, playerCount: totalPlayers });
  } catch (se) {
    console.warn("[Stagflation] check error:", se);
  }
}

/**
 * Cleanup old wealth tax DP key — handled by Tax/wealth.js now.
 * Only deletes if still present (avoid wasted DP write).
 */
export function cleanupLegacyWtaxDp() {
  try {
    const stale = world.getDynamicProperty("eco:wtax");
    if (stale !== undefined) world.setDynamicProperty("eco:wtax", undefined);
  } catch {}
}

// ── Private helpers ──────────────────────────────────────────

function _readPrevBasis() {
  try {
    const pRaw = world.getDynamicProperty("eco:pricing");
    if (typeof pRaw === "string" && pRaw.length > 0) {
      const pp = JSON.parse(pRaw);
      if (Number.isFinite(pp?.iph) && pp.iph > 0) return pp.iph;
    }
  } catch {}
  return PRICING_CFG.BASIS_FLOOR;
}

function _readPrevPolicyAdj() {
  try {
    const raw = world.getDynamicProperty("eco:policy");
    if (typeof raw === "string" && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.adj)) return parsed.adj;
    }
  } catch {}
  return 0;
}

function _readPrevSupply() {
  const raw = world.getDynamicProperty("stag:prev_supply");
  if (typeof raw === "string") {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function _computeNewAdj(prev, pressure) {
  if (pressure >  POLICY_CFG.HIGH_INFLATION) return Math.min(POLICY_CFG.ADJ_MAX, prev + 2);
  if (pressure >  POLICY_CFG.MED_INFLATION)  return Math.min(POLICY_CFG.ADJ_MAX, prev + 1);
  if (pressure <  POLICY_CFG.HIGH_DEFLATION) return Math.max(POLICY_CFG.ADJ_MIN, prev - 2);
  if (pressure <  POLICY_CFG.MED_DEFLATION)  return Math.max(POLICY_CFG.ADJ_MIN, prev - 1);
  if (prev > 0) return prev - 1;  // slowly decay to 0
  if (prev < 0) return prev + 1;
  return prev;
}

function _buildPricingObject(iph, coinBasis, cA1, cA2, cA3, rawBasis, prevBasis) {
  return {
    t: Date.now(),
    iph,
    _a: [+(cA1.toFixed(1)), +(cA2.toFixed(1)), +(cA3.toFixed(1))],
    _raw: +(rawBasis.toFixed(1)),
    _prev: +(prevBasis.toFixed(1)),
    eq1: Math.max(10, Math.round(coinBasis * 0.15)),
    eq10: Math.max(90, Math.round(coinBasis * 1.25)),  // [§9.3] 17% bulk discount anchoring
    // [PhD-v5] Land rate recalibrated for seasonal server (3-month reset).
    // Target: 300×300 (90k blok²) ≈ 100k⛃ at coinBasis ~250.
    // Multiplier derivation: 100000 / 90000 / 250 ≈ 0.0045 (Mega).
    // Progression: Small → Mega = gentle slope (2× → 2.3×).
    lr: [
      { mx: 225,  r: Math.max(0.10, +(coinBasis * 0.002).toFixed(2)) },
      { mx: 900,  r: Math.max(0.25, +(coinBasis * 0.003).toFixed(2)) },
      { mx: 2500, r: Math.max(0.50, +(coinBasis * 0.004).toFixed(2)) },
      { mx: 1e9,  r: Math.max(0.80, +(coinBasis * 0.0045).toFixed(2)) },
    ],
  };
}

function _logPricingDelta(iph, pricing, prevBasis, coinBasis) {
  const deltaPct = prevBasis > 0 ? ((coinBasis - prevBasis) / prevBasis * 100) : 0;
  const sign = deltaPct >= 0 ? "+" : "";
  console.log(
    `[Eco-Pricing] basis=${iph} (raw=${pricing._raw}, prev=${pricing._prev}, ` +
    `Δ${sign}${deltaPct.toFixed(1)}%) eq1=${pricing.eq1}`
  );
}

function _writePricingBridge(pricing, iph) {
  // Selalu dijalankan (scoreboard write murah, tidak pakai DP).
  // Mimi Land pack read dari sini karena DP scoped per-pack.
  try {
    let sb = world.scoreboard.getObjective("_eco_pricing");
    if (!sb) sb = world.scoreboard.addObjective("_eco_pricing", "eco pricing bridge");
    for (let ti = 0; ti < pricing.lr.length; ti++) {
      sb.setScore("_lr" + ti, Math.round(pricing.lr[ti].r * 100));
      sb.setScore("_mx" + ti, pricing.lr[ti].mx >= 1e8 ? 999999 : pricing.lr[ti].mx);
    }
    sb.setScore("_eq1", pricing.eq1);
    sb.setScore("_eq10", pricing.eq10);
    sb.setScore("_iph", Math.round(iph * 100));
    sb.setScore("_n", pricing.lr.length);
  } catch (be) {
    console.warn("[Eco-Pricing] bridge:", be);
  }
}
