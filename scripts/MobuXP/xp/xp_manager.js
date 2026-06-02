import { world, system } from "@minecraft/server";
import { VANILLA_XP } from "./vanilla_xp.js";
import { CONFIG as _RAW_CONFIG } from "./xp_config.js";
import { setBar, clearBar } from "../shared/actionbar_manager.js";
import { pGet, pSet, getOnlinePlayer } from "../../player_dp.js";
import { shouldSkipHeavy } from "../shared/tps_gate.js";
import { trackFlow } from "../../eco_flow.js";
import { applySubsidy, SUBSIDY_CFG } from "../../Tax/wealth.js";
import { getKillSubsidyBoost } from "../../welfare/stagflation.js";
import { spawnKillEffect, playKillFxSound } from "../../kill_fx.js";

const CONFIG_DEFAULTS = {
  xp_multiplier_percent: 200,
  bonus_tiers: [
    { label: "Lucky", xp: 5, weight: 60 },
    { label: "Great", xp: 15, weight: 30 },
    { label: "Amazing", xp: 30, weight: 9 },
    { label: "Jackpot", xp: 60, weight: 1 },
  ],
  bonus_xp_chance_percent: 5,
  streak_bonus_chance_per_kill: 1,
  streak_max_bonus_chance: 50,
  streak_timeout_seconds: 8,
  streak_milestones: [50],
  streak_milestone_messages: {
    50: "§7[§dStreak§7] §f{player} §dMENGGILAKAN!! §e{streak} kill streak! ",
  },
  kill_sound: "note.pling",
  kill_sound_pitch: 2.0,
  kill_sound_volume: 1.0,
  bonus_sound: "note.hat",
  bonus_sound_pitch: 1.0,
  bonus_sound_volume: 0.6,
  max_orb_per_spawn: 60,
  coin_scoreboard: "coin",
  coin_per_kill: 1,
  coin_bonus_lucky: 3,
  coin_bonus_great: 8,
  coin_bonus_amazing: 15,
  coin_bonus_jackpot: 30,
  mob_stack_limit: 20,
  mob_stack_radius: 8,
  mob_stack_warn: true,
  mob_stack_cooldown_ticks: 10,
  mob_stack_coin_penalty: 10,
  whitelist: new Set([
    "minecraft:zombie",
    "minecraft:zombie_villager",
    "minecraft:husk",
    "minecraft:drowned",
    "minecraft:skeleton",
    "minecraft:stray",
    "minecraft:creeper",
    "minecraft:spider",
    "minecraft:cave_spider",
    "minecraft:enderman",
    "minecraft:witch",
    "minecraft:wither_skeleton",
    "minecraft:piglin_brute",
    "minecraft:ravager",
    "minecraft:evoker",
    "minecraft:vindicator",
    "minecraft:elder_guardian",
    "minecraft:warden",
    "minecraft:wither",
    "minecraft:ender_dragon",
  ]),
};

const CONFIG = { ...CONFIG_DEFAULTS, ..._RAW_CONFIG };

(function validateConfig() {
  const required = [
    "xp_multiplier_percent",
    "coin_scoreboard",
    "coin_per_kill",
    "coin_bonus_lucky",
    "coin_bonus_great",
    "coin_bonus_amazing",
    "coin_bonus_jackpot",
    "max_orb_per_spawn",
    "streak_timeout_seconds",
    "streak_max_bonus_chance",
    "mob_stack_limit",
    "mob_stack_radius",
    "mob_stack_coin_penalty",
  ];
  const missing = required.filter(k => _RAW_CONFIG[k] === undefined || _RAW_CONFIG[k] === null);
  if (missing.length > 0) {
    console.warn(`[XP] Config incomplete — missing: ${missing.join(", ")}`);
  }
})();

// ============================================================
// [PERF] SCOREBOARD CACHE — resolve objectives once at startup
// Eliminates per-kill world.scoreboard.getObjective() calls
// ============================================================
let _coinObj = null;
let _objResolved = false;

