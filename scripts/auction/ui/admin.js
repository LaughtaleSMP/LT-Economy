// auction/ui_admin.js — Admin panel

import { world } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG, SFX } from "../config.js";
import {
  getListings, getActiveListings, removeListing, updateListing,
  getHistory, getSettings, saveSettings,
  pushNotif, addPendingItem, addPendingCoin,
} from "../utils/storage.js";
import { displayName, giveItem, itemIcon } from "../utils/items.js";
import { addCoin, fmt, timeLeft, timeAgo, playSfx } from "../utils/helpers.js";
import { getDPStats, formatBytes, cleanupInactive } from "../../dp_manager.js";
import { UIClose } from "../../ui_close.js";

export async function uiAdmin(player) {
  if (!player.hasTag(CFG.ADMIN_TAG)) { player.sendMessage("§c[Auction] Akses ditolak."); return; }

  while (true) {
    const settings = getSettings();
    const active = getActiveListings();

    let ab = `${CFG.HR}\n`;
    ab += `§c  A D M I N\n`;
    ab += `${CFG.HR}\n\n`;
    ab += `  §eAdmin   §8── §a${player.name}\n`;
    ab += `  §eFee     §8── §f${settings.feePct}%\n`;
    ab += `  §eListing §8── §f${active.length} §8aktif\n`;
    ab += `\n${CFG.HR}`;

    const form = new ActionFormData()
      .title("§8 ♦ §cADMIN§r §8♦ §r")
      .body(ab)
      .button("§c  Hapus Listing\n§r  §8Force cancel listing", "textures/items/redstone_dust")
      .button("§e  Ubah Fee\n§r  §8Persentase fee listing", "textures/items/gold_ingot")
      .button("§b  Log History\n§r  §8Riwayat transaksi global", "textures/items/book_writable")
      .button("§a  DP Stats\n§r  §8Monitor dynamic property", "textures/items/compass_item")
      .button("§6  Kembali", "textures/items/arrow");

    playSfx(player, SFX.ADMIN);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (res.selection === 4) return;

    if (res.selection === 0) await adminRemoveListing(player);
    if (res.selection === 1) await adminSetFee(player);
    if (res.selection === 2) await adminViewHistory(player);
    if (res.selection === 3) await adminDPStats(player);
  }
}

async function adminRemoveListing(admin) {
  const active = getActiveListings();
  if (!active.length) {
    await new ActionFormData().title("  Hapus Listing  §r")
      .body(`${CFG.HR}\n§7 Tidak ada listing aktif.\n${CFG.HR}`)
      .button("§f Kembali", "textures/items/arrow").show(admin);
    return;
  }

  const form = new ActionFormData()
    .title("§8 ♦ §cHAPUS LISTING§r §8♦ §r")
    .body(`${CFG.HR}\n§c Pilih listing untuk dihapus:\n${CFG.HR}`);

  for (const l of active) {
    const isAuc = l.mode === "auction";
    const pLabel = isAuc
      ? (l.bidCount > 0 ? `§b${fmt(l.currentBid)}⛃` : `§e${fmt(l.startBid)}⛃ §8start`)
      : `§e${fmt(l.price)}⛃`;
    const modeTag = isAuc ? " §b⚡" : "";
    form.button(`§f  ${displayName(l.itemData)}${modeTag}\n§r  §b${l.sellerName} §8| ${pLabel} §8| §f${timeLeft(l.expiresAt)}`, itemIcon(l.itemData.typeId));
  }
  form.button("§6  Kembali", "textures/items/arrow");

  const res = await form.show(admin);
  if (res.canceled || res.selection === active.length) return;

  const l = active[res.selection];

  // Refund buyout offer bidder
  if (l.offerId && l.offerAmount > 0) {
    const bidder = world.getPlayers().find(p => p.id === l.offerId);
    if (bidder) { addCoin(bidder, l.offerAmount); bidder.sendMessage(`§e[Auction] Admin menghapus listing. §f${fmt(l.offerAmount)} Koin §edikembalikan.`); }
    else {
      pushNotif(l.offerId, `§e[Auction] Admin menghapus listing. §f${fmt(l.offerAmount)} Koin §edikembalikan.`);
      addPendingCoin(l.offerId, l.offerAmount);
    }
  }

  // Refund auction bidder
  if (l.mode === "auction" && l.bidderId && l.currentBid > 0) {
    const bidder = world.getPlayers().find(p => p.id === l.bidderId);
    if (bidder) { addCoin(bidder, l.currentBid); bidder.sendMessage(`§e[Auction] Admin menghapus lelang. §f${fmt(l.currentBid)} Koin §edikembalikan.`); }
    else {
      pushNotif(l.bidderId, `§e[Auction] Admin menghapus lelang. §f${fmt(l.currentBid)} Koin §edikembalikan.`);
      addPendingCoin(l.bidderId, l.currentBid);
    }
  }

  // Return item to seller
  const seller = world.getPlayers().find(p => p.id === l.sellerId);
  if (seller) {
    const gave = giveItem(seller, l.itemData);
    if (!gave) addPendingItem(seller.id, l.itemData);
    seller.sendMessage(`§c[Auction] Admin menghapus listing §f${displayName(l.itemData)}§c. Item dikembalikan.`);
  } else {
    addPendingItem(l.sellerId, l.itemData);
    pushNotif(l.sellerId, `§c[Auction] Admin menghapus listing §f${displayName(l.itemData)}§c. Item dikembalikan.`);
  }

  removeListing(l.id);
  playSfx(admin, SFX.ADMIN);
  admin.sendMessage(`§a[Auction Admin] Listing §f${displayName(l.itemData)} §a(${l.sellerName}) dihapus.`);
}

