/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_gacha.js — Gacha leaderboard builders

   buildGachaLB()      — sync version (used internally if needed)
   buildGachaLBAsync() — async, yields every BUILD_GACHA_BATCH players

   Result identical between the two; async takes ~500ms spread vs
   ~150ms single burst — preferred for full-sync to avoid TPS spike.

   Both build:
   - Top 10 per category (gem, coin, totalPulls, ptPulls, eqPulls)
   - summary{} with mean/median/quartiles + Gini coefficient
   ══════════════════════════════════════════════════════════════ */

import { system, world } from "@minecraft/server";
import { dpGet, dpGetChunked, GK } from "./sync_dp.js";

const CATEGORIES = ["gem", "coin", "totalPulls", "ptPulls", "eqPulls"];
const BUILD_GACHA_BATCH = 50; // players per tick yield (async only)

// ── Sync version — keep for callers that don't need yielding ─
export function buildGachaLB() {
  const reg = dpGetChunked(GK.PLAYER_REG, null);
  if (!reg || typeof reg !== "object") return {};
  const regEntries = Object.entries(reg);
  if (regEntries.length === 0) return {};

  const players = _buildPlayersFromReg(regEntries);
  const idx = players.length;

  _overlayScoreboard(players, idx);

  return _assembleResult(players, idx);
}

// ── Async version — yields every BATCH players to prevent lag ─
export async function buildGachaLBAsync() {
  const reg = dpGetChunked(GK.PLAYER_REG, null);
  if (!reg || typeof reg !== "object") return {};
  const regEntries = Object.entries(reg);
  if (regEntries.length === 0) return {};

  const players = new Array(regEntries.length);
  let idx = 0;

  // Batch read DP stats, yield every BATCH players
  for (let i = 0; i < regEntries.length; i++) {
    const [id, info] = regEntries[i];
    const ptStats = dpGet(GK.PT_STATS + id, null);
    const eqStats = dpGet(GK.EQ_STATS + id, null);
    const ptP = ptStats?.total ?? 0;
    const eqP = eqStats?.total ?? 0;
    players[idx++] = {
      name: info.name || "???",
      gem: info.gem ?? 0,
      coin: info.coin ?? 0,
      ptPulls: ptP,
      eqPulls: eqP,
      totalPulls: ptP + eqP,
    };

    if ((i + 1) % BUILD_GACHA_BATCH === 0) {
      await new Promise(resolve => system.runTimeout(resolve, 1));
    }
  }

  _overlayScoreboard(players, idx);

  // Yield before heavy sort operations
  await new Promise(resolve => system.runTimeout(resolve, 1));

  return _assembleResult(players, idx);
}

// ── Private helpers ──────────────────────────────────────────

function _buildPlayersFromReg(regEntries) {
  const players = new Array(regEntries.length);
  let idx = 0;
  for (const [id, info] of regEntries) {
    const ptStats = dpGet(GK.PT_STATS + id, null);
    const eqStats = dpGet(GK.EQ_STATS + id, null);
    const ptP = ptStats?.total ?? 0;
    const eqP = eqStats?.total ?? 0;
    players[idx++] = {
      name: info.name || "???",
      gem: info.gem ?? 0,
      coin: info.coin ?? 0,
      ptPulls: ptP,
      eqPulls: eqP,
      totalPulls: ptP + eqP,
    };
  }
  players.length = idx;
  return players;
}

function _overlayScoreboard(players, idx) {
  // Scoreboard overlay — fast (online players only, usually <30)
  try {
    const gemObj = world.scoreboard.getObjective(GK.GEM_OBJ);
    const coinObj = world.scoreboard.getObjective(GK.COIN_OBJ);
    if (!gemObj && !coinObj) return;

    const onlinePlayers = [];
    try { for (const p of world.getPlayers()) onlinePlayers.push(p); } catch {}

    // Build name → index lookup O(N) once, then O(1) match per online player
    const nameIdx = new Map();
    for (let i = 0; i < idx; i++) nameIdx.set(players[i].name, i);

    for (const p of onlinePlayers) {
      const i = nameIdx.get(p.name);
      if (i === undefined) continue;
      if (gemObj)  { try { players[i].gem = gemObj.getScore(p); } catch {} }
      if (coinObj) { try { players[i].coin = coinObj.getScore(p); } catch {} }
    }
  } catch {}
}

function _assembleResult(players, idx) {
  const all = players.slice(0, idx);
  const result = {};

  for (const cat of CATEGORIES) {
    result[cat] = all
      .filter(p => p[cat] > 0)
      .sort((a, b) => b[cat] - a[cat])
      .slice(0, 10)
      .map(p => ({
        name: p.name, gem: p.gem, coin: p.coin,
        totalPulls: p.totalPulls, ptPulls: p.ptPulls, eqPulls: p.eqPulls,
      }));
  }

  const n = all.length;
  if (n > 0) result.summary = _buildSummary(all, n);

  return result;
}

// Median for sorted array: average of 2 middle for even n, single middle for odd.
function _median(sorted) {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function _buildSummary(all, n) {
  const coins = all.map(p => p.coin).sort((a, b) => a - b);
  const gems  = all.map(p => p.gem).sort((a, b) => a - b);
  const cT = coins.reduce((s, v) => s + v, 0);
  const gT = gems.reduce((s, v) => s + v, 0);

  // Gini (coin distribution). Negative result indicates input bias —
  // log warning instead of clamping so root cause remains visible.
  let gini = 0;
  if (cT > 0) {
    let sr = 0;
    for (let i = 0; i < n; i++) sr += (i + 1) * coins[i];
    gini = Math.round(((2 * sr) / (n * cT) - (n + 1) / n) * 1000) / 1000;
    if (gini < 0) {
      console.warn(`[Sync-Gacha] negative gini=${gini} (n=${n}, cT=${cT}) — check sort/distribution`);
    }
  }

  const gachers = all.filter(p => p.totalPulls > 0).length;
  return {
    n,
    coin: {
      total: cT, avg: Math.round(cT / n), median: _median(coins),
      p25: coins[Math.floor(n * 0.25)], p75: coins[Math.floor(n * 0.75)],
      min: coins[0], max: coins[n - 1],
    },
    gem: {
      total: gT, avg: Math.round(gT / n), median: _median(gems),
    },
    gini,
    gacha: {
      active: gachers,
      pulls: all.reduce((s, p) => s + p.totalPulls, 0),
      rate: Math.round(gachers / n * 100),
    },
  };
}
