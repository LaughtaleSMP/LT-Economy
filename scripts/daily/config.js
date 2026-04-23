// daily/config.js
export const DAILY_CFG = {
  RESET_UTC_HOUR: 13,   // 20:00 WIB
  COIN_OBJ: "coin",
  K_LOGIN: "daily:login:",
  K_QUEST: "daily:quest:",
  K_WEEKLY: "daily:weekly:",
  K_MONTHLY: "daily:monthly:",
  K_STATS: "daily:stats:",
  BROADCAST_THRESHOLD: 500,
  HR: "\u00a78\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",

  LOGIN_REWARDS: [
    { day: 1, coin: 25  },
    { day: 2, coin: 30  },
    { day: 3, coin: 40  },
    { day: 4, coin: 50  },
    { day: 5, coin: 75  },
    { day: 6, coin: 100 },
    { day: 7, coin: 200 },
  ],

  // ═══════════════════════════════════════
  // DAILY QUESTS — reset 20:00 WIB
  // ═══════════════════════════════════════
  QUEST_COUNT: 3,
  DAILY_BONUS: 150,
  QUEST_POOL: [
    { type: "kill", target: "minecraft:zombie",          amount: 30, reward: 150, label: "Bunuh 30 Zombie" },
    { type: "kill", target: "minecraft:skeleton",        amount: 25, reward: 150, label: "Bunuh 25 Skeleton" },
    { type: "kill", target: "minecraft:creeper",         amount: 15, reward: 200, label: "Bunuh 15 Creeper" },
    { type: "kill", target: "minecraft:spider",          amount: 20, reward: 150, label: "Bunuh 20 Spider" },
    { type: "kill", target: "minecraft:enderman",        amount: 10, reward: 250, label: "Bunuh 10 Enderman" },
    { type: "kill", target: "minecraft:drowned",         amount: 20, reward: 175, label: "Bunuh 20 Drowned" },
    { type: "kill", target: "minecraft:witch",           amount: 5,  reward: 300, label: "Bunuh 5 Witch" },
    { type: "kill", target: "minecraft:husk",            amount: 20, reward: 150, label: "Bunuh 20 Husk" },
    { type: "kill", target: "minecraft:stray",           amount: 15, reward: 175, label: "Bunuh 15 Stray" },
    { type: "kill", target: "minecraft:cave_spider",     amount: 12, reward: 200, label: "Bunuh 12 Cave Spider" },
    { type: "kill", target: "minecraft:wither_skeleton", amount: 8,  reward: 300, label: "Bunuh 8 Wither Skeleton" },
    { type: "mine", target: "minecraft:stone",            amount: 128, reward: 100, label: "Tambang 128 Stone" },
    { type: "mine", target: "minecraft:coal_ore",         amount: 32,  reward: 150, label: "Tambang 32 Coal Ore" },
    { type: "mine", target: "minecraft:iron_ore",         amount: 20,  reward: 200, label: "Tambang 20 Iron Ore" },
    { type: "mine", target: "minecraft:diamond_ore",      amount: 5,   reward: 300, label: "Tambang 5 Diamond Ore" },
    { type: "mine", target: "minecraft:deepslate",        amount: 200, reward: 100, label: "Tambang 200 Deepslate" },
    { type: "mine", target: "minecraft:gold_ore",         amount: 15,  reward: 200, label: "Tambang 15 Gold Ore" },
    { type: "mine", target: "minecraft:lapis_lazuli_ore", amount: 10,  reward: 175, label: "Tambang 10 Lapis Ore" },
    { type: "place", target: "*", amount: 100,  reward: 100, label: "Pasang 100 Blok" },
    { type: "place", target: "*", amount: 200,  reward: 150, label: "Pasang 200 Blok" },
    { type: "place", target: "*", amount: 500,  reward: 300, label: "Pasang 500 Blok" },
    { type: "submit", target: "minecraft:bread",        amount: 32, reward: 150, label: "Serahkan 32 Bread" },
    { type: "submit", target: "minecraft:iron_ingot",   amount: 16, reward: 200, label: "Serahkan 16 Iron Ingot" },
    { type: "submit", target: "minecraft:gold_ingot",   amount: 8,  reward: 250, label: "Serahkan 8 Gold Ingot" },
    { type: "submit", target: "minecraft:diamond",      amount: 3,  reward: 350, label: "Serahkan 3 Diamond" },
    { type: "submit", target: "minecraft:cooked_beef",  amount: 32, reward: 125, label: "Serahkan 32 Steak" },
    { type: "submit", target: "minecraft:emerald",      amount: 5,  reward: 275, label: "Serahkan 5 Emerald" },
    { type: "submit", target: "minecraft:copper_ingot", amount: 32, reward: 125, label: "Serahkan 32 Copper Ingot" },
  ],

  // ═══════════════════════════════════════
  // WEEKLY QUESTS — reset Senin 20:00 WIB
  // Target ~4-5x daily, Reward ~3-4x
  // ═══════════════════════════════════════
  WEEKLY_COUNT: 4,
  WEEKLY_BONUS: 500,
  WEEKLY_POOL: [
    // Combat — bigger hunts
    { type: "kill", target: "minecraft:zombie",          amount: 120, reward: 500,  label: "Bantai 120 Zombie" },
    { type: "kill", target: "minecraft:skeleton",        amount: 100, reward: 500,  label: "Bantai 100 Skeleton" },
    { type: "kill", target: "minecraft:creeper",         amount: 60,  reward: 600,  label: "Bantai 60 Creeper" },
    { type: "kill", target: "minecraft:spider",          amount: 80,  reward: 500,  label: "Bantai 80 Spider" },
    { type: "kill", target: "minecraft:enderman",        amount: 35,  reward: 750,  label: "Bantai 35 Enderman" },
    { type: "kill", target: "minecraft:drowned",         amount: 80,  reward: 550,  label: "Bantai 80 Drowned" },
    { type: "kill", target: "minecraft:witch",           amount: 20,  reward: 800,  label: "Bantai 20 Witch" },
    { type: "kill", target: "minecraft:wither_skeleton", amount: 25,  reward: 900,  label: "Bantai 25 Wither Skeleton" },
    { type: "kill", target: "minecraft:cave_spider",     amount: 40,  reward: 600,  label: "Bantai 40 Cave Spider" },
    // Mining — deep dives
    { type: "mine", target: "minecraft:stone",            amount: 500,  reward: 400, label: "Tambang 500 Stone" },
    { type: "mine", target: "minecraft:coal_ore",         amount: 120,  reward: 450, label: "Tambang 120 Coal Ore" },
    { type: "mine", target: "minecraft:iron_ore",         amount: 80,   reward: 600, label: "Tambang 80 Iron Ore" },
    { type: "mine", target: "minecraft:diamond_ore",      amount: 18,   reward: 900, label: "Tambang 18 Diamond Ore" },
    { type: "mine", target: "minecraft:deepslate",        amount: 800,  reward: 400, label: "Tambang 800 Deepslate" },
    { type: "mine", target: "minecraft:gold_ore",         amount: 50,   reward: 600, label: "Tambang 50 Gold Ore" },
    { type: "mine", target: "minecraft:lapis_lazuli_ore", amount: 35,   reward: 550, label: "Tambang 35 Lapis Ore" },
    // Building
    { type: "place", target: "*", amount: 500,  reward: 400, label: "Pasang 500 Blok" },
    { type: "place", target: "*", amount: 1000, reward: 600, label: "Pasang 1.000 Blok" },
    { type: "place", target: "*", amount: 2000, reward: 900, label: "Pasang 2.000 Blok" },
    // Submit — bulk delivery
    { type: "submit", target: "minecraft:bread",        amount: 64, reward: 500, label: "Serahkan 64 Bread" },
    { type: "submit", target: "minecraft:iron_ingot",   amount: 32, reward: 600, label: "Serahkan 32 Iron Ingot" },
    { type: "submit", target: "minecraft:gold_ingot",   amount: 16, reward: 700, label: "Serahkan 16 Gold Ingot" },
    { type: "submit", target: "minecraft:diamond",      amount: 8,  reward: 900, label: "Serahkan 8 Diamond" },
    { type: "submit", target: "minecraft:cooked_beef",  amount: 64, reward: 450, label: "Serahkan 64 Steak" },
    { type: "submit", target: "minecraft:emerald",      amount: 15, reward: 800, label: "Serahkan 15 Emerald" },
  ],

  // ═══════════════════════════════════════
  // MONTHLY QUESTS — reset tanggal 1, 20:00 WIB
  // Target ~15-20x daily, Reward ~8-10x
  // Designed for dedicated grinders!
  // ═══════════════════════════════════════
  MONTHLY_COUNT: 5,
  MONTHLY_BONUS: 2500,
  MONTHLY_POOL: [
    // Combat — war campaigns
    { type: "kill", target: "minecraft:zombie",          amount: 500, reward: 1500, label: "Genosida 500 Zombie" },
    { type: "kill", target: "minecraft:skeleton",        amount: 400, reward: 1500, label: "Genosida 400 Skeleton" },
    { type: "kill", target: "minecraft:creeper",         amount: 200, reward: 1800, label: "Genosida 200 Creeper" },
    { type: "kill", target: "minecraft:spider",          amount: 300, reward: 1500, label: "Genosida 300 Spider" },
    { type: "kill", target: "minecraft:enderman",        amount: 100, reward: 2200, label: "Genosida 100 Enderman" },
    { type: "kill", target: "minecraft:drowned",         amount: 250, reward: 1600, label: "Genosida 250 Drowned" },
    { type: "kill", target: "minecraft:witch",           amount: 60,  reward: 2500, label: "Genosida 60 Witch" },
    { type: "kill", target: "minecraft:wither_skeleton", amount: 80,  reward: 2500, label: "Genosida 80 Wither Skel" },
    // Mining — legendary excavation
    { type: "mine", target: "minecraft:stone",            amount: 2000, reward: 1200, label: "Tambang 2.000 Stone" },
    { type: "mine", target: "minecraft:coal_ore",         amount: 400,  reward: 1400, label: "Tambang 400 Coal Ore" },
    { type: "mine", target: "minecraft:iron_ore",         amount: 250,  reward: 1800, label: "Tambang 250 Iron Ore" },
    { type: "mine", target: "minecraft:diamond_ore",      amount: 50,   reward: 2500, label: "Tambang 50 Diamond Ore" },
    { type: "mine", target: "minecraft:deepslate",        amount: 3000, reward: 1200, label: "Tambang 3.000 Deepslate" },
    { type: "mine", target: "minecraft:gold_ore",         amount: 150,  reward: 1800, label: "Tambang 150 Gold Ore" },
    // Building — mega projects
    { type: "place", target: "*", amount: 3000, reward: 1500, label: "Pasang 3.000 Blok" },
    { type: "place", target: "*", amount: 5000, reward: 2200, label: "Pasang 5.000 Blok" },
    // Submit — massive stockpile
    { type: "submit", target: "minecraft:bread",        amount: 128, reward: 1200, label: "Serahkan 128 Bread" },
    { type: "submit", target: "minecraft:iron_ingot",   amount: 64,  reward: 1500, label: "Serahkan 64 Iron Ingot" },
    { type: "submit", target: "minecraft:gold_ingot",   amount: 32,  reward: 1800, label: "Serahkan 32 Gold Ingot" },
    { type: "submit", target: "minecraft:diamond",      amount: 20,  reward: 2500, label: "Serahkan 20 Diamond" },
    { type: "submit", target: "minecraft:emerald",      amount: 30,  reward: 2200, label: "Serahkan 30 Emerald" },
    { type: "submit", target: "minecraft:cooked_beef",  amount: 128, reward: 1200, label: "Serahkan 128 Steak" },
  ],

  // Target disesuaikan ~2 bulan player aktif 2-3 jam/hari
  ACHIEVEMENTS: [
    { id: "kill_1",     cat: "Combat",   stat: "kills",      target: 1,     reward: 50,   label: "Darah Pertama",     desc: "Bunuh 1 mob" },
    { id: "kill_25",    cat: "Combat",   stat: "kills",      target: 25,    reward: 75,   label: "Pemburu Pemula",    desc: "Bunuh 25 mob" },
    { id: "kill_75",    cat: "Combat",   stat: "kills",      target: 75,    reward: 150,  label: "Pemburu",           desc: "Bunuh 75 mob" },
    { id: "kill_200",   cat: "Combat",   stat: "kills",      target: 200,   reward: 300,  label: "Pemburu Handal",    desc: "Bunuh 200 mob" },
    { id: "kill_500",   cat: "Combat",   stat: "kills",      target: 500,   reward: 500,  label: "Slayer",            desc: "Bunuh 500 mob" },
    { id: "kill_1000",  cat: "Combat",   stat: "kills",      target: 1000,  reward: 800,  label: "Pembantai",         desc: "Bunuh 1.000 mob" },
    { id: "kill_2000",  cat: "Combat",   stat: "kills",      target: 2000,  reward: 1200, label: "Eksekutor",         desc: "Bunuh 2.000 mob" },
    { id: "kill_3500",  cat: "Combat",   stat: "kills",      target: 3500,  reward: 2000, label: "Legenda Pembantai", desc: "Bunuh 3.500 mob" },
    { id: "mine_50",    cat: "Mining",   stat: "mined",      target: 50,    reward: 50,   label: "Penggali",          desc: "Tambang 50 blok" },
    { id: "mine_200",   cat: "Mining",   stat: "mined",      target: 200,   reward: 100,  label: "Penambang",         desc: "Tambang 200 blok" },
    { id: "mine_500",   cat: "Mining",   stat: "mined",      target: 500,   reward: 200,  label: "Penambang Sejati",  desc: "Tambang 500 blok" },
    { id: "mine_1200",  cat: "Mining",   stat: "mined",      target: 1200,  reward: 400,  label: "Ahli Tambang",      desc: "Tambang 1.200 blok" },
    { id: "mine_3000",  cat: "Mining",   stat: "mined",      target: 3000,  reward: 750,  label: "Dwarf",             desc: "Tambang 3.000 blok" },
    { id: "mine_5500",  cat: "Mining",   stat: "mined",      target: 5500,  reward: 1200, label: "Raja Tambang",      desc: "Tambang 5.500 blok" },
    { id: "mine_8000",  cat: "Mining",   stat: "mined",      target: 8000,  reward: 2000, label: "Legenda Tambang",   desc: "Tambang 8.000 blok" },
    { id: "place_50",   cat: "Building", stat: "placed",     target: 50,    reward: 50,   label: "Tukang",            desc: "Pasang 50 blok" },
    { id: "place_200",  cat: "Building", stat: "placed",     target: 200,   reward: 100,  label: "Builder",           desc: "Pasang 200 blok" },
    { id: "place_500",  cat: "Building", stat: "placed",     target: 500,   reward: 200,  label: "Builder Handal",    desc: "Pasang 500 blok" },
    { id: "place_1200", cat: "Building", stat: "placed",     target: 1200,  reward: 400,  label: "Arsitek",           desc: "Pasang 1.200 blok" },
    { id: "place_3000", cat: "Building", stat: "placed",     target: 3000,  reward: 750,  label: "Arsitek Hebat",     desc: "Pasang 3.000 blok" },
    { id: "place_5000", cat: "Building", stat: "placed",     target: 5000,  reward: 1200, label: "Master Builder",    desc: "Pasang 5.000 blok" },
    { id: "place_7000", cat: "Building", stat: "placed",     target: 7000,  reward: 2000, label: "Legenda Builder",   desc: "Pasang 7.000 blok" },
    { id: "earn_250",   cat: "Economy",  stat: "earned",     target: 250,   reward: 75,   label: "Punya Uang",        desc: "Kumpulkan total 250 koin" },
    { id: "earn_1000",  cat: "Economy",  stat: "earned",     target: 1000,  reward: 150,  label: "Pekerja Keras",     desc: "Kumpulkan total 1.000 koin" },
    { id: "earn_3000",  cat: "Economy",  stat: "earned",     target: 3000,  reward: 350,  label: "Pengusaha",         desc: "Kumpulkan total 3.000 koin" },
    { id: "earn_6000",  cat: "Economy",  stat: "earned",     target: 6000,  reward: 600,  label: "Kaya Raya",         desc: "Kumpulkan total 6.000 koin" },
    { id: "earn_12000", cat: "Economy",  stat: "earned",     target: 12000, reward: 1000, label: "Konglomerat",       desc: "Kumpulkan total 12.000 koin" },
    { id: "earn_20000", cat: "Economy",  stat: "earned",     target: 20000, reward: 1500, label: "Sultan",            desc: "Kumpulkan total 20.000 koin" },
    { id: "earn_25000", cat: "Economy",  stat: "earned",     target: 25000, reward: 2000, label: "Legenda Ekonomi",   desc: "Kumpulkan total 25.000 koin" },
    { id: "login_3",    cat: "Login",    stat: "loginDays",  target: 3,     reward: 50,   label: "Pendatang",         desc: "Login 3 hari" },
    { id: "login_7",    cat: "Login",    stat: "loginDays",  target: 7,     reward: 100,  label: "Warga Baru",        desc: "Login 7 hari" },
    { id: "login_14",   cat: "Login",    stat: "loginDays",  target: 14,    reward: 200,  label: "Warga Tetap",       desc: "Login 14 hari" },
    { id: "login_30",   cat: "Login",    stat: "loginDays",  target: 30,    reward: 500,  label: "Penduduk Setia",    desc: "Login 30 hari" },
    { id: "login_45",   cat: "Login",    stat: "loginDays",  target: 45,    reward: 800,  label: "Veteran",           desc: "Login 45 hari" },
    { id: "login_60",   cat: "Login",    stat: "loginDays",  target: 60,    reward: 1500, label: "Legenda Server",    desc: "Login 60 hari" },
    { id: "quest_1",    cat: "Quest",    stat: "questsDone", target: 1,     reward: 50,   label: "Petualang",         desc: "Selesaikan 1 quest" },
    { id: "quest_10",   cat: "Quest",    stat: "questsDone", target: 10,    reward: 150,  label: "Petualang Aktif",   desc: "Selesaikan 10 quest" },
    { id: "quest_25",   cat: "Quest",    stat: "questsDone", target: 25,    reward: 300,  label: "Pejuang Quest",     desc: "Selesaikan 25 quest" },
    { id: "quest_50",   cat: "Quest",    stat: "questsDone", target: 50,    reward: 500,  label: "Quest Hunter",      desc: "Selesaikan 50 quest" },
    { id: "quest_100",  cat: "Quest",    stat: "questsDone", target: 100,   reward: 1000, label: "Quest Master",      desc: "Selesaikan 100 quest" },
    { id: "quest_150",  cat: "Quest",    stat: "questsDone", target: 150,   reward: 1500, label: "Legenda Quest",     desc: "Selesaikan 150 quest" },
  ],
};
