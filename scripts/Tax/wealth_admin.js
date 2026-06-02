// ============================================================
// Tax/wealth_admin.js — Admin UI untuk Pajak Kekayaan
//
// Menyediakan form ActionFormData / MessageFormData untuk:
//   - Auto subsidi (distribusi ke bottom 50% player)
//   - Distribusi manual rata ke player online
//   - Force collect (override jadwal harian)
//
// Semua action menampilkan konfirmasi dulu (CODING_STANDARDS §4.1).
// Re-read state setelah await (anti-stale, §2.3).
// ============================================================

import { world } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { trackFlow } from "../eco_flow.js";
import {
  K_PERIOD, AUTO_DIST_THRESHOLD, AUTO_DIST_RESERVE_PCT, AUTO_DIST_BOTTOM_PCT,
  fmt, getCurrentPeriod, getCoinObj, getTreasury, drainTreasury,
  dpGet, dpSet,
} from "./wealth_state.js";
import { autoDistributeTreasury } from "./wealth_distribute.js";
import { collectWealthTax } from "./wealth_collect.js";

export async function showTaxAdmin(player) {
  const period     = getCurrentPeriod();
  const lastPeriod = dpGet(K_PERIOD, -1);
  const collected  = lastPeriod === period ? "Sudah (hari ini)" : "Belum dikumpulkan hari ini";
  const treasury   = getTreasury();

  const HR = "§8══════════════════════";
  const body =
    `${HR}\n§e  TREASURY PAJAK KEKAYAAN\n${HR}\n\n` +
    `  §eStatus      §8── §f${collected}\n` +
    `  §eTreasury    §8── §6${fmt(treasury)} Koin\n\n` +
    `  §8Tier pajak:\n` +
    `  §8├ §f> 5.000    §8→ §e-0.5%%/hari\n` +
    `  §8├ §f> 20.000   §8→ §e-1.0%%/hari\n` +
    `  §8└ §f> 50.000   §8→ §e-2.0%%/hari\n` +
    `\n${HR}`;

  const form = new ActionFormData()
    .title("§8 ♦ §eTAX ADMIN§r §8♦ §r")
    .body(body)
    .button("§b  Auto Subsidi Kalangan Bawah\n§r  §8Weighted ke bottom 50% (online+offline)", "textures/items/emerald")
    .button("§6  Distribusi Manual (Online)\n§r  §8Rata ke semua player yang sedang online", "textures/items/gold_ingot")
    .button("§c  Paksa Kumpulkan Sekarang\n§r  §8Override jadwal harian", "textures/items/nether_star")
    .button("§8  Tutup", "textures/items/redstone_dust");

  const res = await form.show(player);
  if (res.canceled || res.selection === 3) return;

  if (res.selection === 0) await adminAutoDistribute(player);
  if (res.selection === 1) await adminDistribute(player);
  if (res.selection === 2) await adminForceCollect(player);
}

async function adminAutoDistribute(admin) {
  const treasury = getTreasury();
  if (treasury < AUTO_DIST_THRESHOLD) {
    admin.sendMessage(
      `§8[§cTax§8]§c Treasury terlalu kecil ` +
      `(${fmt(treasury)} koin, min ${fmt(AUTO_DIST_THRESHOLD)}).`
    );
    return;
  }
  const obj = getCoinObj();
  if (!obj) {
    admin.sendMessage("§8[§cTax§8]§c Scoreboard 'coin' tidak ditemukan.");
    return;
  }

  const playerCount = _countEligiblePlayers(obj);
  const targetCount = Math.max(1, Math.floor(playerCount * AUTO_DIST_BOTTOM_PCT));
  const distributable = Math.floor(treasury * (1 - AUTO_DIST_RESERVE_PCT));

  const confirm = await new MessageFormData()
    .title("§8 ♦ §bAUTO SUBSIDI§r §8♦ §r")
    .body(
      `§f Auto-distribusikan treasury ke kalangan bawah?\n\n` +
      `  §eTreasury      §8── §6${fmt(treasury)} Koin\n` +
      `  §eYang dibagikan §8── §6${fmt(distributable)} Koin\n` +
      `  §eSisakan       §8── §e${fmt(treasury - distributable)} Koin (10%%)\n` +
      `  §eTotal player   §8── §f${playerCount} player\n` +
      `  §eTarget penerima §8── §b${targetCount} player (bottom 50%%)\n\n` +
      `§8Bekerja untuk player ONLINE dan OFFLINE.`
    )
    .button1("§f Batal")
    .button2("§b Distribusi")
    .show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;

  const totalOut = autoDistributeTreasury();
  if (totalOut <= 0) {
    admin.sendMessage(`§8[§cTax§8]§c Auto-distribusi gagal atau treasury tidak cukup.`);
  } else {
    admin.sendMessage(
      `§8[§aTax§8]§a Auto-distribusi selesai! ` +
      `§e${fmt(totalOut)} Koin §adibagikan ke §b${targetCount} §aplayer.`
    );
  }
}

