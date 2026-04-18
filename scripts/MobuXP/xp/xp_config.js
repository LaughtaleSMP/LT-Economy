// ============================================================
// xp_config.js
// Konfigurasi XP Manager — edit file ini untuk mengubah setting
// ============================================================

export const CONFIG = {

  // ============================================================
  // XP MULTIPLIER
  // 100 = vanilla | 200 = 2x lipat | 50 = setengah
  // ============================================================
  xp_multiplier_percent: 200,

  // ============================================================
  // BONUS XP DROP — TIER SYSTEM
  // ============================================================
  bonus_tiers: [
    { label: "Lucky",   xp: 5,  weight: 60 },
    { label: "Great",   xp: 15, weight: 30 },
    { label: "Amazing", xp: 30, weight:  9 },
    { label: "Jackpot", xp: 60, weight:  1 },
  ],

  // ============================================================
  // KILL STREAK
  // ============================================================
  bonus_xp_chance_percent:      10,
  streak_bonus_chance_per_kill:  3,
  streak_max_bonus_chance:      80,

  streak_timeout_seconds: 8,

  streak_milestones: [50],

  streak_milestone_messages: {
    5:  "§7[§aStreak§7] §f{player} §e{streak} kill streak! ",
    10: "§7[§6Streak§7] §f{player} §e{streak} kill streak! ",
    20: "§7[§cStreak§7] §f{player} §e{streak} kill streak! ",
    30: "§7[§4Streak§7] §f{player} §e{streak} kill streak! ",
    50: "§7[§dStreak§7] §f{player} §dMENGGILAKAN!! §e{streak} kill streak! ",
  },

  // ============================================================
  // KILL SOUND
  // ============================================================
  kill_sound:        "note.pling",
  kill_sound_pitch:   2.0,
  kill_sound_volume:  1.0,

  // ============================================================
  // GILDED DROP — Visual & Audio
  // ============================================================
  bonus_sound:        "note.hat",
  bonus_sound_pitch:   1.0,
  bonus_sound_volume:  0.6,

  // ============================================================
  // BATAS MAKSIMAL ORB PER SPAWN
  // (legacy — dipertahankan untuk fallback, tidak dipakai aktif)
  // ============================================================
  max_orb_per_spawn: 60,

  // ============================================================
  // KOIN — Disesuaikan dengan harga gacha peralatan
  //
  // Harga gacha (dari config.js):
  //   EQ_COST_1  = 50 koin  (1x pull)
  //   EQ_COST_10 = 450 koin (10x pull)
  //
  // coin_scoreboard HARUS sama dengan COIN_OBJ di config.js → "coin"
  // ============================================================
  coin_scoreboard:    "coin",

  coin_per_kill:       3,

  coin_bonus_lucky:    5,
  coin_bonus_great:   12,
  coin_bonus_amazing: 25,
  coin_bonus_jackpot: 60,

  // ============================================================
  // ANTI MOB-STACKING
  // Mencegah player sengaja numpuk mob untuk farming XP / kill
  // streak yang bikin server lag.
  //
  // mob_stack_limit       : jumlah maksimal mob (dari whitelist) yang
  //                         boleh ada di radius mob_stack_radius blok
  //                         dari titik kill. Excess langsung dihapus.
  // mob_stack_radius      : radius pengecekan (blok).
  // mob_stack_warn        : kirim pesan ke player saat excess dihapus.
  // mob_stack_cooldown_ticks : jeda antar pengecekan per-player
  //                            (hindari cek tiap kill di area
  //                            yang sama secara berlebihan).
  //
  // mob_stack_coin_penalty : jumlah koin yang DIKURANGI dari player
  //                          per mob excess yang dihapus.
  //                          Set ke 0 untuk menonaktifkan punishment.
  //                          Contoh: 5 → tiap 1 mob excess = -5 koin.
  // ============================================================
  mob_stack_limit:            20,
  mob_stack_radius:            8,
  mob_stack_warn:           true,
  mob_stack_cooldown_ticks:   10,
  mob_stack_coin_penalty:     10,

  // ============================================================
  // WHITELIST MOB
  // ============================================================
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