async function adminSetFee(admin) {
  const settings = getSettings();
  const res = await new ModalFormData()
    .title("  Ubah Fee  §r")
    .slider(
      `§6 Fee Listing §8(saat ini: §f${settings.feePct}%§8)`,
      0, 30, { valueStep: 1, defaultValue: settings.feePct }
    )
    .show(admin);

  if (res.canceled) return;
  const newFee = Math.floor(Number(res.formValues?.[0] ?? settings.feePct));
  if (!Number.isFinite(newFee) || newFee < 0 || newFee > 30) {
    admin.sendMessage("§c[Auction] Nilai tidak valid."); return;
  }

  settings.feePct = newFee;
  saveSettings(settings);
  playSfx(admin, SFX.ADMIN);
  admin.sendMessage(`§a[Auction Admin] Fee diubah ke §f${newFee}%`);
}

async function adminViewHistory(admin) {
  const hist = getHistory();
  let body = `${CFG.HR}\n§e Riwayat Auction Global\n${CFG.HR}\n`;

  if (!hist.length) {
    body += "\n§7 Belum ada riwayat.\n";
  } else {
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      if (h.type === "sold" || h.type === "offer_accepted") {
        body += `\n§f${i + 1}. §a${h.seller} §8→ §b${h.buyer}\n`;
        body += `§8   Item: §e${h.item} §8| §e${fmt(h.price)} Koin\n`;
      } else if (h.type === "auction_won") {
        body += `\n§f${i + 1}. §b⚡ §a${h.seller} §8→ §b${h.buyer}\n`;
        body += `§8   Item: §e${h.item} §8| §e${fmt(h.price)} Koin §8(lelang)\n`;
      } else if (h.type === "expired") {
        body += `\n§f${i + 1}. §8[Expired] §7${h.seller}\n`;
        body += `§8   Item: §e${h.item}\n`;
      }
      body += `§8   ${timeAgo(h.ts)}\n`;
    }
  }
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("  History Auction  §r")
    .body(body)
    .button("§f Kembali", "textures/items/arrow")
    .show(admin);
}

async function adminDPStats(admin) {
  while (true) {
    const stats = getDPStats();
    const pct32k = (stats.totalBytes / (32 * 1024) * 100).toFixed(1);

    let statusColor = "§a";
    let statusLabel = "AMAN";
    if (stats.totalBytes > 1_500_000) { statusColor = "§c"; statusLabel = "KRITIS!"; }
    else if (stats.totalBytes > 500_000) { statusColor = "§e"; statusLabel = "PERHATIAN"; }

    const body =
      `${CFG.HR}\n` +
      `§6 Status  §8» ${statusColor}${statusLabel}\n` +
      `§6 Total   §8» §e${formatBytes(stats.totalBytes)}\n` +
      `§6 Keys    §8» §f${stats.keyCount} §8(§7${stats.playerKeyCount} player§8, §7${stats.globalKeyCount} global§8)\n` +
      `§6 Players §8» §f${stats.trackedPlayers} §7tracked\n` +
      `${CFG.HR}\n` +
      `§8 Auto-cleanup: player inaktif >30 hari\n` +
      `§8 Auto-warning: >500 KB | Auto-clean: >1.5 MB\n` +
      `${CFG.HR}`;

    const form = new ActionFormData()
      .title("§8 ♦ §cDP MONITOR§r §8♦ §r")
      .body(body)
      .button("§e  Cleanup 30 Hari\n§r  §8Hapus data player inaktif", "textures/items/iron_shovel")
      .button("§c  Cleanup 7 Hari\n§r  §8Hapus lebih agresif", "textures/items/diamond_shovel")
      .button("§6  Kembali", "textures/items/arrow");

    playSfx(admin, SFX.ADMIN);
    const res = await form.show(admin);
    if (res.canceled) throw new UIClose();
    if (res.selection === 2) return;

    let result;
    if (res.selection === 0) result = cleanupInactive(30, true);
    if (res.selection === 1) result = cleanupInactive(7, true);

    if (result && (result.players > 0 || result.keys > 0)) {
      admin.sendMessage(`§a[DP Cleanup] Dibersihkan §f${result.keys} §akeys dari §f${result.players} §aplayer inaktif.`);
    } else {
      admin.sendMessage("§7[DP Cleanup] Tidak ada data player inaktif untuk dibersihkan.");
    }
  }
}
