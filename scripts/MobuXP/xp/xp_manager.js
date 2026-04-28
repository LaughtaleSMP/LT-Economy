import { world, system } from "@minecraft/server";
import { VANILLA_XP } from "./vanilla_xp.js";
import { CONFIG as _RAW_CONFIG } from "./xp_config.js";
import { setBar, clearBar } from "../shared/actionbar_manager.js";
import { pGet, pSet, getOnlinePlayer } from "../../player_dp.js";

const CONFIG_DEFAULTS = {
  xp_multiplier_percent:        200,
  bonus_tiers: [
    { label: "Lucky",   xp: 5,  weight: 60 },
    { label: "Great",   xp: 15, weight: 30 },
    { label: "Amazing", xp: 30, weight:  9 },
    { label: "Jackpot", xp: 60, weight:  1 },
  ],
  bonus_xp_chance_percent:      5,
  streak_bonus_chance_per_kill:  1,
  streak_max_bonus_chance:      50,
  streak_timeout_seconds:        8,
  streak_milestones:             [50],
  streak_milestone_messages: {
    50: "§7[§dStreak§7] §f{player} §dMENGGILAKAN!! §e{streak} kill streak! ",
  },
  kill_sound:              "note.pling",
  kill_sound_pitch:         2.0,
  kill_sound_volume:        1.0,
  bonus_sound:              "note.hat",
  bonus_sound_pitch:        1.0,
  bonus_sound_volume:       0.6,
  max_orb_per_spawn:        60,
  coin_scoreboard:          "coin",
  coin_per_kill:             1,
  coin_bonus_lucky:          3,
  coin_bonus_great:          8,
  coin_bonus_amazing:       15,
  coin_bonus_jackpot:       30,
  mob_stack_limit:           20,
  mob_stack_radius:           8,
  mob_stack_warn:          true,
  mob_stack_cooldown_ticks:  10,
  mob_stack_coin_penalty:    10,
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
// DAILY SOFT CAP
// Reset jam 20:00 WIB = 13:00 UTC setiap hari
// ============================================================
const RESET_UTC_HOUR  = 13;
const MS_PER_DAY      = 24 * 60 * 60 * 1000;
const K_DAILY_COIN    = "xp:daily_coin:";

// Fase soft cap:
// 0–250     → 100% dapat koin
// 251–450   → 30% chance
// 450+      → 10% chance
const SOFTCAP_PHASE1  = 250;
const SOFTCAP_PHASE2  = 450;
const CHANCE_PHASE2   = 0.30;
const CHANCE_PHASE3   = 0.10;

function getCurrentPeriod() {
  return Math.floor((Date.now() - RESET_UTC_HOUR * 60 * 60 * 1000) / MS_PER_DAY);
}

function getDailyData(playerId) {
  // Coba player DP dulu
  const p = getOnlinePlayer(playerId);
  if (p) {
    const data = pGet(p, K_DAILY_COIN, null);
    if (data) return data;
  }
  // Fallback world DP (legacy)
  try {
    const raw = world.getDynamicProperty(K_DAILY_COIN + playerId);
    if (!raw) return { period: -1, total: 0 };
    return JSON.parse(raw);
  } catch { return { period: -1, total: 0 }; }
}

function setDailyData(playerId, data) {
  const p = getOnlinePlayer(playerId);
  if (p) {
    try { pSet(p, K_DAILY_COIN, data); return; } catch {}
  }
  try { world.setDynamicProperty(K_DAILY_COIN + playerId, JSON.stringify(data)); }
  catch (e) { console.warn("[XP Manager] setDailyData gagal:", e); }
}

function getDailyTotal(playerId) {
  const data = getDailyData(playerId);
  if (data.period !== getCurrentPeriod()) return 0;
  return data.total;
}

// [PERF] addDailyTotal: terima cached raw untuk hindari baca DP ulang.
function addDailyTotal(playerId, amount, cachedData) {
  const period = getCurrentPeriod();
  const data   = cachedData ?? getDailyData(playerId);
  if (data.period !== period) {
    setDailyData(playerId, { period, total: amount });
  } else {
    setDailyData(playerId, { period, total: data.total + amount });
  }
}

function getCoinChance(dailyTotal) {
  if (dailyTotal <= SOFTCAP_PHASE1) return 1.0;
  if (dailyTotal <= SOFTCAP_PHASE2) return CHANCE_PHASE2;
  return CHANCE_PHASE3;
}

function getSoftCapLabel(dailyTotal) {
  if (dailyTotal <= SOFTCAP_PHASE1) return null;
  if (dailyTotal <= SOFTCAP_PHASE2) return "§8[§eSlow§8]";
  return "§8[§cDim§8]";
}

// ============================================================
// DERIVED CONSTANTS
// ============================================================
const MULTIPLIER        = CONFIG.xp_multiplier_percent / 100;
const WHITELIST         = CONFIG.whitelist;
const TIER_TOTAL_WEIGHT = CONFIG.bonus_tiers.reduce((sum, t) => sum + t.weight, 0);
const LOG_MILESTONE_THRESHOLD = 50;

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
  return dx*dx + dy*dy + dz*dz;
}

