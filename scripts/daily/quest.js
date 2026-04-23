// daily/quest.js — Multi-tier quest system (daily/weekly/monthly)
import { world } from "@minecraft/server";
import { DAILY_CFG as CFG } from "./config.js";

const MS_PER_DAY = 86400000;
const RESET_MS = CFG.RESET_UTC_HOUR * 3600000;

// ═══════════════════════════════════════════════════════════
// PERIOD CALCULATIONS — real-time reset
// ═══════════════════════════════════════════════════════════
function getDailyPeriod() {
  return Math.floor((Date.now() - RESET_MS) / MS_PER_DAY);
}

function getWeeklyPeriod() {
  // Epoch 1970-01-01 was Thursday. +3 aligns weeks to Monday.
  return Math.floor((getDailyPeriod() + 3) / 7);
}

function getMonthlyPeriod() {
  const d = new Date(Date.now() - RESET_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// ═══════════════════════════════════════════════════════════
// TIER REGISTRY
// ═══════════════════════════════════════════════════════════
const TIERS = {
  daily:   { pool: CFG.QUEST_POOL,   count: CFG.QUEST_COUNT,   key: CFG.K_QUEST,   bonus: CFG.DAILY_BONUS,   getPeriod: getDailyPeriod },
  weekly:  { pool: CFG.WEEKLY_POOL,  count: CFG.WEEKLY_COUNT,  key: CFG.K_WEEKLY,  bonus: CFG.WEEKLY_BONUS,  getPeriod: getWeeklyPeriod },
  monthly: { pool: CFG.MONTHLY_POOL, count: CFG.MONTHLY_COUNT, key: CFG.K_MONTHLY, bonus: CFG.MONTHLY_BONUS, getPeriod: getMonthlyPeriod },
};

export const TIER_KEYS = ["daily", "weekly", "monthly"];

export const TIER_META = {
  daily:   { label: "Harian",   color: "§b", icon: "✎", resetLabel: "20:00 WIB" },
  weekly:  { label: "Mingguan", color: "§3", icon: "✦", resetLabel: "Senin 20:00" },
  monthly: { label: "Bulanan",  color: "§5", icon: "★", resetLabel: "Tgl 1, 20:00" },
};

// ═══════════════════════════════════════════════════════════
// COUNTDOWN TIMER
// ═══════════════════════════════════════════════════════════
export function getResetCountdown(tier) {
  const now = Date.now();
  let target;

  if (tier === "daily") {
    target = (getDailyPeriod() + 1) * MS_PER_DAY + RESET_MS;
  } else if (tier === "weekly") {
    const nextWeekDay = 7 * (getWeeklyPeriod() + 1) - 3;
    target = nextWeekDay * MS_PER_DAY + RESET_MS;
  } else {
    const adj = new Date(now - RESET_MS);
    const next = new Date(Date.UTC(adj.getUTCFullYear(), adj.getUTCMonth() + 1, 1));
    target = next.getTime() + RESET_MS;
  }

  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / MS_PER_DAY);
  const h = Math.floor((diff % MS_PER_DAY) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);

  if (d > 0) return `${d}h ${h}j`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

// ═══════════════════════════════════════════════════════════
// SEEDED RANDOM — deterministic quest selection per period
// ═══════════════════════════════════════════════════════════
function seededRandom(seed) {
  let s = Math.abs(seed) | 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function selectQuestIndices(period, pool, count, tierSeed) {
  const rng = seededRandom(period * 31337 + 7919 + tierSeed);
  const selected = [], used = new Set();
  let attempts = 0;
  while (selected.length < count && attempts < 100) {
    const idx = Math.floor(rng() * pool.length);
    if (!used.has(idx)) { used.add(idx); selected.push(idx); }
    attempts++;
  }
  return selected;
}

// ═══════════════════════════════════════════════════════════
// CACHE & STORAGE — unified for all tiers
// ═══════════════════════════════════════════════════════════
const questCache = new Map();   // key: "tier|pid"
const dirtyQuests = new Set();  // values: "tier|pid"
const keyMeta = new Map();      // "tier|pid" → { tier, pid }

function ck(tier, pid) {
  const key = `${tier}|${pid}`;
  if (!keyMeta.has(key)) keyMeta.set(key, { tier, pid });
  return key;
}

function readDP(tier, pid) {
  try { const r = world.getDynamicProperty(TIERS[tier].key + pid); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

function writeDP(tier, pid, data) {
  try { world.setDynamicProperty(TIERS[tier].key + pid, JSON.stringify(data)); }
  catch (e) { console.warn(`[Quest] writeDP(${tier}):`, e); }
}

// ═══════════════════════════════════════════════════════════
// QUEST DATA — get or generate for current period
// ═══════════════════════════════════════════════════════════
function getQuestData(pid, tier) {
  const t = TIERS[tier];
  const period = t.getPeriod();
  const key = ck(tier, pid);

  if (questCache.has(key)) {
    const cached = questCache.get(key);
    if (cached.period === period) return cached;
  }

  const saved = readDP(tier, pid);
  if (saved && saved.period === period) { questCache.set(key, saved); return saved; }

  // Generate new quests for this period
  const tierSeed = tier === "daily" ? 0 : tier === "weekly" ? 1000 : 2000;
  const data = {
    period,
    quests: selectQuestIndices(period, t.pool, t.count, tierSeed)
      .map(idx => ({ poolIdx: idx, progress: 0, completed: false, claimed: false })),
    bonusClaimed: false,
  };
  questCache.set(key, data);
  dirtyQuests.add(key);
  return data;
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/** Get quest list for a tier. Backward-compatible: defaults to "daily". */
export function getQuests(pid, tier = "daily") {
  const t = TIERS[tier];
  return getQuestData(pid, tier).quests.map(q => {
    const def = t.pool[q.poolIdx];
    return { ...def, progress: q.progress, completed: q.completed, claimed: q.claimed, poolIdx: q.poolIdx };
  });
}

// Backward compat alias
export const getDailyQuests = (pid) => getQuests(pid, "daily");

/** Get summary counts for a tier. */
export function getTierSummary(pid, tier) {
  const data = getQuestData(pid, tier);
  const t = TIERS[tier];
  const total = data.quests.length;
  const done = data.quests.filter(q => q.completed).length;
  const claimed = data.quests.filter(q => q.claimed).length;
  const claimable = done - claimed;
  const allDone = done === total;
  const bonusReady = allDone && !data.bonusClaimed;
  return { total, done, claimed, claimable, allDone, bonusReady, bonus: t.bonus, bonusClaimed: data.bonusClaimed };
}

/** Update progress across ALL tiers at once. Returns [{ tier, label }]. */
export function updateAllQuestProgress(pid, type, targetId, amount = 1) {
  const results = [];
  for (const tier of TIER_KEYS) {
    const t = TIERS[tier];
    const data = getQuestData(pid, tier);
    let changed = false;

    for (const q of data.quests) {
      if (q.completed) continue;
      const def = t.pool[q.poolIdx];
      if (def.type !== type) continue;
      if (def.target !== "*" && def.target !== targetId) continue;

      const before = q.progress;
      q.progress = Math.min(q.progress + amount, def.amount);
      if (q.progress !== before) changed = true;
      if (q.progress >= def.amount) { q.completed = true; results.push({ tier, label: def.label }); }
    }

    if (changed) dirtyQuests.add(ck(tier, pid));
  }
  return results;
}

/** Submit items from inventory for a quest. */
export function submitQuestItems(player, tier, questIndex) {
  const t = TIERS[tier];
  const data = getQuestData(player.id, tier);
  if (questIndex < 0 || questIndex >= data.quests.length) return { success: false };

  const q = data.quests[questIndex];
  if (q.completed || q.claimed) return { success: false };
  const def = t.pool[q.poolIdx];
  if (def.type !== "submit") return { success: false };

  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return { success: false };

  const needed = def.amount - q.progress;
  let found = 0;
  const slots = [];
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item && item.typeId === def.target) { slots.push({ slot: i, amount: item.amount }); found += item.amount; }
  }
  if (found <= 0) return { success: false, needed, found: 0, label: def.label };

  let toTake = Math.min(found, needed), taken = 0;
  for (const s of slots) {
    if (toTake <= 0) break;
    const item = inv.getItem(s.slot);
    if (!item) continue;
    if (item.amount <= toTake) {
      toTake -= item.amount; taken += item.amount; inv.setItem(s.slot, undefined);
    } else {
      const clone = item.clone();
      clone.amount = item.amount - toTake;
      inv.setItem(s.slot, clone);
      taken += toTake; toTake = 0;
    }
  }

  q.progress += taken;
  if (q.progress >= def.amount) { q.progress = def.amount; q.completed = true; }
  dirtyQuests.add(ck(tier, player.id));
  return { success: true, taken, label: def.label, completed: q.completed, progress: q.progress, total: def.amount };
}

/** Claim reward for a completed quest. */
export function claimQuestReward(pid, tier, questIndex) {
  const t = TIERS[tier];
  const data = getQuestData(pid, tier);
  if (questIndex < 0 || questIndex >= data.quests.length) return 0;
  const q = data.quests[questIndex];
  if (!q.completed || q.claimed) return 0;
  q.claimed = true;
  dirtyQuests.add(ck(tier, pid));
  return t.pool[q.poolIdx].reward;
}

/** Claim completion bonus (all quests done in a tier). */
export function claimTierBonus(pid, tier) {
  const t = TIERS[tier];
  const data = getQuestData(pid, tier);
  if (data.bonusClaimed) return 0;
  const allDone = data.quests.every(q => q.completed && q.claimed);
  if (!allDone) return 0;
  data.bonusClaimed = true;
  dirtyQuests.add(ck(tier, pid));
  return t.bonus;
}

// ═══════════════════════════════════════════════════════════
// FLUSH & CLEANUP
// ═══════════════════════════════════════════════════════════
export function flushQuestCache() {
  for (const key of dirtyQuests) {
    const d = questCache.get(key);
    if (!d) continue;
    const meta = keyMeta.get(key);
    if (meta) writeDP(meta.tier, meta.pid, d);
  }
  dirtyQuests.clear();
}

export function clearQuestCache(pid) {
  for (const tier of TIER_KEYS) {
    const key = ck(tier, pid);
    if (dirtyQuests.has(key)) {
      const d = questCache.get(key);
      if (d) writeDP(tier, pid, d);
      dirtyQuests.delete(key);
    }
    questCache.delete(key);
  }
}
