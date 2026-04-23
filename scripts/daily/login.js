// daily/login.js — Login streak system
import { world } from "@minecraft/server";
import { DAILY_CFG as CFG } from "./config.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function getCurrentPeriod() {
  return Math.floor((Date.now() - CFG.RESET_UTC_HOUR * 3600000) / MS_PER_DAY);
}

function readLogin(pid) {
  try { const r = world.getDynamicProperty(CFG.K_LOGIN + pid); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

export function getLoginData(pid) {
  return readLogin(pid) ?? { lastPeriod: -1, streak: 0, totalDays: 0, claimed: false };
}

export function processLogin(pid) {
  const period = getCurrentPeriod();
  const data = getLoginData(pid);
  if (data.lastPeriod === period && data.claimed) return null;

  let newStreak;
  if (data.lastPeriod === period - 1) newStreak = (data.streak % 7) + 1;
  else if (data.lastPeriod === period) newStreak = data.streak || 1;
  else newStreak = 1;

  const reward = CFG.LOGIN_REWARDS[newStreak - 1];
  const newData = { lastPeriod: period, streak: newStreak, totalDays: (data.totalDays || 0) + 1, claimed: true };

  // Write first — abort reward if DP write fails to prevent double-claim
  try {
    world.setDynamicProperty(CFG.K_LOGIN + pid, JSON.stringify(newData));
  } catch (e) {
    console.warn("[Daily] writeLogin FAILED — aborting reward:", e);
    return null;
  }

  return { streak: newStreak, coin: reward.coin, totalDays: newData.totalDays };
}

export function getStreakInfo(pid) {
  const data = getLoginData(pid);
  const period = getCurrentPeriod();
  const claimedToday = data.lastPeriod === period && data.claimed;
  const nextDay = claimedToday ? (data.streak % 7) : (data.lastPeriod === period - 1 ? (data.streak % 7) : 0);

  return {
    streak: data.streak || 0,
    totalDays: data.totalDays || 0,
    claimedToday,
    nextReward: CFG.LOGIN_REWARDS[nextDay],
    allRewards: CFG.LOGIN_REWARDS,
  };
}