// ============================================================
// KILL STREAK
// ============================================================
const streakMap = new Map();

function incrementStreak(playerName) {
  const now      = Date.now();
  const existing = streakMap.get(playerName);
  const isExpired = !existing || now >= existing.expireMs;
  const newCount  = isExpired ? 1 : existing.count + 1;
  streakMap.set(playerName, { count: newCount, expireMs: now + CONFIG.streak_timeout_seconds * 1000 });
  return newCount;
}

system.runInterval(() => {
  const now     = Date.now();
  const nowTick = system.currentTick;
  for (const [name, data] of streakMap)
    if (now >= data.expireMs) streakMap.delete(name);
  for (const [name, lastTick] of effectCooldownMap)
    if (nowTick - lastTick > 30) effectCooldownMap.delete(name);
  for (const [name, lastTick] of stackCheckCooldown)
    if (nowTick - lastTick > CONFIG.mob_stack_cooldown_ticks * 4) stackCheckCooldown.delete(name);
}, 100);

function getBonusChance(streak) {
  const base   = CONFIG.bonus_xp_chance_percent;
  const bonus  = streak * CONFIG.streak_bonus_chance_per_kill;
  return Math.min(base + bonus, CONFIG.streak_max_bonus_chance) / 100;
}

// ============================================================
// EFFECT THROTTLE
// ============================================================
const effectCooldownMap     = new Map();
const EFFECT_COOLDOWN_TICKS = 10;

function canPlayEffect(playerName) {
  const cur  = system.currentTick;
  const last = effectCooldownMap.get(playerName) ?? -EFFECT_COOLDOWN_TICKS;
  if (cur - last >= EFFECT_COOLDOWN_TICKS) { effectCooldownMap.set(playerName, cur); return true; }
  return false;
}

function giveXP(player, amount) {
  const rounded = Math.max(1, Math.round(amount));
  try { player.addExperience(rounded); }
  catch { player.runCommand(`xp ${rounded}`); }
}

function playKillSound(player) {
  player.runCommand(`playsound ${CONFIG.kill_sound} @s ~ ~ ~ ${CONFIG.kill_sound_volume} ${CONFIG.kill_sound_pitch}`);
}

// ============================================================
// GIVE COINS — dengan soft cap probabilitas
// [OPT] getDailyData dipanggil SEKALI, reuse di getDailyTotal + addDailyTotal.
// Sebelumnya: 2 DP reads (getDailyTotal + addDailyTotal baca lagi).
// Sekarang: 1 DP read + 1 DP write = hemat 1 read per kill.
// ============================================================
function giveCoinsWithCap(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { given: 0, newTotal: getDailyTotal(player.id) };
  }
  const scoreboard = CONFIG.coin_scoreboard;
  if (typeof scoreboard !== "string" || scoreboard.trim() === "") {
    console.error(`[XP Manager] giveCoins GAGAL: coin_scoreboard tidak valid.`);
    return { given: 0, newTotal: 0 };
  }
  // [PERF] Baca raw data 1x, reuse di chance check + addDailyTotal
  const rawData    = getDailyData(player.id);
  const period     = getCurrentPeriod();
  const dailyTotal = rawData.period === period ? rawData.total : 0;
  const chance     = getCoinChance(dailyTotal);
  if (Math.random() >= chance) return { given: 0, newTotal: dailyTotal };
  const given = Math.floor(amount);
  player.runCommand(`scoreboard players add @s ${scoreboard} ${given}`);
  addDailyTotal(player.id, given, rawData);
  return { given, newTotal: dailyTotal + given };
}

function takeCoins(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const scoreboard = CONFIG.coin_scoreboard;
  if (typeof scoreboard !== "string" || scoreboard.trim() === "") return;
  player.runCommand(`scoreboard players remove @s ${scoreboard} ${Math.floor(amount)}`);
}

function coinBonusForTier(tierLabel) {
  const map = {
    "Lucky":   CONFIG.coin_bonus_lucky,
    "Great":   CONFIG.coin_bonus_great,
    "Amazing": CONFIG.coin_bonus_amazing,
    "Jackpot": CONFIG.coin_bonus_jackpot,
  };
  const val = map[tierLabel];
  return Number.isFinite(val) ? val : 0;
}

