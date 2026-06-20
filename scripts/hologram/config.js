// hologram/config.js — LT Hologram configuration
// Invariant: all magic numbers centralized. Templates frozen.

const HOLO_CFG = Object.freeze({
  ENTITY_TYPE:     "lt:hologram",
  ADMIN_TAG:       "mimi",
  ANIM_INTERVAL:   20,  // separator animation refresh (20 ticks = 1s — synced with wave speed)
  DATA_INTERVAL:   100, // base data refresh (100 ticks = 5s)
  // Tiered refresh multipliers (applied in engine.js):
  //   fast  = every 1× DATA_INTERVAL (5s)  → {time}, {online}, {date}
  //   medium = every 2× DATA_INTERVAL (10s) → {my:...}, {my_name}
  //   slow  = every 6× DATA_INTERVAL (30s)  → {top:...} leaderboards
  TIER_MEDIUM:     2,   // resolve personal scores every 2 data cycles
  TIER_SLOW:       6,   // resolve leaderboards every 6 data cycles
  RESPAWN_DELAY:   80,
  MAX_HOLOS:       50,
  MAX_LINES:       20,
  MAX_TEXT_LEN:    200,
  PROXIMITY_RANGE: 16,
  LINE_GAP:        0.30, // vertical distance between per-line entities
  VIEW_RANGE:      48, // default render distance (blocks) — skip update if no player in range
  COIN_OBJ:        "coin",
  GEM_OBJ:         "gem",
  K_REGISTRY:      "lt_holo:reg",

  TAG_ID:   "lh_id:",
  TAG_HOLO: "lh",

  CYCLE_COLORS: Object.freeze(["§c", "§6", "§e", "§a", "§b", "§d", "§5"]),
  HR_PALETTES: Object.freeze([
    ["§c", "§6", "§e", "§a", "§b", "§9", "§5", "§d"],  // rainbow
    ["§6", "§e", "§f"],                                    // gold shimmer
    ["§b", "§3", "§9"],                                    // ocean
    ["§c", "§6", "§e"],                                    // fire
    ["§9", "§5", "§d"],                                    // royal
  ]),

  // Alignment pad char — thin space for consistent visual width
  PAD_CHAR: " ",
  PAD_MAX:  40, // max padding chars per side

  ALIGNS: Object.freeze({
    center: "Tengah",
    left:   "Kiri",
    right:  "Kanan",
  }),

  PLACEHOLDERS: Object.freeze({
    "{online}":         "Jumlah player online",
    "{time}":           "Waktu WIB (HH:MM)",
    "{date}":           "Tanggal (DD/MM/YYYY)",
    "{day_count}":      "Hari dunia",
    "{top:coin:N}":     "Leaderboard top N koin",
    "{top:gem:N}":      "Leaderboard top N gem",
    "{top:partikel:N}": "Leaderboard top N koleksi partikel",
    "{top:pulls:N}":    "Leaderboard top N total pull",
    "{top:ptpulls:N}":  "Leaderboard top N pull partikel",
    "{top:eqpulls:N}":  "Leaderboard top N pull peralatan",
    "{top:OBJ:N}":      "Leaderboard top N dari scoreboard OBJ",
    "{my:OBJ}":         "Skor player terdekat dari OBJ",
    "{my_name}":        "Nama player terdekat",
    "{day|A|B}":        "Tampil A siang, B malam",
  }),

  ANIMATIONS: Object.freeze({
    none:  "Statis",
    cycle: "Cycle warna",
  }),

  VIEW_RANGES: Object.freeze({
    16:  "16 blok (dekat)",
    32:  "32 blok",
    48:  "48 blok (default)",
    64:  "64 blok",
    128: "128 blok (jauh)",
    0:   "Tanpa batas",
  }),

  TEMPLATES: Object.freeze({
    welcome: Object.freeze({
      name: "Welcome",
      desc: "Selamat datang + info server",
      align: "center",
      lines: Object.freeze([
        "§l§6LAUGHTALE SMP",
        "{hr}",
        "§r§a{online} §7online §8| §7{time} WIB",
        "§r§7Selamat datang, §f{my_name}",
        "{hr}",
        "§r§8» §b/lt:gacha §7Gacha partikel",
        "§r§8» §6/lt:auction §7Lelang item",
        "§r§8» §e/daily §7Hadiah harian",
        "§r§8» §e/store §7Beli material",
        "§r§8» §e/bank §7Transfer koin",
        "{hr}",
      ]),
    }),
    rules: Object.freeze({
      name: "Rules",
      desc: "Peraturan server",
      align: "center",
      lines: Object.freeze([
        "§l§cPERATURAN",
        "{hr}",
        "§r§c1. §fHormati semua player",
        "§r§c2. §fDilarang grief/steal",
        "§r§c3. §fDilarang cheat/hack",
        "§r§c4. §fBahasa sopan di chat",
        "§r§c5. §fJual beli via /bank",
        "{hr}",
        "§r§4Pelanggaran = BAN",
      ]),
    }),
    shop: Object.freeze({
      name: "Shop",
      desc: "Info area toko",
      align: "center",
      lines: Object.freeze([
        "§l§eSHOP",
        "{hr}",
        "§r§8» §b/lt:gacha §7Partikel & Equip",
        "§r§8» §6/lt:auction §7Lelang item",
        "§r§8» §e/store §7Bahan build",
        "{hr}",
        "§r§eKoin §f{my:coin} §8| §bGem §f{my:gem}",
      ]),
    }),
    info: Object.freeze({
      name: "Server Info",
      desc: "Info live server realtime",
      align: "center",
      lines: Object.freeze([
        "§l§bSERVER INFO",
        "{hr}",
        "§r§8» §f{time} §7WIB §8| §f{date}",
        "§r§8» §a{online} §7player online",
        "§r§8» §e★ §7Hari ke-§f{day_count}",
        "§r§8» {day|§e★ §fSiang|§9● §fMalam}",
        "{hr}",
      ]),
    }),
    lb_coin: Object.freeze({
      name: "Top Koin",
      desc: "Leaderboard koin top 10",
      align: "center",
      lines: Object.freeze([
        "§l§eTOP KOIN",
        "{hr}",
        "{top:coin:10}",
        "{hr}",
        "§r§7Koin kamu §8» §e{my:coin}",
      ]),
    }),
    lb_gem: Object.freeze({
      name: "Top Gem",
      desc: "Leaderboard gem top 10",
      align: "center",
      lines: Object.freeze([
        "§l§bTOP GEM",
        "{hr}",
        "{top:gem:10}",
        "{hr}",
        "§r§7Gem kamu §8» §b{my:gem}",
      ]),
    }),
    lb_kills: Object.freeze({
      name: "Top Kills",
      desc: "Leaderboard kills top 10",
      align: "center",
      lines: Object.freeze([
        "§l§cTOP KILLS",
        "{hr}",
        "{top:kills:10}",
        "{hr}",
        "§r§7Kills kamu §8» §c{my:kills}",
      ]),
    }),
    lb_partikel: Object.freeze({
      name: "Top Koleksi Partikel",
      desc: "Leaderboard koleksi partikel top 10",
      align: "center",
      lines: Object.freeze([
        "§l§5TOP PARTIKEL",
        "{hr}",
        "{top:partikel:10}",
        "{hr}",
        "§r§7Koleksi kamu §8» §5{my:partikel}",
      ]),
    }),
    lb_pulls: Object.freeze({
      name: "Top Pulls",
      desc: "Leaderboard total pulls top 10",
      align: "center",
      lines: Object.freeze([
        "§l§eTOP PULLS",
        "{hr}",
        "{top:pulls:10}",
        "{hr}",
        "§r§7Pull kamu §8» §e{my:pulls}",
      ]),
    }),
    mystats: Object.freeze({
      name: "My Stats",
      desc: "Statistik player terdekat",
      align: "center",
      lines: Object.freeze([
        "§l§bSTATS",
        "{hr}",
        "§r§8» §cKills §f{my:kills}",
        "§r§8» §eKoin §f{my:coin}",
        "§r§8» §bGem §f{my:gem}",
        "§r§f{my_name}",
        "{hr}",
      ]),
    }),
    social: Object.freeze({
      name: "Social",
      desc: "Link komunitas",
      align: "center",
      lines: Object.freeze([
        "§l§dKOMUNITAS",
        "{hr}",
        "§r§8» §9Discord §fdiscord.gg/laughtale",
        "§r§8» §bInstagram §f@laughtale.smp",
        "§r§8» §cYouTube §f@LaughtaleSMP",
        "{hr}",
      ]),
    }),
  }),

  HR:      "§8━━━━━━━━━━━━━━━━━━",
  HR_THIN: "§8- - - - - - -",
});

export { HOLO_CFG };
