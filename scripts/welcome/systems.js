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
  body += `\u00a7d  \u2605 GACHA SYSTEM\n`;
  body += `${HR}\n\n`;
  body += `  \u00a7fSistem gacha dengan animasi\n`;
  body += `  \u00a7fpremium di chest interaktif.\n\n`;
  body += `  \u00a7eDUA TIPE GACHA\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a75\u2726 \u00a7fGacha Partikel \u00a78\u2500\u2500 \u00a7fbayar \u00a7bGem\n`;
  body += `  \u00a78\u2502 \u00a78  1x=\u00a7b10 Gem\u00a78, 10x=\u00a7b90 Gem \u00a78(tetap)\n`;
  body += `  \u00a78\u2514 \u00a76\u2605 \u00a7fGacha Peralatan \u00a78\u2500\u2500 \u00a7fbayar \u00a7eKoin\n`;
  body += `  \u00a78   \u00a78  1x=\u00a7e${eq1} Koin\u00a78, 10x=\u00a7e${eq10} Koin\n`;
  body += `  \u00a78   \u00a78  \u00a77(dinamis ikut ekonomi server)\n\n`;
  body += `  \u00a7eFITUR\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fPull 1x atau 10x\n`;
  body += `  \u00a78\u251c \u00a7fPity: Rare+ setiap \u00a7e${pityR}x \u00a7fpull\n`;
  body += `  \u00a78\u251c \u00a7fPity: Legend setiap \u00a7e${pityL}x \u00a7fpull\n`;
  body += `  \u00a78\u251c \u00a7fDuplikat = refund \u00a7b5 Gem\n`;
  body += `  \u00a78\u251c \u00a7fLeaderboard & statistik\n`;
  body += `  \u00a78\u2514 \u00a7fAnimasi roll di chest\n\n`;
  body += `  \u00a7eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fKetik \u00a7e/gacha \u00a7fdi chat\n`;
  body += `  \u00a78\u2514 \u00a7fAtau klik chest gacha terdaftar\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 \u2666 \u00a7dGACHA\u00a7r \u00a78\u2666 \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideTreecap(player) {
  let body = `${HR}\n`;
  body += `\u00a7a  \u2605 TREE CAPITATOR\n`;
  body += `${HR}\n\n`;
  body += `  \u00a7fTebang seluruh pohon sekaligus\n`;
  body += `  \u00a7fdengan satu kali potong!\n\n`;
  body += `  \u00a7eCARA PAKAI\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7f1. Pegang \u00a7ekapak \u00a7f(jenis apapun)\n`;
  body += `  \u00a78\u251c \u00a7f2. Tebang satu blok log/batang\n`;
  body += `  \u00a78\u251c \u00a7f3. Seluruh pohon langsung tumbang\n`;
  body += `  \u00a78\u2514 \u00a7f4. Daun/wart ikut hancur otomatis\n\n`;
  body += `  \u00a7eBATAS LOG PER KAPAK\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a77Wooden/Stone  \u00a78\u2500\u2500 \u00a7f8 log\n`;
  body += `  \u00a78\u251c \u00a7fIron/Golden   \u00a78\u2500\u2500 \u00a7f12 log\n`;
  body += `  \u00a78\u251c \u00a7bDiamond       \u00a78\u2500\u2500 \u00a7f24 log\n`;
  body += `  \u00a78\u2514 \u00a7dNetherite     \u00a78\u2500\u2500 \u00a7f48 log\n\n`;
  body += `  \u00a7ePOHON YANG DIDUKUNG\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7aOverworld \u00a78\u2500\u2500 \u00a7fSemua jenis log & daun\n`;
  body += `  \u00a78\u251c \u00a7cNether    \u00a78\u2500\u2500 \u00a7fStem & wart block\n`;
  body += `  \u00a78\u2514 \u00a75Mushroom  \u00a78\u2500\u2500 \u00a7fMushroom block & stem\n\n`;
  body += `  \u00a7eFITUR TAMBAHAN\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fDurabilitas kapak berkurang per log\n`;
  body += `  \u00a78\u251c \u00a7fCooldown otomatis antar tebang\n`;
  body += `  \u00a78\u251c \u00a7e/ltcap on \u00a78\u2500\u2500 \u00a7faktifkan TreeCap\n`;
  body += `  \u00a78\u251c \u00a7e/ltcap off \u00a78\u2500\u2500 \u00a7fmatikan TreeCap\n`;
  body += `  \u00a78\u251c \u00a7e/ltcap status \u00a78\u2500\u2500 \u00a7fcek status\n`;
  body += `  \u00a78\u2514 \u00a7eAuto-OFF \u00a78\u2500\u2500 \u00a7fmati otomatis jika idle\n`;
  body += `  \u00a78  \u00a78  (default 60 detik tidak dipakai)\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 \u2666 \u00a7aTREECAP\u00a7r \u00a78\u2666 \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideLand(player) {
  let body = `${HR}\n`;
  body += `\u00a72  \u2605 MIMI LAND\n`;
  body += `${HR}\n\n`;
  body += `  \u00a7fKlaim dan lindungi area milikmu\n`;
  body += `  \u00a7fdari player lain!\n\n`;
  body += `  \u00a7eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fKlaim area dengan beli koin\n`;
  body += `  \u00a78\u251c \u00a7fHarga dinamis ikut ekonomi server\n`;
  body += `  \u00a78\u251c \u00a7fProteksi build/break/interact\n`;
  body += `  \u00a78\u251c \u00a7fWhitelist teman di area\n`;
  body += `  \u00a78\u251c \u00a7fPublic/Private mode\n`;
  body += `  \u00a78\u251c \u00a7fRefund saat hapus land\n`;
  body += `  \u00a78\u251c \u00a7fBayar \u00a7bGem \u00a78\u2500\u2500 \u00a7bdiskon 99%% + bebas PPN\n`;
  body += `  \u00a78\u2514 \u00a7fHarga berdasarkan luas area\n\n`;
  body += `  \u00a7eCARA PAKAI\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7f1. Pegang item \u00a72Mimi Land\n`;
  body += `  \u00a78\u251c \u00a7f2. \u00a7eShift+klik \u00a7fblok untuk titik 1\n`;
  body += `  \u00a78\u251c \u00a7f3. \u00a7eShift+klik \u00a7fblok untuk titik 2\n`;
  body += `  \u00a78\u251c \u00a7f4. \u00a7eKlik biasa \u00a7f(tanpa shift) buka menu\n`;
  body += `  \u00a78\u2514 \u00a7f5. Buat land dari menu\n\n`;
  body += `  \u00a7c\u00a7lAUTO-CLEANUP\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a7c\u26a0 \u00a7fLand \u00a7cotomatis dihapus \u00a7fjika owner\n`;
  body += `  \u00a7ftidak login selama \u00a7c14 hari\u00a7f.\n`;
  body += `  \u00a78\u251c \u00a7fTidak ada refund otomatis.\n`;
  body += `  \u00a78\u2514 \u00a7fLogin rutin untuk jaga land!\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 \u2666 \u00a72MIMI LAND\u00a7r \u00a78\u2666 \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideCombat(player) {
  let body = `${HR}\n`;
  body += `\u00a7c  \u2605 COMBAT PvP\n`;
  body += `${HR}\n\n`;
  body += `  \u00a7fSistem PvP \u00a7eOTOMATIS \u00a7fterintegrasi koin.\n`;
  body += `  \u00a7fKill musuh = dapat koin!\n\n`;
  body += `  \u00a7eCARA KERJA\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7c1. \u00a7fPukul player lain\n`;
  body += `  \u00a78\u2502 \u00a78   -> PvP-mu \u00a7cotomatis aktif\n`;
  body += `  \u00a78\u2502 \u00a78   -> Hit pertama \u00a77tidak melukai\n`;
  body += `  \u00a78\u251c \u00a7c2. \u00a7fLawan pukul balik\n`;
  body += `  \u00a78\u2502 \u00a78   -> PvP lawan \u00a7cotomatis aktif\n`;
  body += `  \u00a78\u2502 \u00a78   -> Pertarungan dimulai!\n`;
  body += `  \u00a78\u2514 \u00a7c3. \u00a7fIdle \u00a7e30 detik\n`;
  body += `  \u00a78     -> PvP \u00a7aotomatis nonaktif\n\n`;
  // Streak multiplier dari config
  const streakStr = (CFG_PVP.STREAK_MULTIPLIER || [])
    .filter(t => t.mult > 1)
    .map(t => `${t.min} kill \u00a7a${t.mult}x\u00a77`)
    .join(" \u00a78\u00b7 \u00a77");

  body += `  \u00a7eFITUR\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fKill Reward \u00a78\u2500\u2500 \u00a77dapat \u00a7a${CFG_PVP.KILL_REWARD_PCT}%%\u00a77 koin korban\n`;
  body += `  \u00a78\u2502 \u00a78  \u00a77(min \u00a7a${CFG_PVP.MIN_REWARD}\u00a77, max \u00a7a${CFG_PVP.MAX_REWARD}\u00a77 koin)\n`;
  body += `  \u00a78\u251c \u00a7fStreak Mult \u00a78\u2500\u2500 \u00a77${streakStr}\n`;
  body += `  \u00a78\u251c \u00a7fCombat Tag \u00a78\u2500\u2500 \u00a7715s tidak bisa idle-off\n`;
  body += `  \u00a78\u251c \u00a7fHUD Stats \u00a78\u2500\u2500 \u00a77actionbar realtime\n`;
  body += `  \u00a78\u251c \u00a7fMin. Koin \u00a78\u2500\u2500 \u00a77harus punya \u00a7a${CFG_PVP.MIN_COIN_TO_ENABLE}\u00a77 koin\n`;
  body += `  \u00a78\u2514 \u00a7fLand Protect \u00a78\u2500\u2500 \u00a77PvP off di area land\n\n`;
  body += `  \u00a74HUKUMAN MEMBUNUH NON-PVP\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7f1x: \u00a7c-5.000 Koin \u00a78+ drop semua item\n`;
  body += `  \u00a78\u251c \u00a7f2x: \u00a7c-15.000 Koin \u00a78+ drop + \u00a74ban 10 menit\n`;
  body += `  \u00a78\u251c \u00a7f3x: \u00a7c-50.000 Koin \u00a78+ drop + \u00a74BAN PERMANENT\n`;
  body += `  \u00a78\u251c \u00a7fKoin bisa \u00a7cminus \u00a7f(hutang)\n`;
  body += `  \u00a78\u2514 \u00a7fDecay: 1 offense per 1 jam\n\n`;
  body += `  \u00a7eCARA BUKA MENU\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u2514 \u00a7fKetik \u00a7c/pvp \u00a7fdi chat\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 \u2666 \u00a7cCOMBAT\u00a7r \u00a78\u2666 \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideLeaderboard(player) {
  let body = `${HR}\n`;
  body += `\u00a76  \u2605 WEEKLY LEADERBOARD\n`;
  body += `${HR}\n\n`;
  body += `  \u00a7fKompetisi mingguan antar player!\n`;
  body += `  \u00a7fTop 3 dapat reward koin.\n\n`;
  body += `  \u00a7eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fReset otomatis tiap 7 hari\n`;
  body += `  \u00a78\u251c \u00a7fTop 10 leaderboard + kategori\n`;
  body += `  \u00a78\u251c \u00a7fReward top 3 + streak bonus\n`;
  body += `  \u00a78\u251c \u00a7fMinggu lalu bisa dilihat\n`;
  body += `  \u00a78\u2514 \u00a7fReward offline dikirim saat login\n\n`;
  body += `  \u00a7eREWARD\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78| \u00a76#1 \u00a78-- \u00a7e+5.000 Koin\n`;
  body += `  \u00a78| \u00a7f#2 \u00a78-- \u00a7e+3.000 Koin\n`;
  body += `  \u00a78| \u00a7e#3 \u00a78-- \u00a7e+1.000 Koin\n\n`;
  body += `  \u00a7eCARA DAPAT SKOR\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fKill Mob  \u00a78\u2500\u2500 \u00a7e5 pts\n`;
  body += `  \u00a78\u251c \u00a7fMine Blok \u00a78\u2500\u2500 \u00a7e1 pts\n`;
  body += `  \u00a78\u251c \u00a7fPasang    \u00a78\u2500\u2500 \u00a7e1 pts\n`;
  body += `  \u00a78\u2514 \u00a7fPvP Kill  \u00a78\u2500\u2500 \u00a7e20 pts\n\n`;
  body += `  \u00a7eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fKetik \u00a7e/lt:lb\n`;
  body += `  \u00a78\u2514 \u00a7fKetik \u00a7e/lt:stats\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 \u2666 \u00a76LEADERBOARD\u00a7r \u00a78\u2666 \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideDragon(player) {
  let body = `${HR}\n`;
  body += `\u00a75  \u2605 DRAGON UPDATE\n`;
  body += `${HR}\n\n`;
  body += `  \u00a7fBoss fight Ender Dragon dengan\n`;
  body += `  \u00a7fsistem boss fight yang seru.\n\n`;
  body += `  \u00a7eBOSS FIGHT\n`;
  body += `${HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fLawan Ender Dragon di The End\n`;
  body += `  \u00a78\u251c \u00a7fBiaya masuk dari treasury server\n`;
  body += `  \u00a78\u251c \u00a7fReward koin dari treasury saat menang\n`;
  body += `  \u00a78\u2514 \u00a7fTimer otomatis & boundary limit\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("\u00a78 \u2666 \u00a75DRAGON UPDATE\u00a7r \u00a78\u2666 \u00a7r")
    .body(body)
    .button("\u00a76  Kembali", "textures/items/arrow")
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
  body += `\u00a76  \u2605 EVENT\n`;
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