function getCoinObjective() {
  if (_objResolved) return _coinObj;
  try {
    _coinObj = world.scoreboard.getObjective(CONFIG.coin_scoreboard);
    _objResolved = true;
  } catch { }
  return _coinObj;
}

// Re-resolve on startup and periodically (in case scoreboard recreated)
system.run(() => { getCoinObjective(); });
system.runInterval(() => { _objResolved = false; getCoinObjective(); }, 6000);

// ============================================================
// DAILY SOFT CAP
// Reset jam 20:00 WIB = 13:00 UTC setiap hari
// ============================================================
const RESET_UTC_HOUR = 13;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const K_DAILY_COIN = "xp:daily_coin:";

// [REC-1] Soft cap dinaikkan 2x — fix keluhan pendapatan mob susah
// Phase 1: 0–500 koin → 100% chance (sebelumnya 250)
// Phase 2: 500–900 koin → 50% chance (sebelumnya 30%)
// Phase 3: > 900 koin  → 20% chance (sebelumnya 10%)
// Target realistis 2 jam main: ~700–800 koin/hari (sebelumnya ~330)
const SOFTCAP_PHASE1 = 500;
const SOFTCAP_PHASE2 = 900;
const CHANCE_PHASE2 = 0.50;
const CHANCE_PHASE3 = 0.20;

function getCurrentPeriod() {
  return Math.floor((Date.now() - RESET_UTC_HOUR * 60 * 60 * 1000) / MS_PER_DAY);
}

// ── In-memory daily coin cache — ZERO DP writes per kill ──────
// Data di-accumulate di memory, flush ke DP setiap 10 detik.
// Mengurangi DP writes dari ~60/menit/player → ~6/menit/player.
const _dailyCache = new Map();
const _dailyDirty = new Set();

function getDailyData(playerId) {
  // 1. Check in-memory cache first (hot path — no DP read)
  if (_dailyCache.has(playerId)) return _dailyCache.get(playerId);
  // 2. Read from Player DP / World DP
  const p = getOnlinePlayer(playerId);
  if (p) {
    const data = pGet(p, K_DAILY_COIN, null);
    if (data) { _dailyCache.set(playerId, data); return data; }
  }
  try {
    const raw = world.getDynamicProperty(K_DAILY_COIN + playerId);
    if (!raw) { const d = { period: -1, total: 0 }; _dailyCache.set(playerId, d); return d; }
    const parsed = JSON.parse(raw);
    _dailyCache.set(playerId, parsed);
    return parsed;
  } catch { const d = { period: -1, total: 0 }; _dailyCache.set(playerId, d); return d; }
}

function setDailyData(playerId, data) {
  const p = getOnlinePlayer(playerId);
  if (p) {
    try { pSet(p, K_DAILY_COIN, data); return; } catch { }
  }
  try { world.setDynamicProperty(K_DAILY_COIN + playerId, JSON.stringify(data)); }
  catch (e) { console.warn("[XP Manager] setDailyData gagal:", e); }
}

function getDailyTotal(playerId) {
  const data = getDailyData(playerId);
  if (data.period !== getCurrentPeriod()) return 0;
  return data.total;
}

function addDailyTotal(playerId, amount, cachedData) {
  const period = getCurrentPeriod();
  const data = cachedData ?? getDailyData(playerId);
  if (data.period !== period) {
    const newData = { period, total: amount };
    _dailyCache.set(playerId, newData);
  } else {
    data.total += amount;
    _dailyCache.set(playerId, data);
  }
  _dailyDirty.add(playerId);
}

// [PERF] Flush dirty daily coin data every 10 seconds — batched DP write
system.runInterval(() => {
  if (_dailyDirty.size === 0) return;
  for (const pid of _dailyDirty) {
    const data = _dailyCache.get(pid);
    if (!data) { _dailyDirty.delete(pid); continue; }
    try {
      setDailyData(pid, data);
      _dailyDirty.delete(pid);
    } catch (e) {
      console.warn("[XP Manager] flush daily gagal, retry next cycle:", e);
      // stays in _dailyDirty — will retry next flush
    }
  }
}, 200);

