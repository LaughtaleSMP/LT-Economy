// welcome.js — Welcome Guide System
// Menampilkan panduan fitur server saat player pertama kali login
// atau saat player mengetik /guide

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { UIClose } from "./ui_close.js";
import { pGetRaw, pSetRaw } from "./player_dp.js";

// ═══════════════════════════════════════════════════════════
// KONFIGURASI
// ═══════════════════════════════════════════════════════════
const K_WELCOME_SEEN = "welcome:seen:";    // track apakah player sudah lihat guide
const HR = "§8═══════════════════";
const HR_THIN = "§8───────────────────";

// ═══════════════════════════════════════════════════════════
// WELCOME CHAT MESSAGE — ditampilkan saat login
// ═══════════════════════════════════════════════════════════
function sendWelcomeChat(player, isFirstTime) {
  const greeting = isFirstTime
    ? `§aSelamat datang di server, §f${player.name}§a!`
    : `§aSelamat datang kembali, §f${player.name}§a!`;

  player.sendMessage(
    `\n§8═══════════════════` +
    `\n§6  ✦ LAUGHTALE SMP ✦` +
    `\n§r§8═══════════════════` +
    `\n§r  ${greeting}` +
    `\n` +
    `\n  §e✦ §fFitur Server:` +
    `\n  §8├ §6⛃ §eBank Koin    §8── §f/bank` +
    `\n  §8├ §6◆ §eAuction House §8── §f/auction` +
    `\n  §8├ §b✦ §eDaily Quest   §8── §f/daily` +
    `\n  §8├ §d★ §eGacha System  §8── §fPegang §dTripwire Hook §8lalu klik` +
    `\n  §8├ §a✦ §eTree Cap      §8── §fTebang pohon dengan kapak` +
    `\n  §8├ §2◆ §eMimi Land     §8── §fGunakan item §2Mimi Land` +
    `\n  §8└ §c⚔ §eCombat PvP    §8── §fKetik §c/pvp` +
    `\n` +
    `\n  §8Ketik §e/guide §8untuk panduan lengkap.` +
    `\n§8═══════════════════\n`
  );
}

