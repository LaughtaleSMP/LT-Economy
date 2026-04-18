// ============================================================
// xp_manager.js
// XP Manager — Gilded Drop + Kill Streak + Global Chat + Koin Gacha
// ============================================================

import { world, system } from "@minecraft/server";
import { VANILLA_XP } from "./vanilla_xp.js";
import { CONFIG as _RAW_CONFIG } from "./xp_config.js";
import { setBar, clearBar } from "../shared/actionbar_manager.js";

// ============================================================
// CONFIG NORMALIZATION — default fallback untuk key yang hilang
// ============================================================
const CONFIG_DEFAULTS = {
  xp_multiplier_percent:        200,

  bonus_tiers: [
    { label: "Lucky",   xp: 5,  weight: 60 },
    { label: "Great",   xp: 15, weight: 30 },
    { label: "Amazing", xp: 30, weight:  9 },
    { label: "Jackpot", xp: 60, weight:  1 },
  ],

  bonus_xp_chance_percent:      10,
  streak_bonus_chance_per_kill:  3,
  streak_max_bonus_chance:      80,
  streak_timeout_seconds:        8,
  streak_milestones:             [5, 10, 20, 30, 50],
  streak_milestone_messages: {
    5:  "§7[§aStreak§7] §f{player} §e{streak} kill streak! ",
    10: "§7[§6Streak§7] §f{player} §e{streak} kill streak! ",
    20: "§7[§cStreak§7] §f{player} §e{streak} kill streak! ",
    30: "§7[§4Streak§7] §f{player} §e{streak} kill streak! ",
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
  coin_bonus_lucky:          2,
  coin_bonus_great:          5,
  coin_bonus_amazing:       10,
  coin_bonus_jackpot:       25,

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

// ============================================================
// STARTUP CONFIG VALIDATION
// ============================================================
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

  const missing = required.filter(
    (key) => _RAW_CONFIG[key] === undefined || _RAW_CONFIG[key] === null
  );

  if (missing.length > 0) {
    console.warn(
      `[XP Manager] ⚠ xp_config.js TIDAK LENGKAP — key yang hilang: ${missing.join(", ")}. ` +
      `Nilai default dipakai sebagai fallback.`
    );
  } else {
    console.log(`[XP Manager] xp_config.js OK — semua key ditemukan.`);
  }
})();

// ============================================================
// DERIVED CONSTANTS
// ============================================================
const MULTIPLIER        = CONFIG.xp_multiplier_percent / 100;
const WHITELIST         = CONFIG.whitelist;
const TIER_TOTAL_WEIGHT = CONFIG.bonus_tiers.reduce((sum, t) => sum + t.weight, 0);

// ============================================================
// LOG MILESTONE — threshold console log per-player
// Hanya log ke console saat streak mencapai angka tertentu.
// ============================================================
const LOG_MILESTONE_THRESHOLD = 50;

function rollBonusTier() {
  let roll = Math.random() * TIER_TOTAL_WEIGHT;
  for (const tier of CONFIG.bonus_tiers) {
    roll -= tier.weight;
    if (roll <= 0) return tier;
  }
  return CONFIG.bonus_tiers[0];
}

// ============================================================
// HELPER: Jarak kuadrat (tanpa sqrt, cukup untuk perbandingan)
// ============================================================
function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ============================================================
// KILL STREAK
// Timeout pakai Date.now() (real-time ms), bukan tick.
// ============================================================
const streakMap = new Map(); // playerName -> { count, expireMs }

function incrementStreak(playerName) {
  const now      = Date.now();
  const existing = streakMap.get(playerName);

  const isExpired = !existing || now >= existing.expireMs;
  const newCount  = isExpired ? 1 : existing.count + 1;

  streakMap.set(playerName, {
    count:    newCount,
    expireMs: now + CONFIG.streak_timeout_seconds * 1000,
  });

  return newCount;
}

// Cleanup streak + effect cooldown + stackCheck cooldown setiap 100 tick
// Digabung jadi SATU interval agar tidak ada beban interval ganda.
system.runInterval(() => {
  const now      = Date.now();
  const nowTick  = system.currentTick;

  for (const [name, data] of streakMap) {
    if (now >= data.expireMs) streakMap.delete(name);
  }

  // Bersihkan effectCooldownMap dari entry stale (>30 tick lalu)
  for (const [name, lastTick] of effectCooldownMap) {
    if (nowTick - lastTick > 30) effectCooldownMap.delete(name);
  }

  // Bersihkan stackCheckCooldown dari entry stale
  for (const [name, lastTick] of stackCheckCooldown) {
    if (nowTick - lastTick > CONFIG.mob_stack_cooldown_ticks * 4) stackCheckCooldown.delete(name);
  }
}, 100);