// Flush on player leave to avoid data loss
world.afterEvents.playerLeave.subscribe(ev => {
  const pid = ev.playerId;
  try {
    if (_dailyDirty.has(pid)) {
      const data = _dailyCache.get(pid);
      if (data) setDailyData(pid, data);
    }
  } catch (e) {
    console.warn("[XP Manager] playerLeave flush gagal:", e);
  }
  _dailyDirty.delete(pid);
  _dailyCache.delete(pid);
});

function getCoinChance(dailyTotal) {
  if (dailyTotal <= SOFTCAP_PHASE1) return 1.0;
  if (dailyTotal <= SOFTCAP_PHASE2) return CHANCE_PHASE2;
  return CHANCE_PHASE3;
}

function getSoftCapPhase(dailyTotal) {
  if (dailyTotal <= SOFTCAP_PHASE1) return 1; // full chance
  if (dailyTotal <= SOFTCAP_PHASE2) return 2; // slow
  return 3;                                    // dim
}

// ============================================================
// DERIVED CONSTANTS
// ============================================================
const MULTIPLIER = CONFIG.xp_multiplier_percent / 100;
const WHITELIST = CONFIG.whitelist;
const TIER_TOTAL_WEIGHT = CONFIG.bonus_tiers.reduce((sum, t) => sum + t.weight, 0);

function rollBonusTier() {
  let roll = Math.random() * TIER_TOTAL_WEIGHT;
  for (const tier of CONFIG.bonus_tiers) {
    roll -= tier.weight;
    if (roll <= 0) return tier;
  }
  return CONFIG.bonus_tiers[0];
}

function distSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ============================================================
// KILL STREAK
// ============================================================
const streakMap = new Map();

function incrementStreak(playerName) {
  const now = Date.now();
  const existing = streakMap.get(playerName);
  const isExpired = !existing || now >= existing.expireMs;
  const newCount = isExpired ? 1 : existing.count + 1;
  streakMap.set(playerName, { count: newCount, expireMs: now + CONFIG.streak_timeout_seconds * 1000 });
  return newCount;
}

// [PERF] Cleanup interval — prune expired entries from all Maps
// Single interval handles all 3 maps to reduce timer count
system.runInterval(() => {
  const now = Date.now();
  const nowTick = system.currentTick;
  for (const [name, data] of streakMap)
    if (now >= data.expireMs) streakMap.delete(name);
  for (const [name, lastTick] of effectCooldownMap)
    if (nowTick - lastTick > 30) effectCooldownMap.delete(name);
  for (const [name, lastTick] of stackCheckCooldown)
    if (nowTick - lastTick > CONFIG.mob_stack_cooldown_ticks * 4) stackCheckCooldown.delete(name);
}, 100);

function getBonusChance(streak) {
  const base = CONFIG.bonus_xp_chance_percent;
  const bonus = streak * CONFIG.streak_bonus_chance_per_kill;
  return Math.min(base + bonus, CONFIG.streak_max_bonus_chance) / 100;
}

// ============================================================
// EFFECT THROTTLE
// ============================================================
const effectCooldownMap = new Map();
const EFFECT_COOLDOWN_TICKS = 10;

function canPlayEffect(playerName) {
  const cur = system.currentTick;
  const last = effectCooldownMap.get(playerName) ?? -EFFECT_COOLDOWN_TICKS;
  if (cur - last >= EFFECT_COOLDOWN_TICKS) { effectCooldownMap.set(playerName, cur); return true; }
  return false;
}

// ============================================================
// [PERF] XP/COIN/SOUND — Use API directly, no runCommand()
// Eliminates command parsing overhead per kill (3-5 commands → 0)
// ============================================================
function giveXP(player, amount) {
  const rounded = Math.max(1, Math.round(amount));
  try { player.addExperience(rounded); }
  catch { try { player.runCommand(`xp ${rounded}`); } catch {} }
}

function playKillSound(player) {
  // Use the player's chosen kill effect sound (unique per effect)
  playKillFxSound(player);
}

