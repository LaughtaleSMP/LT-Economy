// daily/login.js — Login streak system (Hybrid Player DP)
import { world } from "@minecraft/server";
import { DAILY_CFG as CFG } from "./config.js";
import { pGet, pSet } from "../player_dp.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function getCurrentPeriod() {
  return Math.floor((Date.now() - CFG.RESET_UTC_HOUR * 3600000) / MS_PER_DAY);
}

// Legacy read (world DP) — hanya untuk getLoginData saat player belum online
function readLoginLegacy(pid) {
  try { const r = world.getDynamicProperty(CFG.K_LOGIN + pid); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

/**
 * Get login data. Jika player object diberikan, baca dari Player DP.
 * Jika hanya pid (string), fallback ke world DP (legacy).
 */
export function getLoginData(pidOrPlayer) {
  const def = { lastPeriod: -1, streak: 0, totalDays: 0, claimed: false };
  if (typeof pidOrPlayer === "string") {
    // Offline path — coba cari player online, fallback world DP
    const p = world.getPlayers().find(pl => pl.id === pidOrPlayer);
    if (p) return pGet(p, CFG.K_LOGIN, def);
    return readLoginLegacy(pidOrPlayer) ?? def;
  }
  // Player object diberikan
  return pGet(pidOrPlayer, CFG.K_LOGIN, def);
}

export function processLogin(player) {
  const pid = typeof player === "string" ? player : player.id;
  const playerObj = typeof player === "string"
    ? world.getPlayers().find(p => p.id === player) : player;
  if (!playerObj) return null;

  const period = getCurrentPeriod();
  const data = getLoginData(playerObj);
  if (data.lastPeriod === period && data.claimed) return null;

  let newStreak;
  if (data.lastPeriod === period - 1) newStreak = (data.streak % 7) + 1;
  else if (data.lastPeriod === period) newStreak = data.streak || 1;
  else newStreak = 1;

  const newTotalDays = (data.totalDays || 0) + 1;

  // ── Hitung reward ──────────────────────────────────────────────
  // [REC-3] Siklus 1–7: pakai LOGIN_REWARDS normal
  //         Hari ke-8+: flat 50 koin + milestone tiap 7 hari & hari ke-30
  let coin = 0;
  let isMilestone7 = false;
  let isMilestone30 = false;

  if (newTotalDays <= 7) {
    // Siklus pertama — reward normal
    coin = CFG.LOGIN_REWARDS[newStreak - 1]?.coin ?? 25;
  } else {
    // Setelah 7 hari: flat reward (tidak lagi 0!)
    coin = CFG.LOGIN_AFTER7_FLAT;

    // Milestone hari ke-30 (sekali seumur hidup)
    if (newTotalDays === 30) {
      coin += CFG.LOGIN_MILESTONE_30;
      isMilestone30 = true;
    }
    // Milestone per-7-hari (hari 14, 21, 28, 35, ...)
    else if (newTotalDays % 7 === 0) {
      coin += CFG.LOGIN_MILESTONE_EVERY7;
      isMilestone7 = true;
    }
  }

  const newData = { lastPeriod: period, streak: newStreak, totalDays: newTotalDays, claimed: true };

  // Write first — abort reward if DP write fails to prevent double-claim
  try {
    pSet(playerObj, CFG.K_LOGIN, newData);
  } catch (e) {
    console.warn("[Daily] writeLogin FAILED — aborting reward:", e);
    return null;
  }

  return { streak: newStreak, coin, totalDays: newTotalDays, isMilestone7, isMilestone30 };
}

export function getStreakInfo(pidOrPlayer) {
  const data = getLoginData(pidOrPlayer);
  const period = getCurrentPeriod();
  const claimedToday = data.lastPeriod === period && data.claimed;
  const totalDays = data.totalDays || 0;
  const nextStreak = claimedToday
    ? (data.streak % 7) + 1
    : (data.lastPeriod === period - 1 ? (data.streak % 7) + 1 : 1);

  // Hitung preview reward besok
  const nextTotalDays = totalDays + (claimedToday ? 0 : 1);
  let nextReward;
  if (nextTotalDays < 7) {
    nextReward = CFG.LOGIN_REWARDS[nextStreak - 1] ?? CFG.LOGIN_REWARDS[0];
  } else if (nextTotalDays === 7) {
    nextReward = CFG.LOGIN_REWARDS[6];
  } else {
    let nextCoin = CFG.LOGIN_AFTER7_FLAT;
    const futureDay = nextTotalDays;
    if (futureDay === 30) nextCoin += CFG.LOGIN_MILESTONE_30;
    else if (futureDay % 7 === 0) nextCoin += CFG.LOGIN_MILESTONE_EVERY7;
    nextReward = { day: nextStreak, coin: nextCoin };
  }

  return {
    streak: data.streak || 0,
    totalDays,
    claimedToday,
    nextReward,
    allRewards: CFG.LOGIN_REWARDS,
  };
}