function getBonusChance(streak) {
  const base        = CONFIG.bonus_xp_chance_percent;
  const streakBonus = streak * CONFIG.streak_bonus_chance_per_kill;
  const total       = Math.min(base + streakBonus, CONFIG.streak_max_bonus_chance);
  return total / 100;
}

// ============================================================
// EFFECT THROTTLE — cooldown efek visual per player
// ============================================================
const effectCooldownMap = new Map();
const EFFECT_COOLDOWN_TICKS = 10;

function canPlayEffect(playerName) {
  const currentTick = system.currentTick;
  const lastTick    = effectCooldownMap.get(playerName) ?? -EFFECT_COOLDOWN_TICKS;

  if (currentTick - lastTick >= EFFECT_COOLDOWN_TICKS) {
    effectCooldownMap.set(playerName, currentTick);
    return true;
  }
  return false;
}

// ============================================================
// BERI XP LANGSUNG KE PLAYER
// ============================================================
function giveXP(player, amount) {
  const rounded = Math.max(1, Math.round(amount));
  try {
    player.addExperience(rounded);
  } catch {
    player.runCommand(`xp ${rounded}`);
  }
}

function playKillSound(player) {
  player.runCommand(
    `playsound ${CONFIG.kill_sound} @s ~ ~ ~ ` +
    `${CONFIG.kill_sound_volume} ${CONFIG.kill_sound_pitch}`
  );
}

// ============================================================
// HELPER: Beri koin ke player via scoreboard
// ============================================================
function giveCoins(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const scoreboard = CONFIG.coin_scoreboard;
  if (typeof scoreboard !== "string" || scoreboard.trim() === "") {
    console.error(`[XP Manager] giveCoins GAGAL: coin_scoreboard tidak valid → "${scoreboard}".`);
    return;
  }

  player.runCommand(`scoreboard players add @s ${scoreboard} ${Math.floor(amount)}`);
}

// ============================================================
// HELPER: Kurangi koin dari player (punishment anti-stack)
// ============================================================
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
// HELPER: Bangun teks actionbar
// ============================================================
function buildActionbarMsg(streak, bonusTier, coinGiven) {
  const killPart = `§f⚔ §e${streak} Kill`;
  const coinPart = coinGiven > 0 ? ` §7| §6+${coinGiven} Koin` : "";

  if (bonusTier) {
    const tierColor = tierLabelColor(bonusTier.label);
    const bonusPart = `${tierColor}❆ ${bonusTier.label}! §f+${bonusTier.xp} XP`;
    return `${killPart} §7|  ${bonusPart}${coinPart}`;
  }

  return `${killPart}${coinPart}`;
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

// ============================================================
// HELPER: Efek Gilded Drop (partikel + suara)
// ============================================================
function playGildedDropEffect(player, dimension, pos) {
  if (!canPlayEffect(player.name)) return;

  try {
    dimension.spawnParticle("minecraft:totem_particle", {
      x: pos.x,
      y: pos.y + 1,
      z: pos.z,
    });
  } catch (_) {
    player.runCommand(
      `particle minecraft:totem_particle ${pos.x} ${pos.y + 1} ${pos.z}`
    );
  }

  player.runCommand(
    `playsound ${CONFIG.bonus_sound} @s ~ ~ ~ ` +
    `${CONFIG.bonus_sound_volume} ${CONFIG.bonus_sound_pitch}`
  );
}

// ============================================================
// HELPER: Broadcast milestone + console log hanya di threshold
// ============================================================
function broadcastMilestone(playerName, streak) {
  const template = CONFIG.streak_milestone_messages[streak];
  if (!template) return;

  const message = template
    .replace("{player}", playerName)
    .replace("{streak}", streak);

  world.sendMessage(message);

  // Console log HANYA di milestone 50 (tidak mengotori log)
  if (streak >= LOG_MILESTONE_THRESHOLD) {
    console.log(
      `[XP Manager] 🔥 MILESTONE ${streak} — Player: ${playerName}`
    );
  }
}

// ============================================================
// ANTI MOB-STACKING
// ============================================================
const BOSS_IDS = new Set([
  "minecraft:wither",
  "minecraft:ender_dragon",
  "minecraft:elder_guardian",
  "minecraft:warden",
]);

const stackCheckCooldown = new Map(); // playerName -> lastCheckTick

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
      .filter(e => {
        try { return WHITELIST.has(e.typeId); } catch { return false; }
      });

    if (nearby.length <= limit) return;

    nearby.sort((a, b) => distSq(a.location, pos) - distSq(b.location, pos));

    const excess  = nearby.slice(limit);
    let removed   = 0;

    for (const mob of excess) {
      try {
        if (typeof mob.isValid === "function" && !mob.isValid()) continue;
        if (BOSS_IDS.has(mob.typeId)) {
          mob.remove();
        } else {
          mob.kill();
        }
        removed++;
      } catch { /* entity invalid */ }
    }

    if (removed > 0) {
      const penalty      = CONFIG.mob_stack_coin_penalty;
      const totalPenalty = removed * penalty;

      console.warn(
        `[XP Manager] Anti-Stack: ${removed} mob excess — Player: ${player.name}` +
        (penalty > 0 ? ` | Penalty: -${totalPenalty} koin` : "")
      );

      if (Number.isFinite(penalty) && penalty > 0) {
        takeCoins(player, totalPenalty);

        if (CONFIG.mob_stack_warn) {
          player.sendMessage(
            `§7[§cAnti-Stack§7] §f${removed} §emob excess dihapus! ` +
            `§cPenalty: -${totalPenalty} koin §7(${removed} mob x ${penalty} koin/mob)§7.`
          );
        }
      } else if (CONFIG.mob_stack_warn) {
        player.sendMessage(
          `§7[§cAnti-Stack§7] §f${removed} §emob excess dihapus di areamu untuk mencegah lag server.`
        );
      }
    }
  } catch (e) {
    console.warn("[XP Manager] checkAndCleanStack error:", e);
  }
}