// ============================================================
// [PERF] GIVE COINS — Scoreboard API (no runCommand)
// [§2] Iron rule: trackFlow + dailyTotal HANYA setelah scoreboard write
//      benar-benar berhasil. Kalau gagal, jangan klaim faucet success.
// ============================================================
function giveCoinsWithCap(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { given: 0, newTotal: getDailyTotal(player.id) };
  }
  const rawData = getDailyData(player.id);
  const period = getCurrentPeriod();
  const dailyTotal = rawData.period === period ? rawData.total : 0;
  const chance = getCoinChance(dailyTotal);
  if (Math.random() >= chance) return { given: 0, newTotal: dailyTotal };
  const given = Math.floor(amount);

  // Try scoreboard API first, fallback to runCommand. Track success.
  let ok = false;
  const obj = getCoinObjective();
  if (obj) {
    try { obj.addScore(player, given); ok = true; }
    catch {}
  }
  if (!ok) {
    try {
      player.runCommand(`scoreboard players add @s ${CONFIG.coin_scoreboard} ${given}`);
      ok = true;
    } catch {}
  }

  if (!ok) return { given: 0, newTotal: dailyTotal };

  addDailyTotal(player.id, given, rawData);
  trackFlow("mob_kill", given);
  return { given, newTotal: dailyTotal + given };
}

// [§2] Sink — only track if scoreboard write succeeded.
function takeCoins(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const taken = Math.floor(amount);
  let ok = false;
  const obj = getCoinObjective();
  if (obj) {
    try { obj.addScore(player, -taken); ok = true; }
    catch {}
  }
  if (!ok) {
    try {
      player.runCommand(`scoreboard players remove @s ${CONFIG.coin_scoreboard} ${taken}`);
      ok = true;
    } catch {}
  }
  if (ok) trackFlow("mob_penalty", -taken);
}

function coinBonusForTier(tierLabel) {
  const map = {
    "Lucky": CONFIG.coin_bonus_lucky,
    "Great": CONFIG.coin_bonus_great,
    "Amazing": CONFIG.coin_bonus_amazing,
    "Jackpot": CONFIG.coin_bonus_jackpot,
  };
  const val = map[tierLabel];
  return Number.isFinite(val) ? val : 0;
}

// ============================================================
// ACTIONBAR — single line, minimal, no progress bar
// Format examples:
//   normal : §f⚔ §e12  §8•  §6+2⛃  §8•  §7480§8/§7900
//   bonus  : §f⚔ §e12  §8•  §6Jackpot §f+60XP  §8•  §6+32⛃  §8•  §7480§8/§7900 §c• Dim
// ============================================================

function getSoftCapPhaseLabel(phase) {
  if (phase === 2) return " §8• §eSlow";
  if (phase === 3) return " §8• §cDim";
  return "";
}

function buildActionbarMsg(streak, bonusTier, coinGiven, dailyTotal) {
  const safeStreak = Number.isFinite(streak) ? streak : 0;
  const safeDaily = Number.isFinite(dailyTotal) ? dailyTotal : 0;
  const safeCoin = Number.isFinite(coinGiven) ? coinGiven : 0;
  const parts = [`§f⚔ §e${safeStreak}`];

  if (bonusTier && Number.isFinite(bonusTier.xp)) {
    const tierColor = tierLabelColor(bonusTier.label);
    parts.push(`${tierColor}${bonusTier.label} §f+${bonusTier.xp}XP`);
  }

  if (safeCoin > 0) parts.push(`§6+${safeCoin}⛃`);

  const capMax = SOFTCAP_PHASE2;
  const shown = Math.min(safeDaily, capMax);
  const phase = getSoftCapPhase(safeDaily);
  parts.push(`§7${shown}§8/§7${capMax}${getSoftCapPhaseLabel(phase)}`);

  return parts.join("  §8•  ");
}

function tierLabelColor(label) {
  switch (label) {
    case "Lucky": return "§e";
    case "Great": return "§a";
    case "Amazing": return "§b";
    case "Jackpot": return "§6";
    default: return "§f";
  }
}

