// daily/achievement.js — Persistent stat tracking & achievement system (Hybrid Player DP)
import { world } from "@minecraft/server";
import { DAILY_CFG as CFG } from "./config.js";
import { pGet, pSet } from "../player_dp.js";

const statsCache = new Map();
const dirtyStats = new Set();
const DEFAULT_STATS = { kills: 0, mined: 0, placed: 0, earned: 0, loginDays: 0, questsDone: 0, claimed: [], pendingAch: [] };

function readStatsDP(pid) {
  const p = world.getPlayers().find(pl => pl.id === pid);
  if (p) return pGet(p, CFG.K_STATS, null);
  try { const r = world.getDynamicProperty(CFG.K_STATS + pid); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function writeStatsDP(pid, data) {
  const p = world.getPlayers().find(pl => pl.id === pid);
  if (p) {
    try { pSet(p, CFG.K_STATS, data); return; } catch {}
  }
  try { world.setDynamicProperty(CFG.K_STATS + pid, JSON.stringify(data)); }
  catch (e) { console.warn("[Daily] writeStats:", e); }
}

function getStatsData(pid) {
  if (statsCache.has(pid)) return statsCache.get(pid);
  const saved = readStatsDP(pid);
  const data = saved ? { ...DEFAULT_STATS, ...saved } : { ...DEFAULT_STATS };
  if (!Array.isArray(data.claimed)) data.claimed = [];
  if (!Array.isArray(data.pendingAch)) data.pendingAch = [];
  statsCache.set(pid, data);
  return data;
}

export function getStats(pid) { return { ...getStatsData(pid) }; }

/** Increment stat. Returns array of NEWLY unlocked achievements (threshold crossed this call only). */
export function updateStat(pid, statName, amount = 1) {
  const data = getStatsData(pid);
  const before = data[statName] || 0;
  const after  = before + amount;
  data[statName] = after;
  dirtyStats.add(pid);

  const newUnlocks = [];
  for (const ach of CFG.ACHIEVEMENTS) {
    if (ach.stat !== statName) continue;
    if (data.claimed.includes(ach.id)) continue;
    // Only notify when threshold is crossed THIS call (not already met before)
    if (before < ach.target && after >= ach.target) newUnlocks.push(ach);
  }
  return newUnlocks;
}

export function setStat(pid, statName, value) {
  const data = getStatsData(pid);
  data[statName] = value;
  dirtyStats.add(pid);
}

export function getAchievements(pid) {
  const data = getStatsData(pid);
  const cats = {};
  for (const ach of CFG.ACHIEVEMENTS) {
    if (!cats[ach.cat]) cats[ach.cat] = [];
    const current = data[ach.stat] || 0;
    cats[ach.cat].push({ ...ach, current, unlocked: current >= ach.target, claimed: data.claimed.includes(ach.id) });
  }
  return cats;
}

export function getAchievementSummary(pid) {
  const data = getStatsData(pid);
  let total = 0, unlocked = 0, claimed = 0, claimable = 0;
  for (const ach of CFG.ACHIEVEMENTS) {
    total++;
    if ((data[ach.stat] || 0) >= ach.target) {
      unlocked++;
      if (data.claimed.includes(ach.id)) claimed++; else claimable++;
    }
  }
  return { total, unlocked, claimed, claimable };
}

export function claimAchievement(pid, achId) {
  const data = getStatsData(pid);
  if (data.claimed.includes(achId)) return 0;
  const ach = CFG.ACHIEVEMENTS.find(a => a.id === achId);
  if (!ach || (data[ach.stat] || 0) < ach.target) return 0;
  data.claimed.push(achId);
  dirtyStats.add(pid);
  return ach.reward;
}

/** Queue achievement notification for offline player. */
export function queueAchNotif(pid, label) {
  const data = getStatsData(pid);
  data.pendingAch.push(label);
  dirtyStats.add(pid);
}

/** Drain pending achievement notifications. Returns labels and clears queue. */
export function drainAchNotifs(pid) {
  const data = getStatsData(pid);
  if (data.pendingAch.length === 0) return [];
  const labels = [...data.pendingAch];
  data.pendingAch = [];
  dirtyStats.add(pid);
  return labels;
}

export function flushStatsCache() {
  for (const pid of dirtyStats) { const d = statsCache.get(pid); if (d) writeStatsDP(pid, d); }
  dirtyStats.clear();
}

export function clearStatsCache(pid) {
  if (dirtyStats.has(pid)) { const d = statsCache.get(pid); if (d) writeStatsDP(pid, d); dirtyStats.delete(pid); }
  statsCache.delete(pid);
}