// ============================================================
// ACTIONBAR
// ============================================================
function buildActionbarMsg(streak, bonusTier, coinGiven, dailyTotal) {
  const killPart  = `§f⚔ §e${streak} Kill`;
  const coinPart  = coinGiven > 0 ? ` §8| §6+${coinGiven}⛃` : "";
  const capLabel  = getSoftCapLabel(dailyTotal);
  const capPart   = capLabel ? ` ${capLabel}` : "";

  if (bonusTier) {
    const tierColor = tierLabelColor(bonusTier.label);
    const bonusPart = `${tierColor}✦ ${bonusTier.label}! §f+${bonusTier.xp} XP`;
    return `${killPart} §8| ${bonusPart}${coinPart}${capPart}`;
  }
  return `${killPart}${coinPart}${capPart}`;
}

function tierLabelColor(label) {
  switch (label) {
    case "Lucky":   return "§e";
    case "Great":   return "§a";
    case "Amazing": return "§b";
    case "Jackpot": return "§6";
    default:        return "§f";
  }
}

function playGildedDropEffect(player, dimension, pos) {
  if (!canPlayEffect(player.name)) return;
  try { dimension.spawnParticle("minecraft:Games:coins", { x: pos.x, y: pos.y + 1, z: pos.z }); }
  catch { player.runCommand(`particle minecraft:Games:coins ${pos.x} ${pos.y + 1} ${pos.z}`); }
  player.runCommand(`playsound ${CONFIG.bonus_sound} @s ~ ~ ~ ${CONFIG.bonus_sound_volume} ${CONFIG.bonus_sound_pitch}`);
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
  const now  = system.currentTick;
  const last = stackCheckCooldown.get(player.name) ?? -CONFIG.mob_stack_cooldown_ticks;
  if (now - last < CONFIG.mob_stack_cooldown_ticks) return;
  stackCheckCooldown.set(player.name, now);
  try {
    const nearby = dimension
      .getEntities({ location: pos, maxDistance: CONFIG.mob_stack_radius })
      .filter(e => { try { return WHITELIST.has(e.typeId); } catch { return false; } });
    if (nearby.length <= limit) return;
    nearby.sort((a, b) => distSq(a.location, pos) - distSq(b.location, pos));
    const excess = nearby.slice(limit);
    let removed  = 0;
    for (const mob of excess) {
      try {
        if (typeof mob.isValid === "function" && !mob.isValid()) continue;
        BOSS_IDS.has(mob.typeId) ? mob.remove() : mob.kill();
        removed++;
      } catch {}
    }
    if (removed > 0) {
      const penalty      = CONFIG.mob_stack_coin_penalty;
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
  const src    = event.damageSource;
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
// HANDLER UTAMA — entityDie
// ============================================================
world.afterEvents.entityDie.subscribe((event) => {
  const deadEntity = event.deadEntity;
  if (!deadEntity) return;

  const mobId = deadEntity.typeId;
  if (!WHITELIST.has(mobId)) return;

  const baseXP = VANILLA_XP[mobId];
  if (baseXP === undefined) {
    console.warn(`[XP Manager] XP base untuk "${mobId}" tidak ditemukan.`);
    return;
  }

  const finalXP   = Math.max(1, Math.round(baseXP * MULTIPLIER));
  const pos       = deadEntity.location;
  const dimension = deadEntity.dimension;

  system.run(() => {
    const player = resolveKillerPlayer(event, pos, dimension);
    if (!player) return;

    const playerName = player.name;

    giveXP(player, finalXP);
    playKillSound(player);

    // [OPT] giveCoinsWithCap kini mengembalikan { given, newTotal } sehingga
    // kita tidak perlu memanggil getDailyTotal() lagi secara terpisah.
    // Sebelumnya: 3x getDailyTotal per kill (2 implicit + 1 explicit).
    // Sekarang: 1x per giveCoinsWithCap call = 2x total, hemat 1 DP read per kill.
    const { given: coinGivenBase, newTotal: dailyAfterBase } = giveCoinsWithCap(player, CONFIG.coin_per_kill);

    checkAndCleanStack(player, dimension, pos);

    const streak      = incrementStreak(playerName);
    const isMilestone = CONFIG.streak_milestones.includes(streak);
    if (isMilestone) broadcastMilestone(playerName, streak);

    const isBonusTriggered = Math.random() < getBonusChance(streak);

    if (isBonusTriggered) {
      const tier                                              = rollBonusTier();
      const coinBonusAmt                                      = coinBonusForTier(tier.label);
      const { given: coinGivenBonus, newTotal: dailyFinal }  = giveCoinsWithCap(player, coinBonusAmt);
      const coinTotal                                         = coinGivenBase + coinGivenBonus;

      giveXP(player, tier.xp);
      playGildedDropEffect(player, dimension, pos);

      // dailyFinal sudah di-return dari giveCoinsWithCap, tidak perlu baca lagi
      setBar(player, buildActionbarMsg(streak, tier, coinTotal, dailyFinal), 5, 60);
    } else {
      setBar(player, buildActionbarMsg(streak, null, coinGivenBase, dailyAfterBase), 5, 60);
    }
  });
});