function playCoinParticle(player, dimension, pos) {
  if (!canPlayEffect(player.name)) return;
  spawnKillEffect(player, { x: pos.x, y: pos.y - 1, z: pos.z });
}

function playGildedDropEffect(player, dimension, pos) {
  playCoinParticle(player, dimension, pos);
  try {
    player.playSound(CONFIG.bonus_sound, {
      pitch: CONFIG.bonus_sound_pitch,
      volume: CONFIG.bonus_sound_volume,
    });
  } catch {}
}

function broadcastMilestone(playerName, streak) {
  const template = CONFIG.streak_milestone_messages[streak];
  if (!template) return;
  world.sendMessage(template.replace("{player}", playerName).replace("{streak}", streak));
}

// ============================================================
// ANTI MOB-STACKING
// ============================================================
const BOSS_IDS = new Set([
  "minecraft:wither", "minecraft:ender_dragon",
  "minecraft:elder_guardian", "minecraft:warden",
]);
const stackCheckCooldown = new Map();

function checkAndCleanStack(player, dimension, pos) {
  const limit = CONFIG.mob_stack_limit;
  if (!limit || limit <= 0) return;
  const now = system.currentTick;
  const last = stackCheckCooldown.get(player.name) ?? -CONFIG.mob_stack_cooldown_ticks;
  if (now - last < CONFIG.mob_stack_cooldown_ticks) return;
  stackCheckCooldown.set(player.name, now);
  try {
    const nearby = dimension
      .getEntities({ location: pos, maxDistance: CONFIG.mob_stack_radius, families: ["monster"] });
    if (nearby.length <= limit) return;
    nearby.sort((a, b) => distSq(a.location, pos) - distSq(b.location, pos));
    const excess = nearby.slice(limit);
    let removed = 0;
    for (const mob of excess) {
      try {
        if (typeof mob.isValid === "function" && !mob.isValid()) continue;
        BOSS_IDS.has(mob.typeId) ? mob.remove() : mob.kill();
        removed++;
      } catch { }
    }
    if (removed > 0) {
      const penalty = CONFIG.mob_stack_coin_penalty;
      const totalPenalty = removed * penalty;
      if (Number.isFinite(penalty) && penalty > 0) {
        takeCoins(player, totalPenalty);
        if (CONFIG.mob_stack_warn)
          player.sendMessage(`§8[§cAnti-Stack§8] §f${removed} §emob excess dihapus! §c-${totalPenalty}⛃`);
      } else if (CONFIG.mob_stack_warn) {
        player.sendMessage(`§8[§cAnti-Stack§8] §f${removed} §emob excess dihapus.`);
      }
    }
  } catch (e) { console.warn("[XP Manager] checkAndCleanStack error:", e); }
}

world.afterEvents.playerLeave.subscribe((event) => {
  const name = event.playerName;
  streakMap.delete(name);
  effectCooldownMap.delete(name);
  stackCheckCooldown.delete(name);
  clearBar(name);
});

// ============================================================
// RESOLVE KILLER
// ============================================================
const PROJECTILE_CAUSES = new Set(["projectile", "magic", "sonicboom", "thorns"]);

function resolveKillerPlayer(event, pos, dimension) {
  const src = event.damageSource;
  const dmgEnt = src?.damagingEntity;
  if (dmgEnt?.typeId === "minecraft:player") return dmgEnt;
  if (src?.cause && PROJECTILE_CAUSES.has(src.cause)) {
    let candidates;
    try { candidates = dimension.getPlayers({ location: pos, maxDistance: 20 }); }
    catch { return null; }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    return candidates.reduce((closest, p) =>
      distSq(p.location, pos) < distSq(closest.location, pos) ? p : closest
    );
  }
  return null;
}