async function adminDistribute(admin) {
  // Selalu baca langsung dari DP — hindari nilai stale dari saat form dibuka
  const treasury = getTreasury();
  if (treasury <= 0) {
    admin.sendMessage(
      `§8[§cTax§8]§c Treasury kosong.\n` +
      `§8Gunakan §ePaksa Kumpulkan §8jika pajak belum dikumpulkan hari ini.`
    );
    return;
  }
  const online = world.getPlayers();
  if (online.length === 0) {
    admin.sendMessage("§8[§cTax§8]§c Tidak ada player online.");
    return;
  }

  const perPlayer = Math.floor(treasury / online.length);
  if (perPlayer <= 0) {
    admin.sendMessage(
      `§8[§cTax§8]§c Treasury §f${treasury} koin §ctidak cukup dibagi ` +
      `§f${online.length} §cplayer.`
    );
    return;
  }

  const confirm = await new MessageFormData()
    .title("§8 ♦ §aDISTRIBUSI§r §8♦ §r")
    .body(
      `§f Distribusikan treasury ke semua player online?\n\n` +
      `  §eTreasury   §8── §6${fmt(treasury)} Koin\n` +
      `  §ePlayer     §8── §f${online.length} player\n` +
      `  §ePer player §8── §e${fmt(perPlayer)} Koin`
    )
    .button1("§f Batal")
    .button2("§a Distribusi")
    .show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;

  await _executeDistribute(admin);
}

async function _executeDistribute(admin) {
  // Re-read state setelah await — treasury/player bisa berubah selama form terbuka
  const freshTreasury = getTreasury();
  const freshOnline = world.getPlayers();
  const coin = getCoinObj();
  if (!coin) {
    admin.sendMessage("§8[§cTax§8]§c Scoreboard 'coin' tidak ditemukan.");
    return;
  }
  if (freshTreasury <= 0) {
    admin.sendMessage("§8[§cTax§8]§c Treasury sudah kosong (berubah saat form terbuka).");
    return;
  }
  if (freshOnline.length === 0) {
    admin.sendMessage("§8[§cTax§8]§c Tidak ada player online.");
    return;
  }

  const freshPerPlayer = Math.floor(freshTreasury / freshOnline.length);
  if (freshPerPlayer <= 0) {
    admin.sendMessage("§8[§cTax§8]§c Treasury tidak cukup dibagi.");
    return;
  }

  let distributed = 0;
  let actualTotal = 0;
  for (const p of freshOnline) {
    try {
      coin.addScore(p, freshPerPlayer);
      p.sendMessage(`§8[§aTax§8]§a Kamu menerima §e${fmt(freshPerPlayer)} Koin §adari distribusi treasury!`);
      distributed++;
      actualTotal += freshPerPlayer;
    } catch {}
  }

  if (actualTotal > 0) {
    drainTreasury(actualTotal);
    trackFlow("tax_distribute", actualTotal);
  }
  admin.sendMessage(
    `§8[§aTax§8]§a Distribusi selesai!\n` +
    `§7 Dibagikan ke : §f${distributed} player\n` +
    `§7 Per player   : §e${fmt(freshPerPlayer)} Koin\n` +
    `§7 Treasury sisa: §6${fmt(getTreasury())} Koin`
  );
  world.sendMessage(
    `§8[§eTax§8]§e Admin mendistribusikan §f${fmt(actualTotal)} §eKoin dari treasury ` +
    `ke §f${distributed} §eplayer!`
  );
}

async function adminForceCollect(admin) {
  const confirm = await new MessageFormData()
    .title("§8 ♦ §cPAKSA KUMPUL§r §8♦ §r")
    .body(
      `§f Paksa kumpulkan pajak sekarang?\n` +
      `§c Ini akan reset periode hari ini dan potong saldo player!`
    )
    .button1("§f Batal")
    .button2("§c Paksa")
    .show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;

  // Reset period agar collectWealthTax() tidak skip
  dpSet(K_PERIOD, -1);
  collectWealthTax();
  admin.sendMessage(
    `§8[§aTax§8]§a Koleksi paksa selesai. Treasury: §6${fmt(getTreasury())} Koin`
  );
}

function _countEligiblePlayers(obj) {
  let count = 0;
  for (const ident of obj.getParticipants()) {
    try {
      const name = ident.displayName;
      if (name && (name.startsWith("command.") || name.includes(".scoreboard."))) continue;
      count++;
    } catch {}
  }
  return count;
}
