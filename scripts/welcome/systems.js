// welcome/systems.js — Guide pages untuk fitur sistem (non-ekonomi):
// Gacha, TreeCap, Mimi Land, Combat PvP, Leaderboard, Dragon Update, Event.
import { ActionFormData } from "@minecraft/server-ui";
import { HR, HR_THIN, readPricing } from "./_shared.js";
// Import CFG Combat agar persen reward & streak multiplier tetap single
// source of truth (kalau tuning balance berubah, guide ikut update otomatis).
import { CFG as CFG_PVP } from "../Combat/config.js";

export async function guideGacha(player) {
  const pr = readPricing();
  const eq1 = pr?.eq1 ?? 50;
  const eq10 = pr?.eq10 ?? 450;
  const pityR = Math.max(30, Math.round(15000 / eq1));
  const pityL = Math.max(50, Math.round(25000 / eq1));

  let body = `${HR}\n`;
  body += `§d  ★ GACHA SYSTEM\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem gacha dengan animasi\n`;
  body += `  §fpremium di chest interaktif.\n\n`;
  body += `  §eDUA TIPE GACHA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §5✦ §fGacha Partikel §8── §fbayar §bGem\n`;
  body += `  §8│ §8  1x=§b10 Gem§8, 10x=§b90 Gem §8(tetap)\n`;
  body += `  §8└ §6★ §fGacha Peralatan §8── §fbayar §eKoin\n`;
  body += `  §8   §8  1x=§e${eq1} Koin§8, 10x=§e${eq10} Koin\n`;
  body += `  §8   §8  §7(dinamis ikut ekonomi server)\n\n`;
  body += `  §eFITUR\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fPull 1x atau 10x\n`;
  body += `  §8├ §fPity: Rare+ setiap §e${pityR}x §fpull\n`;
  body += `  §8├ §fPity: Legend setiap §e${pityL}x §fpull\n`;
  body += `  §8├ §fDuplikat = refund §b5 Gem\n`;
  body += `  §8├ §fLeaderboard & statistik\n`;
  body += `  §8└ §fAnimasi roll di chest\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKetik §e/gacha §fdi chat\n`;
  body += `  §8└ §fAtau klik chest gacha terdaftar\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §dGACHA§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideTreecap(player) {
  let body = `${HR}\n`;
  body += `§a  ★ TREE CAPITATOR\n`;
  body += `${HR}\n\n`;
  body += `  §fTebang seluruh pohon sekaligus\n`;
  body += `  §fdengan satu kali potong!\n\n`;
  body += `  §eCARA PAKAI\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §f1. Pegang §ekapak §f(jenis apapun)\n`;
  body += `  §8├ §f2. Tebang satu blok log/batang\n`;
  body += `  §8├ §f3. Seluruh pohon langsung tumbang\n`;
  body += `  §8└ §f4. Daun/wart ikut hancur otomatis\n\n`;
  body += `  §eBATAS LOG PER KAPAK\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §7Wooden/Stone  §8── §f8 log\n`;
  body += `  §8├ §fIron/Golden   §8── §f12 log\n`;
  body += `  §8├ §bDiamond       §8── §f24 log\n`;
  body += `  §8└ §dNetherite     §8── §f48 log\n\n`;
  body += `  §ePOHON YANG DIDUKUNG\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §aOverworld §8── §fSemua jenis log & daun\n`;
  body += `  §8├ §cNether    §8── §fStem & wart block\n`;
  body += `  §8└ §5Mushroom  §8── §fMushroom block & stem\n\n`;
  body += `  §eFITUR TAMBAHAN\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fDurabilitas kapak berkurang per log\n`;
  body += `  §8├ §fCooldown otomatis antar tebang\n`;
  body += `  §8├ §e/ltcap on §8── §faktifkan TreeCap\n`;
  body += `  §8├ §e/ltcap off §8── §fmatikan TreeCap\n`;
  body += `  §8├ §e/ltcap status §8── §fcek status\n`;
  body += `  §8└ §eAuto-OFF §8── §fmati otomatis jika idle\n`;
  body += `  §8  §8  (default 60 detik tidak dipakai)\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §aTREECAP§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideLand(player) {
  let body = `${HR}\n`;
  body += `§2  ★ MIMI LAND\n`;
  body += `${HR}\n\n`;
  body += `  §fKlaim dan lindungi area milikmu\n`;
  body += `  §fdari player lain!\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKlaim area dengan beli koin\n`;
  body += `  §8├ §fHarga dinamis ikut ekonomi server\n`;
  body += `  §8├ §fProteksi build/break/interact\n`;
  body += `  §8├ §fWhitelist teman di area\n`;
  body += `  §8├ §fPublic/Private mode\n`;
  body += `  §8├ §fRefund saat hapus land\n`;
  body += `  §8├ §fBayar §bGem §8── §bdiskon 99%% + bebas PPN\n`;
  body += `  §8└ §fHarga berdasarkan luas area\n\n`;
  body += `  §eCARA PAKAI\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §f1. Pegang item §2Mimi Land\n`;
  body += `  §8├ §f2. §eShift+klik §fblok untuk titik 1\n`;
  body += `  §8├ §f3. §eShift+klik §fblok untuk titik 2\n`;
  body += `  §8├ §f4. §eKlik biasa §f(tanpa shift) buka menu\n`;
  body += `  §8└ §f5. Buat land dari menu\n\n`;
  body += `  §c§lAUTO-CLEANUP\n`;
  body += `${HR_THIN}\n`;
  body += `  §c⚠ §fLand §cotomatis dihapus §fjika owner\n`;
  body += `  §ftidak login selama §c14 hari§f.\n`;
  body += `  §8├ §fTidak ada refund otomatis.\n`;
  body += `  §8└ §fLogin rutin untuk jaga land!\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §2MIMI LAND§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideCombat(player) {
  let body = `${HR}\n`;
  body += `§c  ★ COMBAT PvP\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem PvP §eOTOMATIS §fterintegrasi koin.\n`;
  body += `  §fKill musuh = dapat koin!\n\n`;
  body += `  §eCARA KERJA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §c1. §fPukul player lain\n`;
  body += `  §8│ §8   -> PvP-mu §cotomatis aktif\n`;
  body += `  §8│ §8   -> Hit pertama §7tidak melukai\n`;
  body += `  §8├ §c2. §fLawan pukul balik\n`;
  body += `  §8│ §8   -> PvP lawan §cotomatis aktif\n`;
  body += `  §8│ §8   -> Pertarungan dimulai!\n`;
  body += `  §8└ §c3. §fIdle §e30 detik\n`;
  body += `  §8     -> PvP §aotomatis nonaktif\n\n`;
  // Streak multiplier dari config
  const streakStr = (CFG_PVP.STREAK_MULTIPLIER || [])
    .filter(t => t.mult > 1)
    .map(t => `${t.min} kill §a${t.mult}x§7`)
    .join(" §8· §7");

  body += `  §eFITUR\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKill Reward §8── §7dapat §a${CFG_PVP.KILL_REWARD_PCT}%%§7 koin korban\n`;
  body += `  §8│ §8  §7(min §a${CFG_PVP.MIN_REWARD}§7, max §a${CFG_PVP.MAX_REWARD}§7 koin)\n`;
  body += `  §8├ §fStreak Mult §8── §7${streakStr}\n`;
  body += `  §8├ §fCombat Tag §8── §715s tidak bisa idle-off\n`;
  body += `  §8├ §fHUD Stats §8── §7actionbar realtime\n`;
  body += `  §8├ §fMin. Koin §8── §7harus punya §a${CFG_PVP.MIN_COIN_TO_ENABLE}§7 koin\n`;
  body += `  §8└ §fLand Protect §8── §7PvP off di area land\n\n`;
  body += `  §4HUKUMAN MEMBUNUH NON-PVP\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §f1x: §c-5.000 Koin §8+ drop semua item\n`;
  body += `  §8├ §f2x: §c-15.000 Koin §8+ drop + §4ban 10 menit\n`;
  body += `  §8├ §f3x: §c-50.000 Koin §8+ drop + §4BAN PERMANENT\n`;
  body += `  §8├ §fKoin bisa §cminus §f(hutang)\n`;
  body += `  §8└ §fDecay: 1 offense per 1 jam\n\n`;
  body += `  §eCARA BUKA MENU\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fKetik §c/pvp §fdi chat\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §cCOMBAT§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideLeaderboard(player) {
  let body = `${HR}\n`;
  body += `§6  ★ WEEKLY LEADERBOARD\n`;
  body += `${HR}\n\n`;
  body += `  §fKompetisi mingguan antar player!\n`;
  body += `  §fTop 3 dapat reward koin.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fReset otomatis tiap 7 hari\n`;
  body += `  §8├ §fTop 10 leaderboard + kategori\n`;
  body += `  §8├ §fReward top 3 + streak bonus\n`;
  body += `  §8├ §fMinggu lalu bisa dilihat\n`;
  body += `  §8└ §fReward offline dikirim saat login\n\n`;
  body += `  §eREWARD\n`;
  body += `${HR_THIN}\n`;
  body += `  §8| §6#1 §8-- §e+5.000 Koin\n`;
  body += `  §8| §f#2 §8-- §e+3.000 Koin\n`;
  body += `  §8| §e#3 §8-- §e+1.000 Koin\n\n`;
  body += `  §eCARA DAPAT SKOR\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKill Mob  §8── §e5 pts\n`;
  body += `  §8├ §fMine Blok §8── §e1 pts\n`;
  body += `  §8├ §fPasang    §8── §e1 pts\n`;
  body += `  §8└ §fPvP Kill  §8── §e20 pts\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKetik §e/lt:lb\n`;
  body += `  §8└ §fKetik §e/lt:stats\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §6LEADERBOARD§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideDragon(player) {
  let body = `${HR}\n`;
  body += `§5  ★ DRAGON UPDATE\n`;
  body += `${HR}\n\n`;
  body += `  §fBoss fight Ender Dragon dengan\n`;
  body += `  §fsistem Elytra terkontrol.\n\n`;
  body += `  §eBOSS FIGHT\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fLawan Ender Dragon di The End\n`;
  body += `  §8├ §fBiaya masuk dari treasury server\n`;
  body += `  §8├ §fReward koin dari treasury saat menang\n`;
  body += `  §8└ §fTimer otomatis & boundary limit\n\n`;
  body += `  §eELYTRA SYSTEM\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fLimit §e1 elytra§f per hari dari frame\n`;
  body += `  §8├ §aReset setiap hari §f20:00 WIB\n`;
  body += `  §8├ §fElytra dari §eAuction/Gacha §ftidak terkena limit\n`;
  body += `  §8├ §fElytra lama dibawa ke hari berikutnya\n`;
  body += `  §8└ §fCek cooldown: §e/lt:elytime\n\n`;
  body += `  §eTIPS AMAN\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fBeli elytra di Auction = bebas limit\n`;
  body += `  §8├ §fElytra dari Gacha = bebas limit\n`;
  body += `  §8├ §fJangan ambil dari frame jika sudah punya\n`;
  body += `  §8└ §fGunakan §e/lt:elytime §fcek status kamu\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §5DRAGON UPDATE§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideEvent(player) {
  // Import lazily to avoid circular — these are simple reads
  let isActive = false, timeLeft = null;
  try {
    const { isEidActive, getEidTimeLeft } = await import("../eid_quest.js");
    isActive = isEidActive();
    timeLeft = getEidTimeLeft();
  } catch { }

  let body = `${HR}\n`;
  body += `\u00a76  ★ EVENT\n`;
  body += `${HR}\n\n`;

  // Status
  if (isActive) {
    body += `  \u00a7aEvent sedang berjalan!\n`;
    body += `  \u00a7fSisa waktu: \u00a7e${timeLeft ?? "-"}\n\n`;
  } else {
    body += `  \u00a77Belum ada event.\n\n`;
  }

  // Cara dapat Shard
  body += `  \u00a7eCARA DAPAT SHARD\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a7f  Bunuh 50 Sapi    = \u00a76+1 Shard\n`;
  body += `  \u00a7f  Bunuh 50 Domba   = \u00a76+1 Shard\n`;
  body += `  \u00a7f  Bunuh 50 Kambing = \u00a76+1 Shard\n`;
  body += `  \u00a77  Max 3 Shard per hari\n`;
  body += `  \u00a77  Reset jam \u00a7e08:00 WIB\n\n`;

  // Shard buat apa
  body += `  \u00a7eSHARD BUAT APA?\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a7f  Shard = syarat beli efek kill.\n`;
  body += `  \u00a7f  Efek kill = animasi keren saat\n`;
  body += `  \u00a7f  kamu bunuh musuh di PvP.\n\n`;

  // Daftar efek — simple
  body += `  \u00a7eDAFTAR EFEK\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a7f  Toxic          \u00a7e15rb Koin \u00a78+ \u00a763 Shard\n`;
  body += `  \u00a7f  Gravity Hammer \u00a7e50rb Koin \u00a78+ \u00a767 Shard\n`;
  body += `  \u00a7f  Hacker RGB     \u00a7b15 Gem   \u00a78+ \u00a765 Shard\n`;
  body += `  \u00a7f  Dragon Fire    \u00a7b20 Gem   \u00a78+ \u00a7610 Shard\n`;
  body += `  \u00a7f  Ice Blizzard   \u00a7b25 Gem   \u00a78+ \u00a7612 Shard\n`;
  body += `  \u00a7f  Crystal Geode  \u00a7b30 Gem   \u00a78+ \u00a7615 Shard\n\n`;

  // Cara beli
  body += `  \u00a7eCARA BELI\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a7f  1. Kumpulkan Shard tiap hari\n`;
  body += `  \u00a7f  2. Ketik \u00a7c/pvp\n`;
  body += `  \u00a7f  3. Pilih Kill Effect\n`;
  body += `  \u00a7f  4. Beli, efek \u00a7apermanen\u00a7f!\n\n`;

  // Top up
  body += `  \u00a7eBUTUH GEM?\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a7f  Beli di \u00a7e\u00a7ntopup.laughtale.id\n`;
  body += `  \u00a7f  Top up pertama = \u00a7a2x lipat!\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 >> \u00a76EVENT\u00a7r \u00a78<< \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
    .show(player);
}