// ============================================================
// CLEANUP saat player disconnect
// ============================================================
world.afterEvents.playerLeave.subscribe((event) => {
  const name = event.playerName;
  streakMap.delete(name);
  effectCooldownMap.delete(name);
  stackCheckCooldown.delete(name);
  clearBar(name);
});

// ============================================================
// RESOLVE KILLER PLAYER
// ============================================================
const PROJECTILE_CAUSES = new Set(["projectile", "magic", "sonicboom", "thorns"]);

function resolveKillerPlayer(event, pos, dimension) {
  const src    = event.damageSource;
  const dmgEnt = src?.damagingEntity;

  if (dmgEnt?.typeId === "minecraft:player") {
    return dmgEnt;
  }

  if (src?.cause && PROJECTILE_CAUSES.has(src.cause)) {
    let candidates;
    try {
      candidates = dimension.getPlayers({ location: pos, maxDistance: 20 });
    } catch {
      return null;
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    return candidates.reduce((closest, p) => {
      return distSq(p.location, pos) < distSq(closest.location, pos) ? p : closest;
    });
  }

  return null;
}

// ============================================================
// HANDLER: XP + Koin saat mob mati
// Console log DIHAPUS dari sini — tidak mengotori log setiap kill.
// Log penting tetap ada: Anti-Stack warn, Milestone 50.
// ============================================================
world.afterEvents.entityDie.subscribe((event) => {
  const deadEntity = event.deadEntity;
  if (!deadEntity) return;

  const mobId = deadEntity.typeId;
  if (!WHITELIST.has(mobId)) return;

  const baseXP = VANILLA_XP[mobId];
  if (baseXP === undefined) {
    console.warn(`[XP Manager] XP base untuk "${mobId}" tidak ditemukan di vanilla_xp.js`);
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
    giveCoins(player, CONFIG.coin_per_kill);

    checkAndCleanStack(player, dimension, pos);

    const streak      = incrementStreak(playerName);
    const isMilestone = CONFIG.streak_milestones.includes(streak);

    if (isMilestone) {
      broadcastMilestone(playerName, streak);
    }

    const bonusChance      = getBonusChance(streak);
    const isBonusTriggered = Math.random() < bonusChance;

    if (isBonusTriggered) {
      const tier      = rollBonusTier();
      const coinBonus = coinBonusForTier(tier.label);
      const coinTotal = CONFIG.coin_per_kill + coinBonus;

      giveXP(player, tier.xp);
      playGildedDropEffect(player, dimension, pos);
      giveCoins(player, coinBonus);

      setBar(player, buildActionbarMsg(streak, tier, coinTotal), 5, 60);

      // Log hanya Jackpot (event langka, tidak spam)
      if (tier.label === "Jackpot") {
        console.log(
          `[XP Manager] 💰 JACKPOT! ${mobId}` +
          ` | Bonus: +${tier.xp} XP +${coinTotal} Koin` +
          ` | Streak: ${streak}` +
          ` | Player: ${playerName}`
        );
      }
    } else {
      setBar(player, buildActionbarMsg(streak, null, CONFIG.coin_per_kill), 5, 60);
    }
  });
});

console.log(
  `[XP Manager] Aktif!` +
  ` | Multiplier: ${CONFIG.xp_multiplier_percent}%` +
  ` | Tier: ${CONFIG.bonus_tiers.map(t => `${t.label}(${t.xp}xp)`).join(", ")}` +
  ` | Max Chance: ${CONFIG.streak_max_bonus_chance}%` +
  ` | Anti-Stack: limit=${CONFIG.mob_stack_limit} radius=${CONFIG.mob_stack_radius}blok penalty=${CONFIG.mob_stack_coin_penalty}koin/mob` +
  ` | Koin/Kill: ${CONFIG.coin_per_kill}` +
  ` | Whitelist: ${WHITELIST.size} mob`
);