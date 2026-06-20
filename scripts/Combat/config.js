export const CFG = Object.freeze({
  COIN_OBJ:   "coin",
  ADMIN_TAG:  "mimi",
  PVP_TAG:    "pvp:on",

  MIN_COIN_TO_ENABLE:  100,
  KILL_REWARD_PCT:     10,
  MIN_REWARD:          10,
  MAX_REWARD:          500,

  // ── Hit spam (memukul player non-PvP berulang) ──
  ILLEGAL_HIT_KICK_COUNT:  15,
  ILLEGAL_HIT_WINDOW_MS:   30_000,

  // ── Illegal kill escalation tiers ──
  // Offense count persistent di DP, decay 1 per 1 JAM (sangat lambat)
  OFFENSE_DECAY_MS:    3_600_000,
  K_OFFENSE:           "co:",

  // Tier penalties — index = offenseCount - 1
  // Tier 0 = edukasi. Tier 1+ = hukuman eskalasi.
  OFFENSE_TIERS: [
    // Tier 0: Warning edukasi — debuff ringan, tanpa denda/drop
    { penalty: 0,
      victimRefundPct: 0,
      debuff: { effects: ["slowness 30 1 true", "mining_fatigue 30 1 true"], msg: "§e  Debuff: §7Slow+Fatigue 30 detik" },
      dropInventory: false,
      tempbanMs: 0,
      permaban: false,
      label: "§e[WARNING] Jangan bunuh player non-PvP!" },

    // Tier 1: Denda + debuff + DROP INVENTORY
    { penalty: 5_000,
      victimRefundPct: 100,
      debuff: { effects: ["slowness 60 2 true", "mining_fatigue 60 2 true", "weakness 30 1 true"], msg: "§c  Debuff: §7Slow+Weak+Fatigue 60 detik" },
      dropInventory: true,
      tempbanMs: 0,
      permaban: false,
      label: "§e[!] DENDA 5.000 + DROP INVENTORY" },

    // Tier 2: Denda + DROP + BAN 10 menit
    { penalty: 15_000,
      victimRefundPct: 100,
      debuff: { effects: ["slowness 120 3 true", "weakness 120 2 true", "blindness 15 0 true", "mining_fatigue 120 2 true"], msg: "§c  Debuff: §7Slow+Weak+Blind+Fatigue 2 menit" },
      dropInventory: true,
      tempbanMs: 600_000,
      permaban: false,
      label: "§8[§cBAN§8]§c DENDA 15.000 + DROP + BAN 10 MENIT" },

    // Tier 3+: PERMANENT BAN
    { penalty: 50_000,
      victimRefundPct: 100,
      debuff: null,
      dropInventory: true,
      tempbanMs: 0,
      permaban: true,
      label: "§8[§4§lPERMABAN§8]§4§l DENDA 50.000 + DROP + BAN PERMANENT" },
  ],

  // ── Tempban ──
  K_TEMPBAN:    "ctb:",

  STREAK_MULTIPLIER: [
    { min: 0,  mult: 1.0 },
    { min: 3,  mult: 1.5 },
    { min: 5,  mult: 2.0 },
    { min: 10, mult: 3.0 },
  ],
  STREAK_DECAY_MS:      600_000,
  SESSION_EARN_CAP:     5_000,

  // ── Anti-alt farming ──
  MIN_VICTIM_ONLINE_MS: 300_000,    // Victim harus online >= 5 menit
  ALT_FARM_PENALTY:     50_000,     // Denda maksimal jika terdeteksi

  COMBAT_TAG_TICKS:     300,
  PVP_AUTO_OFF_TICKS:   600,
  COMBAT_LOG_PCT:       15,
  KILL_CD_MS:           60_000,
  GLOBAL_KILL_CD_MS:    30_000,
  TOGGLE_CD_TICKS:      200,
  SAFE_TICKS:           100,
  LAST_ATTACKER_TICKS:  200,

  HUD_INT:              40,
  DEFAULT_HUD_MODE:     "sidebar",

  LAND_DP_KEY:          "mimi_land",

  K_STATS:       "cs:",
  K_LOG:         "c:log",
  K_HUD_MODE:    "ch:",
  K_HUD_ENABLED: "cho:",
  K_DEBT:        "cd:",
  K_KILL_FX:     "ckfx:",

  // Kill Effect Catalog
  // currency: "coin"|"gem", cost: amount, tokenCost: shard requirement
  // sound: array of { id, pitch, vol } — unique IDs across effects
  KILL_EFFECTS: [
    // [Default] Koin — coin pickup chime
    { id: "Games:coins", name: "Koin", icon: "textures/ui/killfx/koin", category: "Default", cost: 0, currency: "coin", tokenCost: 0,
      sound: [
        { id: "random.orb",   pitch: 1.2, vol: 1.0 },
        { id: "note.pling",   pitch: 1.6, vol: 0.5 },
      ] },
    // [Default] Tanpa Efek — silent
    { id: "none", name: "Tanpa Efek", icon: "textures/ui/killfx/noeffect", category: "Default", cost: 0, currency: "coin", tokenCost: 0,
      sound: null },
    // [Effect] Toxic — eerie poisonous brew (15k coin + 3 token)
    { id: "lt:kill_toxic", name: "Toxic", icon: "textures/ui/killfx/toxic", category: "Effect", cost: 15000, currency: "coin", tokenCost: 3,
      sound: [
        { id: "mob.wither.shoot",  pitch: 1.3, vol: 0.9 },
        { id: "mob.witch.drink",   pitch: 1.2, vol: 0.7 },
        { id: "random.fizz",       pitch: 0.8, vol: 0.6 },
      ] },
    // [Premium] Hacker RGB — digital glitch (15 gem + 5 token)
    { id: ["starfish:matrix_poof", "starfish:matrix_rain"], name: "Hacker RGB", icon: "textures/ui/killfx/hacker_rgb", category: "Premium", cost: 15, currency: "gem", tokenCost: 5,
      sound: [
        { id: "mob.shulker.teleport", pitch: 1.8, vol: 0.9 },
        { id: "beacon.activate",      pitch: 2.0, vol: 0.7 },
        { id: "note.pling",           pitch: 2.0, vol: 0.5 },
      ] },
    // [Effect] Gravity Hammer — seismic ground-pound (50k coin + 7 token)
    { id: ["summon:lt:killfx_blackhole"], name: "Gravity Hammer", icon: "textures/ui/killfx/gravity_hammer", category: "Effect", cost: 50000, currency: "coin", tokenCost: 7,
      sound: [
        { id: "random.anvil_land",   pitch: 0.5, vol: 1.0 },
        { id: "mob.ravager.roar",    pitch: 0.6, vol: 0.8 },
        { id: "mob.endermen.portal", pitch: 0.4, vol: 0.6 },
      ] },
    // [Premium] Dragon Fireball — dragon roar + fire (20 gem + 10 token)
    { id: ["summon:lt:killfx_dragon", "particle:player_dragon_smoke", "particle:player_dragon_trail"], name: "Dragon Fireball", icon: "textures/ui/killfx/dragon", category: "Premium", cost: 20, currency: "gem", tokenCost: 10,
      sound: [
        { id: "mob.enderdragon.growl", pitch: 1.4, vol: 1.0 },
        { id: "mob.ghast.fireball",    pitch: 1.0, vol: 0.8 },
        { id: "mob.blaze.breathe",     pitch: 1.2, vol: 0.6 },
      ] },
    // [Premium] Ice Blizzard — frozen howling storm (25 gem + 12 token)
    { id: ["summon:lt:killfx_blizzard"], name: "Ice Blizzard", icon: "textures/ui/killfx/blizzard", category: "Premium", cost: 25, currency: "gem", tokenCost: 12,
      sound: [
        { id: "mob.elderguardian.curse", pitch: 1.6, vol: 0.8 },
        { id: "random.glass",            pitch: 1.4, vol: 0.9 },
        { id: "mob.stray.ambient",        pitch: 0.6, vol: 0.7 },
      ] },
    // [Premium] Crystal Geode — crystalline magic chime (30 gem + 15 token)
    { id: ["summon:lt:killfx_geode", "particle:crystal_spike_particle"], name: "Crystal Geode", icon: "textures/ui/killfx/geode", category: "Premium", cost: 30, currency: "gem", tokenCost: 15,
      sound: [
        { id: "block.amethyst_block.chime",   pitch: 0.8, vol: 1.0 },
        { id: "block.amethyst_cluster.break", pitch: 1.0, vol: 1.0 },
        { id: "conduit.activate",              pitch: 1.0, vol: 0.9 },
        { id: "beacon.deactivate",             pitch: 1.5, vol: 0.7 },
      ] },
  ],

  HR:       "§8═══════════════════",
  HR_THIN:  "§8───────────────────",
});
Object.freeze(CFG.KILL_EFFECTS);
