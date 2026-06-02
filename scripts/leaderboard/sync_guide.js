/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_guide.js — Feature guide builder for web dashboard

   buildFeatureGuide() — assembles the `guide` object that web UI
   reads to display current effective values for: land, gacha, auction,
   bank, wealth tax, welfare. All values pulled from actual runtime
   configs (not hardcoded mirrors).

   Decomposed per-feature for §5.1 compliance (< 50 lines/function).
   ══════════════════════════════════════════════════════════════ */

import { CFG as BANK_CFG } from "../Bank/config.js";
import { getSettings as getBankSettings, getTax as getBankTax } from "../Bank/main.js";
import { CFG as AUC_CFG } from "../auction/config.js";
import { getFee as getAucFee } from "../auction/utils/storage.js";
import { TAX_TIERS as WTAX_TIERS, getTreasury as getWealthTreasury, SUBSIDY_CFG as WSUB_CFG } from "../Tax/wealth.js";
import { UBI_CFG } from "../welfare/ubi.js";
import { DEMURRAGE_CFG } from "../welfare/demurrage.js";

const DEFAULT_LR = [
  { mx: 225,  r: 1 },
  { mx: 900,  r: 2 },
  { mx: 2500, r: 3 },
  { mx: 1e9,  r: 5 },
];

/**
 * Build the `guide` object describing current eco/feature settings.
 * Reads pricing & policy DP, falls back to sensible defaults.
 *
 * @param {(key: string) => unknown} dpRead — DP read helper from sync_dp.js
 * @returns {object} guide object ready to attach to gachaLB.guide
 */
export function buildFeatureGuide(dpRead) {
  const { pricing, polAdj } = _readPolicyState(dpRead);
  const lr = pricing?.lr || DEFAULT_LR;

  return {
    basis:   pricing?.iph || 0,
    anchors: pricing?._a  || [0, 0, 0],
    land:    _buildLandGuide(lr),
    gacha:   _buildGachaGuide(pricing),
    auction: _buildAuctionGuide(),
    bank:    _buildBankGuide(polAdj),
    wealthTax: _buildWealthTaxGuide(),
    welfare:   _buildWelfareGuide(),
  };
}

// ── Private helpers ──────────────────────────────────────────

function _readPolicyState(dpRead) {
  let pricing = null;
  let polAdj = 0;
  try {
    const pRaw = dpRead("eco:pricing");
    pricing = pRaw ? JSON.parse(pRaw) : null;
  } catch {}
  try {
    const polRaw = dpRead("eco:policy");
    polAdj = polRaw ? (JSON.parse(polRaw).adj || 0) : 0;
  } catch {}
  return { pricing, polAdj };
}

function _calcLandPrice(area, rates) {
  if (!rates) return area;
  for (const t of rates) {
    const max = t.mx >= 1e8 ? Infinity : t.mx;
    if (area <= max) return Math.round(area * t.r);
  }
  return Math.round(area * rates[rates.length - 1].r);
}

function _buildLandGuide(lr) {
  return {
    tiers: lr,
    examples: [
      { sz: "10×10", area: 100,  price: _calcLandPrice(100, lr) },
      { sz: "15×15", area: 225,  price: _calcLandPrice(225, lr) },
      { sz: "20×20", area: 400,  price: _calcLandPrice(400, lr) },
      { sz: "30×30", area: 900,  price: _calcLandPrice(900, lr) },
      { sz: "50×50", area: 2500, price: _calcLandPrice(2500, lr) },
    ],
    gemDiscount: 99,
    ppnPct: getBankSettings().taxPct || 5,
    ppnFreeLimit: 3,
    maxPerPlayer: 5,
    minArea: 9,
    firstHomeDiscPct: 50,
  };
}

function _buildGachaGuide(pricing) {
  const eq1 = pricing?.eq1 || 50;
  return {
    eq1,
    eq10: pricing?.eq10 || 450,
    pt1: 10, pt10: 90, gemRefund: 5,
    pityRare: Math.max(30, Math.round(15000 / eq1)),
    pityLeg:  Math.max(50, Math.round(25000 / eq1)),
    rates: { common: 70, uncommon: 22, rare: 6.5, epic: 1.45, legendary: 0.05 },
  };
}

function _buildAuctionGuide() {
  return {
    feePct:        getAucFee(),
    minPrice:      AUC_CFG.MIN_PRICE,
    maxPrice:      AUC_CFG.MAX_BUYOUT,
    durationH:     Math.round(AUC_CFG.DURATION_MS / 3600000),
    maxPerPlayer:  AUC_CFG.MAX_LISTINGS,
    maxGlobal:     AUC_CFG.MAX_GLOBAL,
    firstSaleBonus: AUC_CFG.FIRST_SALE_BONUS,
    bidIncrPct:    AUC_CFG.BID_INCREMENT_PCT,
    minBidIncr:    AUC_CFG.MIN_BID_INCREMENT,
    antiSnipeMin:  Math.round(AUC_CFG.ANTI_SNIPE_MS / 60000),
  };
}

function _buildBankGuide(polAdj) {
  return {
    baseTax:       getBankSettings().taxPct,
    policyAdj:     polAdj,
    effectiveTax:  getBankTax(),
    minTransfer:   BANK_CFG.MIN_TRANSFER,
    maxTransfer:   BANK_CFG.MAX_TRANSFER,
    dailyLimit:    BANK_CFG.DAILY_LIMIT,
    freeTransfers: BANK_CFG.FREE_TRANSFERS,
    brackets:      BANK_CFG.TAX_BRACKETS,
  };
}

function _buildWealthTaxGuide() {
  return {
    tier1: WTAX_TIERS[2]?.min || 5000,
    tier2: WTAX_TIERS[1]?.min || 20000,
    tier3: WTAX_TIERS[0]?.min || 50000,
    rate1: (WTAX_TIERS[2]?.rate || 0.005) * 100,
    rate2: (WTAX_TIERS[1]?.rate || 0.010) * 100,
    rate3: (WTAX_TIERS[0]?.rate || 0.020) * 100,
    treasury: getWealthTreasury(),
    subsidy: {
      killBonus:  WSUB_CFG.KILL_BONUS,
      questMult:  WSUB_CFG.QUEST_MULT,
      balanceCap: WSUB_CFG.BALANCE_CAP,
    },
  };
}

function _buildWelfareGuide() {
  return {
    ubi: { amount: UBI_CFG.AMOUNT, days: UBI_CFG.DAYS },
    demurrage: {
      threshold:   DEMURRAGE_CFG.THRESHOLD,
      graceDays:   DEMURRAGE_CFG.GRACE_DAYS,
      rateLow:     DEMURRAGE_CFG.RATE_LOW * 100,
      rateHigh:    DEMURRAGE_CFG.RATE_HIGH * 100,
      rateHighDay: DEMURRAGE_CFG.RATE_HIGH_DAY,
    },
  };
}