// ============================================================
// [PERF] KILL RATE LIMITER — prevent mob farm TPS drops
// Budget: max 5 kills processed per tick. Excess kills are silently
// skipped (XP/coins not given). This prevents grinder abuse while
// allowing normal gameplay (1-3 kills/tick).
// Refills every tick via system.runInterval.
// ============================================================
const KILL_BUDGET_PER_TICK = 5;
let _killBudget = KILL_BUDGET_PER_TICK;
let _lastBudgetTick = -1;

function _refreshKillBudget() {
  const t = system.currentTick;
  if (t !== _lastBudgetTick) { _killBudget = KILL_BUDGET_PER_TICK; _lastBudgetTick = t; }
}

// ============================================================
// HANDLER UTAMA — entityDie
// [PERF v4.0] Changes from v3:
//   - Kill rate limiter (max 5/tick)
//   - Scoreboard API instead of runCommand for coins
//   - player.playSound() instead of runCommand playsound
//   - families:["monster"] filter for stack check query
//   - Skip stack check AND effect when shouldSkipHeavy()
// ============================================================
world.afterEvents.entityDie.subscribe((event) => {
  const deadEntity = event.deadEntity;
  if (!deadEntity) return;

  const mobId = deadEntity.typeId;
  if (!WHITELIST.has(mobId)) return;

  // [PERF] Kill rate limiter — lazy reset per-tick (no runInterval needed)
  _refreshKillBudget();
  if (_killBudget <= 0) return;
  _killBudget--;

  const baseXP = VANILLA_XP[mobId];
  if (baseXP === undefined) {
    console.warn(`[XP Manager] XP base untuk "${mobId}" tidak ditemukan.`);
    return;
  }

  const finalXP = Math.max(1, Math.round(baseXP * MULTIPLIER));
  const pos = deadEntity.location;
  const dimension = deadEntity.dimension;

  system.run(() => {
    const player = resolveKillerPlayer(event, pos, dimension);
    if (!player) return;

    const playerName = player.name;
    const isHeavy = shouldSkipHeavy();

    giveXP(player, finalXP);

    // [PERF] Skip sound when under heavy load
    if (!isHeavy) playKillSound(player);

    const { given: coinGivenBase, newTotal: dailyAfterBase } = giveCoinsWithCap(player, CONFIG.coin_per_kill);

    // Spawn coin particle setiap dapat koin (skip when heavy)
    if (coinGivenBase > 0 && !isHeavy) playCoinParticle(player, dimension, pos);

    // [PERF] Skip stack check when TPS is under pressure
    if (!isHeavy) checkAndCleanStack(player, dimension, pos);

    const streak = incrementStreak(playerName);
    const isMilestone = CONFIG.streak_milestones.includes(streak);
    if (isMilestone) broadcastMilestone(playerName, streak);

    const isBonusTriggered = Math.random() < getBonusChance(streak);

    let coinTotal = coinGivenBase;
    let dailyFinal = dailyAfterBase;
    let bonusTier = null;

    if (isBonusTriggered) {
      bonusTier = rollBonusTier();
      const coinBonusAmt = coinBonusForTier(bonusTier.label);
      const { given: coinGivenBonus, newTotal: dt } = giveCoinsWithCap(player, coinBonusAmt);
      coinTotal += coinGivenBonus;
      dailyFinal = dt;
      giveXP(player, bonusTier.xp);
      if (!isHeavy) playGildedDropEffect(player, dimension, pos);
    }

    // ── Earned Income Subsidy (bypass daily cap) ──
    // Player miskin (<5000 koin) dapat +1 bonus dari treasury
    if (coinTotal > 0) {
      const sub = applySubsidy(player, SUBSIDY_CFG.KILL_BONUS);
      if (sub > 0) coinTotal += sub;
    }

    // ── Stimulus Boost (stagflation active) ──
    // Extra +2 koin/kill langsung dari treasury saat stimulus aktif
    const stimBoost = getKillSubsidyBoost();
    if (stimBoost > 0) {
      const stim = applySubsidy(player, stimBoost);
      if (stim > 0) coinTotal += stim;
    }

    setBar(player, buildActionbarMsg(streak, bonusTier, coinTotal, dailyFinal), 5, 60);
  });
});