// ═══════════════════════════════════════════════════════════
// WELCOME GUIDE UI — panduan lengkap semua fitur
// ═══════════════════════════════════════════════════════════
async function openWelcomeGuide(player) {
  while (true) {
    let body = `${HR}\n`;
    body += `§6  P A N D U A N   S E R V E R\n`;
    body += `${HR}\n\n`;
    body += `  §fSelamat datang di §6LAUGHTALE§f!\n`;
    body += `  §fServer ini dilengkapi berbagai\n`;
    body += `  §ffitur premium untuk pengalaman\n`;
    body += `  §fbermain yang lebih seru.\n\n`;
    body += `  §8Pilih topik di bawah untuk\n`;
    body += `  §8mempelajari setiap fitur.\n`;
    body += `\n${HR}`;

    const form = new ActionFormData()
      .title("§8 ♦ §6PANDUAN§r §8♦ §r")
      .body(body);
    const btns = [];

    form.button(`§6  Bank Koin\n§r  §eTransfer, request, leaderboard`, "textures/items/gold_ingot");
    btns.push("bank");

    form.button(`§e  Auction House\n§r  §eJual beli item antar player`, "textures/items/emerald");
    btns.push("auction");

    form.button(`§b  Daily Quest\n§r  §eLogin, quest, achievement`, "textures/items/clock_item");
    btns.push("daily");

    form.button(`§d  Gacha System\n§r  §ePartikel & peralatan random`, "textures/items/nether_star");
    btns.push("gacha");

    form.button(`§a  Tree Capitator\n§r  §eTebang pohon otomatis`, "textures/items/diamond_axe");
    btns.push("treecap");

    form.button(`§2  Mimi Land\n§r  §eKlaim & lindungi area`, "textures/items/map_empty");
    btns.push("land");

    form.button(`§c  Combat PvP\n§r  §ePvP sistem dengan koin`, "textures/items/diamond_sword");
    btns.push("combat");

    form.button(`§f  Semua Command\n§r  §eDaftar lengkap command`, "textures/items/paper");
    btns.push("commands");

    form.button("§6  Tutup", "textures/items/redstone_dust");
    btns.push("close");

    try { player.playSound("random.click", { pitch: 1.3, volume: 0.7 }); } catch { }
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "close") return;

    switch (btns[res.selection]) {
      case "bank": await guideBank(player); break;
      case "auction": await guideAuction(player); break;
      case "daily": await guideDaily(player); break;
      case "gacha": await guideGacha(player); break;
      case "treecap": await guideTreecap(player); break;
      case "land": await guideLand(player); break;
      case "combat": await guideCombat(player); break;
      case "commands": await guideCommands(player); break;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// GUIDE PAGES — masing-masing fitur
// ═══════════════════════════════════════════════════════════

async function guideBank(player) {
  let body = `${HR}\n`;
  body += `§6  ⛃ BANK KOIN\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem transfer koin antar player\n`;
  body += `  §fdengan keamanan tinggi.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fTransfer koin ke player lain\n`;
  body += `  §8├ §fMinta koin (request system)\n`;
  body += `  §8├ §fRiwayat mutasi transaksi\n`;
  body += `  §8├ §fLeaderboard saldo tertinggi\n`;
  body += `  §8├ §a5x gratis §ftransfer per hari\n`;
  body += `  §8│ §8(tanpa pajak)\n`;
  body += `  §8└ §fPajak otomatis setelahnya\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fKetik §e/bank §fatau §e/lt:bank\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §6BANK KOIN§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideAuction(player) {
  let body = `${HR}\n`;
  body += `§e  ◆ AUCTION HOUSE\n`;
  body += `${HR}\n\n`;
  body += `  §fPasar jual beli item antar\n`;
  body += `  §fplayer dengan sistem aman.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fMode §eBuyout §8── §7harga tetap, beli langsung\n`;
  body += `  §8├ §fMode §bAuction §8── §7bid war, harga naik\n`;
  body += `  §8├ §fTawaran/nego harga §8(offer)\n`;
  body += `  §8├ §fBrowse per kategori item\n`;
  body += `  §8├ §fSorting §8── §7harga/waktu/nama\n`;
  body += `  §8├ §fAnti-snipe protection\n`;
  body += `  §8├ §fPending system §8── §7klaim offline\n`;
  body += `  §8└ §fCrash recovery otomatis\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fKetik §e/auction §fatau §e/lt:auction\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §eAUCTION§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideDaily(player) {
  let body = `${HR}\n`;
  body += `§b  ✦ DAILY QUEST SYSTEM\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem quest & achievement\n`;
  body += `  §funtuk mendapatkan koin harian.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §6✦ §fDaily Login Reward §8(7 hari streak)\n`;
  body += `  §8├ §b◆ §fQuest Harian §8── §f3 quest acak\n`;
  body += `  §8├ §3◆ §fQuest Mingguan §8── §f4 quest\n`;
  body += `  §8├ §5◆ §fQuest Bulanan §8── §f5 quest\n`;
  body += `  §8├ §d★ §fAchievement System\n`;
  body += `  §8│ §8(Combat, Mining, Building, dll)\n`;
  body += `  §8└ §e✦ §fBonus komplit semua quest\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKetik §e/daily §fatau §e/lt:daily\n`;
  body += `  §8└ §fLogin reward §aotomatis §ftiap masuk\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §bDAILY§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideGacha(player) {
  let body = `${HR}\n`;
  body += `§d  ★ GACHA SYSTEM\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem gacha dengan animasi\n`;
  body += `  §fpremium di chest interaktif.\n\n`;
  body += `  §eDUA TIPE GACHA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §5✦ §fGacha Partikel §8── §fbayar §bGem\n`;
  body += `  §8│ §8  Kumpulkan efek partikel unik\n`;
  body += `  §8└ §6★ §fGacha Peralatan §8── §fbayar §eKoin\n`;
  body += `  §8   §8  Dapatkan senjata & armor\n\n`;
  body += `  §eFITUR\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fPull 1x atau 10x\n`;
  body += `  §8├ §fPity system (garansi rare)\n`;
  body += `  §8├ §fKode diskon dari admin\n`;
  body += `  §8├ §fLeaderboard & statistik\n`;
  body += `  §8└ §fAnimasi roll di chest\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fPegang §dTripwire Hook §flalu §eklik\n`;
  body += `  §8└ §fAtau klik chest gacha terdaftar\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §dGACHA§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideTreecap(player) {
  let body = `${HR}\n`;
  body += `§a  ✦ TREE CAPITATOR\n`;
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
  body += `  §8├ §eShift+klik kapak §8── §ftoggle ON/OFF\n`;
  body += `  §8└ §eAuto-OFF §8── §fmati otomatis jika idle\n`;
  body += `  §8  §8  (default 120 detik tidak dipakai)\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §aTREECAP§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideLand(player) {
  let body = `${HR}\n`;
  body += `§2  ◆ MIMI LAND\n`;
  body += `${HR}\n\n`;
  body += `  §fKlaim dan lindungi area milikmu\n`;
  body += `  §fdari player lain!\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKlaim area dengan beli koin\n`;
  body += `  §8├ §fProteksi build/break/interact\n`;
  body += `  §8├ §fWhitelist teman di area\n`;
  body += `  §8├ §fPublic/Private mode\n`;
  body += `  §8├ §fRefund saat hapus land\n`;
  body += `  §8│ §8(dipotong pajak)\n`;
  body += `  §8└ §fHarga berdasarkan luas area\n\n`;
  body += `  §eCARA PAKAI\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §f1. Pegang item §2Mimi Land\n`;
  body += `  §8├ §f2. §eShift+klik §fblok untuk titik 1\n`;
  body += `  §8├ §f3. §eShift+klik §fblok untuk titik 2\n`;
  body += `  §8├ §f4. §eKlik biasa §f(tanpa shift) buka menu\n`;
  body += `  §8└ §f5. Buat land dari menu\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §2MIMI LAND§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideCombat(player) {
  let body = `${HR}\n`;
  body += `§c  ⚔ COMBAT PvP\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem PvP terintegrasi koin.\n`;
  body += `  §fKill musuh = dapat koin!\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fMutual PvP §8── §7dua-duanya harus ON\n`;
  body += `  §8├ §fKill Reward §8── §7dapat % koin korban\n`;
  body += `  §8├ §fStreak Mult §8── §73/5/10 kill = bonus\n`;
  body += `  §8├ §fCombat Tag §8── §715s tidak bisa off\n`;
  body += `  §8├ §fGrace Period §8── §75s setelah enable\n`;
  body += `  §8├ §fHUD Stats §8── §7actionbar / sidebar\n`;
  body += `  §8└ §fMin. Koin §8── §7harus punya koin\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fKetik §c/pvp §fdi chat\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §cCOMBAT§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function guideCommands(player) {
  let body = `${HR}\n`;
  body += `§f  ⚡ DAFTAR COMMAND\n`;
  body += `${HR}\n\n`;
  body += `  §eCOMMAND UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §e/bank      §8── §fBuka Bank Koin\n`;
  body += `  §8├ §e/auction   §8── §fBuka Auction House\n`;
  body += `  §8├ §e/daily     §8── §fBuka Daily System\n`;
  body += `  §8├ §e/guide     §8── §fBuka panduan ini\n`;
  body += `  §8└ §e/monitor   §8── §fServer Monitor §c(Admin)\n\n`;
  body += `  §eCHAT COMMAND\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §c/pvp       §8── §fBuka Combat PvP Menu\n\n`;
  body += `  §eITEM TRIGGER\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §dTripwire Hook §8── §fBuka Gacha Hub\n`;
  body += `  §8└ §2Mimi Land Item §8── §fBuka Land Menu\n\n`;
  body += `  §eTIPS\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fLogin setiap hari untuk streak reward\n`;
  body += `  §8├ §fSelesaikan quest untuk koin extra\n`;
  body += `  §8├ §fGunakan Auction untuk jual item\n`;
  body += `  §8├ §fKlaim land untuk proteksi bangunan\n`;
  body += `  §8└ §fAktifkan PvP untuk earn koin dari kill\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §fCOMMAND§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// ON LOGIN — kirim welcome chat + tandai sudah lihat
// ═══════════════════════════════════════════════════════════
export function handleWelcome(player) {
  try {
    const seen = pGetRaw(player, K_WELCOME_SEEN);
    if (seen) return; // Player lama — skip, bisa pakai /help kapan saja

    // Player baru — tampilkan welcome + auto-open guide
    sendWelcomeChat(player, true);
    try { pSetRaw(player, K_WELCOME_SEEN, Date.now()); } catch { }

    system.runTimeout(() => {
      try {
        const live = world.getPlayers().find(p => p.id === player.id);
        if (live) openWelcomeGuide(live).catch(e => { if (!e?.isUIClose) console.warn("[Welcome]", e); });
      } catch { }
    }, 80);
  } catch (e) {
    console.warn("[Welcome] error:", e);
  }
}

// ═══════════════════════════════════════════════════════════
// COMMAND REGISTRATION — /guide
// ═══════════════════════════════════════════════════════════
const helpSessions = new Set();

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:guide",
        description: "Buka panduan fitur server",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (helpSessions.has(player.id)) return;
        system.run(async () => {
          if (helpSessions.has(player.id)) return;
          helpSessions.add(player.id);
          try { await openWelcomeGuide(player); }
          catch (e) { if (!e?.isUIClose) console.warn("[Welcome] guide error:", e); }
          finally { helpSessions.delete(player.id); }
        });
        return { status: 0 };
      }
    );

  } catch (e) { console.warn("[Welcome] Command registration failed:", e); }
});
