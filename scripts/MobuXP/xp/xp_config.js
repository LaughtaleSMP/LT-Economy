export const CONFIG = {

  xp_multiplier_percent: 200,

  bonus_tiers: [
    { label: "Lucky",   xp: 5,  weight: 60 },
    { label: "Great",   xp: 15, weight: 30 },
    { label: "Amazing", xp: 30, weight:  9 },
    { label: "Jackpot", xp: 60, weight:  1 },
  ],

  bonus_xp_chance_percent:      5,
  streak_bonus_chance_per_kill:  1,
  streak_max_bonus_chance:      50,

  streak_timeout_seconds: 8,
  streak_milestones: [50],
  streak_milestone_messages: {
    50: "§7[§dStreak§7] §f{player} §dMENGGILAKAN!! §e{streak} kill streak! ",
  },

  kill_sound:        "note.pling",
  kill_sound_pitch:   2.0,
  kill_sound_volume:  1.0,

  bonus_sound:        "note.hat",
  bonus_sound_pitch:   1.0,
  bonus_sound_volume:  0.6,

  max_orb_per_spawn: 60,

  coin_scoreboard:    "coin",
  coin_per_kill:       1,
  coin_bonus_lucky:    3,
  coin_bonus_great:    8,
  coin_bonus_amazing: 15,
  coin_bonus_jackpot: 30,

  mob_stack_limit:            20,
  mob_stack_radius:            8,
  mob_stack_warn:           true,
  mob_stack_cooldown_ticks:   10,
  mob_stack_coin_penalty:     10,

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