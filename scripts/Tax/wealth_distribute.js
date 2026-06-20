// ============================================================
// Tax/wealth_distribute.js — Auto-distribute treasury ke kalangan bawah
//
// Distribusikan treasury ke player dengan saldo terendah (bottom 50%).
// Bekerja untuk player ONLINE maupun OFFLINE (via scoreboard setScore).
// Weighted: saldo lebih rendah → bagian lebih besar.
//
// PERFORMA:
//   - Single scoreboard scan O(N)
//   - Single getPlayers() call (Map lookup O(1) per player)
//   - Re-entrant guard (_autoDistRunning)
//   - Budget tracking — actual share <= remaining budget (anti-dupe)
// ============================================================

import { world } from "@minecraft/server";
import { trackFlow } from "../eco_flow.js";
import {
  AUTO_DIST_THRESHOLD, AUTO_DIST_RESERVE_PCT,
  AUTO_DIST_BOTTOM_PCT, AUTO_DIST_MIN_SHARE,
  fmt, getCoinObj, getTreasury, drainTreasury,
  pushOfflineNotif, refreshTreasuryCache,
} from "./wealth_state.js";

// ── Re-entrant guard ────────────────────────────────────────
// Cegah concurrent auto-dist (misal admin klik 2x cepat).
let _autoDistRunning = false;

const INT32_MAX = 2_147_483_647; // batas atas scoreboard Bedrock

export function autoDistributeTreasury() {
  if (_autoDistRunning) return 0;
  _autoDistRunning = true;

  try {
    const treasury = getTreasury();
    if (treasury < AUTO_DIST_THRESHOLD) return 0;

    const obj = getCoinObj();
    if (!obj) {
      console.warn("[WealthTax] auto-dist: scoreboard 'coin' tidak ditemukan.");
      return 0;
    }

    const players = _scanScoreboardPlayers(obj);
    if (players.length === 0) return 0;

    // Sort ascending: termiskin di depan
    players.sort((a, b) => a.balance - b.balance);

    const targetCount = Math.max(1, Math.floor(players.length * AUTO_DIST_BOTTOM_PCT));
    const targets     = players.slice(0, targetCount);

    const distributable = Math.floor(treasury * (1 - AUTO_DIST_RESERVE_PCT));
    if (distributable < AUTO_DIST_MIN_SHARE) return 0;

    // Weighted inverse-balance — +100 floor cegah Infinity
    const weights     = targets.map(p => 1 / (p.balance + 100));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight <= 0) return 0;

    // Single getPlayers() call → Map lookup O(1) per target
    const onlineMap = _buildOnlineMap();

    const totalOut = _distributeShares(
      obj, targets, weights, totalWeight, distributable, onlineMap
    );

    onlineMap.clear();

    if (totalOut > 0) {
      // totalOut dijamin <= distributable <= treasury * 0.9 (budget tracking)
      drainTreasury(totalOut);
      trackFlow("tax_distribute", totalOut);
      const remaining = getTreasury();
      console.log(
        `[WealthTax] Auto-dist selesai: ${fmt(totalOut)} koin → ${targetCount} player. ` +
        `Sisa: ${fmt(remaining)}`
      );
      world.sendMessage(
        `§8[§aSubsidi§8]§a §fTreasury dibagikan ke §e${targetCount} §fplayer (saldo rendah). ` +
        `§6${fmt(totalOut)} Koin §f| Sisa: §e${fmt(remaining)} Koin`
      );
      // Refresh subsidy cache setelah treasury berubah
      refreshTreasuryCache();
    }
    return totalOut;
  } finally {
    _autoDistRunning = false;
  }
}

// ── Helpers (private) ───────────────────────────────────────
function _scanScoreboardPlayers(obj) {
  const players = [];
  for (const ident of obj.getParticipants()) {
    try {
      const name = ident.displayName;
      // Skip hanya entry sistem scoreboard
      if (name && (name.startsWith("command.") || name.includes(".scoreboard."))) continue;
      const balance = obj.getScore(ident) ?? 0;
      if (!Number.isFinite(balance)) continue;
      players.push({ ident, name: name || "", balance: Math.max(0, balance) });
    } catch {}
  }
  return players;
}

function _buildOnlineMap() {
  const map = new Map();
  for (const p of world.getPlayers()) map.set(p.name, p);
  return map;
}

function _distributeShares(obj, targets, weights, totalWeight, distributable, onlineMap) {
  let totalOut = 0;
  let budget = distributable; // Track remaining budget — cegah coin duplication

  for (let i = 0; i < targets.length; i++) {
    if (budget <= 0) break;
    try {
      let share = Math.max(
        AUTO_DIST_MIN_SHARE,
        Math.floor(distributable * weights[i] / totalWeight)
      );
      // Clamp share ke sisa budget
      share = Math.min(share, budget);
      if (share <= 0) continue;

      // Guard int32 overflow
      const newBal = Math.min(targets[i].balance + share, INT32_MAX);
      const actualShare = newBal - targets[i].balance;
      if (actualShare <= 0) continue;

      obj.setScore(targets[i].ident, newBal);
      totalOut += actualShare;
      budget   -= actualShare;

      _notifyRecipient(targets[i], actualShare, newBal, onlineMap);
    } catch (e) {
      console.warn("[WealthTax] auto-dist player error:", e);
    }
  }
  return totalOut;
}

function _notifyRecipient(target, actualShare, newBal, onlineMap) {
  const msg =
    `§8[§aSubsidi§8]§a §fKamu menerima §e${fmt(actualShare)} Koin §adari distribusi treasury!\n` +
    `§8Saldo lama: §e${fmt(target.balance)} §8→ Saldo baru: §a${fmt(newBal)} Koin`;

  const online = onlineMap.get(target.name);
  if (online) {
    online.sendMessage(msg);
    try { online.playSound("note.pling", { pitch: 1.2, volume: 0.8 }); } catch {}
  } else if (target.name) {
    pushOfflineNotif(target.name, msg);
  }
}
