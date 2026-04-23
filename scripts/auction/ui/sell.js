// auction/ui_sell.js — UI: Jual Item & Listing Saya

import { world } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG, SFX } from "../config.js";
import {
  getActiveListings, getListings, addListing, updateListing, removeListing,
  getPlayerActiveCount, calcFee, getFee, genId, pushHistory,
  pushNotif, addPendingItem, addPendingCoin, claimPendingCoin,
  getPendingItems, savePendingItems, writeTx, clearTx,
} from "../utils/storage.js";
import { displayName, enchantSummary, serializeItem, giveItem, freeSlots, takeItemFromSlot, takePartialFromSlot } from "../utils/items.js";
import { getCoin, setCoin, addCoin, withLock, fmt, timeLeft, playSfx } from "../utils/helpers.js";

// ═══════════════════════════════════════════════════════════
// UI: JUAL ITEM
// ═══════════════════════════════════════════════════════════
export async function uiSell(player) {
  const count = getPlayerActiveCount(player.id);
  if (count >= CFG.MAX_LISTINGS) {
    await new ActionFormData()
      .title("§l  Jual Item  §r")
      .body(`${CFG.HR}\n§c Kamu sudah punya §f${count}§c listing aktif (maks ${CFG.MAX_LISTINGS}).\n§8 Batalkan listing lama dulu.\n${CFG.HR}`)
      .button("§f§l Kembali").show(player);
    return;
  }
  if (getActiveListings().length >= CFG.MAX_GLOBAL) {
    await new ActionFormData()
      .title("§l  Jual Item  §r")
      .body(`${CFG.HR}\n§c Auction house penuh (${CFG.MAX_GLOBAL} listing).\n§8 Coba lagi nanti.\n${CFG.HR}`)
      .button("§f§l Kembali").show(player);
    return;
  }

  // Step 1: Pilih item dari inventory
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;

  const slots = [];
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item) slots.push({ slot: i, item });
  }

  if (!slots.length) {
    await new ActionFormData()
      .title("§l  Jual Item  §r")
      .body(`${CFG.HR}\n§c Inventory kosong.\n${CFG.HR}`)
      .button("§f§l Kembali").show(player);
    return;
  }

  const form1 = new ActionFormData()
    .title("§l§8 ♦ §eJUAL ITEM§r§l §8♦ §r")
    .body(`${CFG.HR}\n§8 Pilih item dari inventory\n§6 Fee §8── §e${getFee()}% §8dari harga\n${CFG.HR}`);

  for (const s of slots) {
    const enc = (() => { try { const e = s.item.getComponent("minecraft:enchantable"); return e?.getEnchantments()?.length > 0; } catch { return false; } })();
    const name = displayName(serializeItem(s.item));
    const qty = s.item.amount > 1 ? ` x${s.item.amount}` : "";
    form1.button(`§f§l  ${name}${qty}${enc ? " §d✦" : ""}\n§r  §8Slot ${s.slot}`);
  }
  form1.button("§6§l  ◀ Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === slots.length) return;

  const chosen = slots[res1.selection];
  const itemCheck = inv.getItem(chosen.slot);
  if (!itemCheck) { player.sendMessage("§c[Auction] Item sudah tidak ada di slot itu."); return; }

  const previewData = serializeItem(itemCheck);
  const itemLabel = displayName(previewData);
  const totalAmount = itemCheck.amount;

  // Step 2: Pilih quantity (hanya jika stackable & amount > 1)
  let sellQty = totalAmount;

  if (totalAmount > 1) {
    const res1b = await new ModalFormData()
      .title(`§l  Jumlah — ${itemLabel}  §r`)
      .slider(
        `§6 Item §8» §e${itemLabel}\n§6 Stok §8» §f${totalAmount} §8di slot ini\n§8 Geser untuk pilih jumlah yang dijual:`,
        1, totalAmount, { valueStep: 1, defaultValue: totalAmount }
      )
      .show(player);

    if (res1b.canceled) return;

    sellQty = Math.floor(Number(res1b.formValues?.[0] ?? totalAmount));
    if (!Number.isFinite(sellQty) || sellQty < 1) sellQty = 1;
    if (sellQty > totalAmount) sellQty = totalAmount;

    const recheck = inv.getItem(chosen.slot);
    if (!recheck || recheck.amount < sellQty) {
      player.sendMessage("§c[Auction] Item berubah! Coba lagi.");
      return;
    }
  }

  const qtyLabel = sellQty > 1 ? ` x${sellQty}` : "";

  // Step 3: Pilih mode — Buyout atau Auction
  const modeForm = new ActionFormData()
    .title("§l§8 ♦ §eMODE§r§l §8♦ §r")
    .body(`${CFG.HR}\n§8 Pilih mode listing untuk\n§f ${itemLabel}${qtyLabel}\n${CFG.HR}`);
  modeForm.button(`§e§l  ⛃ Buyout\n§r  §8Harga tetap, beli langsung`);
  modeForm.button(`§b§l  ⚡ Auction\n§r  §8Lelang naik, bid war`);
  modeForm.button("§6§l  ◀ Batal");

  const modeRes = await modeForm.show(player);
  if (modeRes.canceled || modeRes.selection === 2) return;
  const isAuction = modeRes.selection === 1;

  let price = 0, startBid = 0, buyoutPrice = 0, fee = 0;

  if (!isAuction) {
    // Step 4a: Buyout — Input harga
    const res2 = await new ModalFormData()
      .title(`§l  Harga — ${itemLabel}  §r`)
      .textField(
        `§6 Item   §8» §e${itemLabel}${qtyLabel}\n§f Tentukan harga buyout §8(total)\n§8 Min: §e${fmt(CFG.MIN_PRICE)} §8| Maks: §e${fmt(CFG.MAX_BUYOUT)}\n§6 Fee §8» §e${getFee()}% §8dipotong dari saldo`,
        "Contoh: 1000", { defaultValue: "" }
      )
      .show(player);
    if (res2.canceled) return;

    price = Math.floor(Number(String(res2.formValues?.[0] ?? "").trim()));
    if (!Number.isFinite(price) || price < CFG.MIN_PRICE) {
      player.sendMessage(`§c[Auction] Harga minimal §f${fmt(CFG.MIN_PRICE)} Koin.`); return;
    }
    if (price > CFG.MAX_BUYOUT) {
      player.sendMessage(`§c[Auction] Harga maks §f${fmt(CFG.MAX_BUYOUT)} Koin.`); return;
    }
    fee = calcFee(price);
  } else {
    // Step 4b: Auction — Input starting bid + buyout
    const res2 = await new ModalFormData()
      .title(`§l  Auction — ${itemLabel}  §r`)
      .textField(
        `§6 Item §8» §e${itemLabel}${qtyLabel}\n§f Tentukan starting bid\n§8 Min: §e${fmt(CFG.MIN_PRICE)}`,
        "Contoh: 500", { defaultValue: "" }
      )
      .textField(
        `§f Buyout Price §8(opsional)\n§8 Harga beli langsung tanpa nunggu.\n§8 Kosongkan atau 0 = tanpa buyout.`,
        "0 = tanpa buyout", { defaultValue: "0" }
      )
      .show(player);
    if (res2.canceled) return;

    startBid = Math.floor(Number(String(res2.formValues?.[0] ?? "").trim()));
    buyoutPrice = Math.floor(Number(String(res2.formValues?.[1] ?? "0").trim()));
    if (!Number.isFinite(startBid) || startBid < CFG.MIN_PRICE) {
      player.sendMessage(`§c[Auction] Starting bid minimal §f${fmt(CFG.MIN_PRICE)} Koin.`); return;
    }
    if (!Number.isFinite(buyoutPrice)) buyoutPrice = 0;
    if (buyoutPrice > 0 && buyoutPrice <= startBid) {
      player.sendMessage("§c[Auction] Buyout harus lebih besar dari starting bid!"); return;
    }
    if (buyoutPrice > CFG.MAX_BUYOUT) {
      player.sendMessage(`§c[Auction] Buyout maks §f${fmt(CFG.MAX_BUYOUT)} Koin.`); return;
    }
    price = buyoutPrice; // 0 if no buyout
    fee = calcFee(startBid);
  }

  if (getCoin(player) < fee) {
    player.sendMessage(`§c[Auction] Saldo kurang untuk fee! Butuh §f${fmt(fee)} Koin §c(${getFee()}% dari ${fmt(isAuction ? startBid : price)}).`); return;
  }

  // Step 5: Konfirmasi
  const ench = enchantSummary(previewData);
  let confirmBody = `${CFG.HR}\n`;
  if (isAuction) {
    confirmBody += `  §eMode    §8── §b⚡ Auction\n`;
    confirmBody += `  §eItem    §8── §f${itemLabel}${qtyLabel}\n`;
    if (ench) confirmBody += `  §eEnchant §8── §d${ench}\n`;
    confirmBody += `  §eStart   §8── §e${fmt(startBid)}⛃\n`;
    confirmBody += buyoutPrice > 0
      ? `  §eBuyout  §8── §e${fmt(buyoutPrice)}⛃\n`
      : `  §eBuyout  §8── §8Tidak ada\n`;
  } else {
    confirmBody += `  §eMode    §8── §e⛃ Buyout\n`;
    confirmBody += `  §eItem    §8── §f${itemLabel}${qtyLabel}\n`;
    if (ench) confirmBody += `  §eEnchant §8── §d${ench}\n`;
    confirmBody += `  §eHarga   §8── §e${fmt(price)}⛃\n`;
  }
  confirmBody += `  §eFee     §8── §c-${fmt(fee)}⛃ §8(${getFee()}%)\n`;
  confirmBody += `  §eDurasi  §8── §f24 jam\n`;
  confirmBody += `${CFG.HR}\n`;
  if (sellQty < totalAmount) {
    confirmBody += `§8 ${sellQty} item diambil dari slot. Sisa ${totalAmount - sellQty} tetap di inventory.\n`;
  } else {
    confirmBody += `§8 Item akan diambil dari inventory.\n`;
  }
  confirmBody += `§8 Fee tidak dikembalikan jika dibatalkan.\n`;
  confirmBody += `${CFG.HR}`;

  const confirm = await new MessageFormData()
    .title("§l  Konfirmasi Listing  §r")
    .body(confirmBody)
    .button1("§f Batal").button2("§a Pasang Listing").show(player);

  if (confirm.canceled || confirm.selection !== 1) return;

  // Execute
  const finalItem = inv.getItem(chosen.slot);
  if (!finalItem) { player.sendMessage("§c[Auction] Item sudah tidak ada!"); return; }
  if (finalItem.amount < sellQty) { player.sendMessage("§c[Auction] Jumlah item berubah! Coba lagi."); return; }
  if (getCoin(player) < fee) { player.sendMessage("§c[Auction] Saldo kurang untuk fee!"); return; }

  const listingId = genId();

  const preItemData = serializeItem(finalItem);
  preItemData.amount = sellQty;

  writeTx(player.id, { type: "sell", listingId, itemData: preItemData, fee });

  const itemData = takePartialFromSlot(player, chosen.slot, sellQty);
  if (!itemData) {
    clearTx(player.id);
    player.sendMessage("§c[Auction] Gagal mengambil item.");
    return;
  }

  setCoin(player, getCoin(player) - fee);

  const listing = {
    id: listingId,
    sellerId: player.id,
    sellerName: player.name,
    itemData,
    price,
    fee,
    // Buyout offer fields
    offerId: null,
    offerName: null,
    offerAmount: 0,
    // Auction fields
    mode: isAuction ? "auction" : "buyout",
    startBid: isAuction ? startBid : 0,
    currentBid: 0,
    bidderId: null,
    bidderName: null,
    bidCount: 0,
    // Timestamps
    createdAt: Date.now(),
    expiresAt: Date.now() + CFG.DURATION_MS,
    status: "active",
    buyerId: null,
    buyerName: null,
  };

  addListing(listing);
  clearTx(player.id);

  playSfx(player, SFX.LIST);
  if (isAuction) {
    player.sendMessage(
      `§a[Auction] Lelang berhasil dipasang!\n` +
      `§8  Item  : §f${itemLabel}${qtyLabel}\n` +
      `§8  Start : §e${fmt(startBid)} Koin\n` +
      (buyoutPrice > 0 ? `§8  Buyout: §e${fmt(buyoutPrice)} Koin\n` : "") +
      `§8  Fee   : §c-${fmt(fee)} Koin\n` +
      `§8  Durasi: §f24 jam`
    );
  } else {
    player.sendMessage(
      `§a[Auction] Listing berhasil dipasang!\n` +
      `§8  Item  : §f${itemLabel}${qtyLabel}\n` +
      `§8  Harga : §e${fmt(price)} Koin\n` +
      `§8  Fee   : §c-${fmt(fee)} Koin\n` +
      `§8  Durasi: §f24 jam`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// UI: LISTING SAYA
// ═══════════════════════════════════════════════════════════
export async function uiMyListings(player) {
  while (true) {
    const pending = getPendingItems(player.id);
    if (pending.length > 0) {
      let claimed = 0;
      const remain = [];
      for (const itemData of pending) {
        if (giveItem(player, itemData)) claimed++;
        else remain.push(itemData);
      }
      savePendingItems(player.id, remain);
      if (claimed > 0) player.sendMessage(`§a[Auction] ${claimed} item pending diklaim!${remain.length ? ` §e(${remain.length} masih pending - inventory penuh)` : ""}`);
    }

    const pendCoin = claimPendingCoin(player, addCoin);
    if (pendCoin > 0) {
      player.sendMessage(`§a[Auction] §e${fmt(pendCoin)} Koin §adari penjualan diterima!`);
    }

    const myListings = getActiveListings().filter(l => l.sellerId === player.id);
    if (!myListings.length) {
      await new ActionFormData()
        .title("§l  Listing Saya  §r")
        .body(`${CFG.HR}\n§8 Kamu tidak punya listing aktif.\n${CFG.HR}`)
        .button("§f§l Kembali").show(player);
      return;
    }

    const form = new ActionFormData()
      .title(`§l§8 ♦ §eLISTING SAYA§r§l §8♦ §r`)
      .body(`${CFG.HR}\n§8 Kelola listing aktifmu:\n${CFG.HR}`);

    for (const l of myListings) {
      const name = displayName(l.itemData);
      const isAuc = l.mode === "auction";
      const badge = isAuc
        ? (l.bidCount > 0 ? ` §b⚡${l.bidCount}` : " §b⚡")
        : (l.offerId ? ` §c[!]` : "");
      const priceLabel = isAuc
        ? (l.bidCount > 0 ? `§b${fmt(l.currentBid)}⛃` : `§e${fmt(l.startBid)}⛃ §8start`)
        : `§e${fmt(l.price)}⛃`;
      form.button(`§f§l  ${name}${badge}\n§r  ${priceLabel} §8| §f${timeLeft(l.expiresAt)}`);
    }
    form.button("§6§l  ◀ Kembali");

    const res = await form.show(player);
    if (res.canceled || res.selection === myListings.length) return;

    await uiMyListingDetail(player, myListings[res.selection].id);
  }
}

async function uiMyListingDetail(player, listingId) {
  const l = getActiveListings().find(x => x.id === listingId && x.sellerId === player.id);
  if (!l) { player.sendMessage("§c[Auction] Listing tidak ditemukan."); return; }

  const name = displayName(l.itemData);
  const ench = enchantSummary(l.itemData);
  const isAuc = l.mode === "auction";
  const hasOffer = !isAuc && l.offerId && l.offerAmount > 0;
  const hasBid = isAuc && l.bidderId && l.currentBid > 0;

  let body = `${CFG.HR}\n`;
  body += `  §eItem    §8── §f${name}${l.itemData.amount > 1 ? ` x${l.itemData.amount}` : ""}\n`;
  if (ench) body += `  §eEnchant §8── §d${ench}\n`;
  body += `  §eMode    §8── ${isAuc ? "§b⚡ Auction" : "§e⛃ Buyout"}\n`;

  if (isAuc) {
    body += `  §eStart   §8── §e${fmt(l.startBid)}⛃\n`;
    if (l.price > 0) body += `  §eBuyout  §8── §e${fmt(l.price)}⛃\n`;
    body += `  §eBid     §8── ${hasBid ? `§b${fmt(l.currentBid)}⛃ §8(${l.bidCount}x) §8oleh §f${l.bidderName}` : "§8Belum ada bid"}\n`;
  } else {
    body += `  §eHarga   §8── §e${fmt(l.price)}⛃\n`;
    if (hasOffer) body += `  §eTawaran §8── §b${fmt(l.offerAmount)}⛃ §8dari §f${l.offerName}\n`;
  }
  body += `  §eSisa    §8── §f${timeLeft(l.expiresAt)}\n`;
  body += `${CFG.HR}`;

  const btns = [];
  const form = new ActionFormData().title("§l§8 ♦ §eDETAIL§r§l §8♦ §r").body(body);

  if (hasOffer) {
    form.button(`§a§l  Terima Tawaran\n§r  §e${fmt(l.offerAmount)}⛃ §8dari §f${l.offerName}`); btns.push("accept");
    form.button("§c§l  Tolak Tawaran"); btns.push("decline");
  }
  // Auction listings settle automatically — no accept/decline
  form.button("§c§l  Batalkan Listing\n§r  §8Item kembali, fee tidak refund"); btns.push("cancel");
  form.button("§6§l  ◀ Kembali"); btns.push("back");

  const res = await form.show(player);
  if (res.canceled || btns[res.selection] === "back") return;

  if (btns[res.selection] === "accept") {
    await acceptOffer(player, listingId);
  } else if (btns[res.selection] === "decline") {
    await declineOffer(player, listingId);
  } else if (btns[res.selection] === "cancel") {
    await cancelListing(player, listingId);
  }
}

async function acceptOffer(seller, listingId) {
  const confirm = await new MessageFormData()
    .title("§l  Terima Tawaran?  §r")
    .body(`${CFG.HR}\n§f Terima tawaran ini?\n§8 Koin langsung masuk saldo.\n${CFG.HR}`)
    .button1("§f Batal").button2("§a Terima").show(seller);
  if (confirm.canceled || confirm.selection !== 1) return;

  const result = await withLock(seller.id, () => {
    const l = getListings().find(x => x.id === listingId);
    if (!l || l.status !== "active" || !l.offerId) return { ok: false };

    addCoin(seller, l.offerAmount);

    const buyer = world.getPlayers().find(p => p.id === l.offerId);
    if (buyer) {
      const gave = giveItem(buyer, l.itemData);
      if (!gave) addPendingItem(buyer.id, l.itemData);
      playSfx(buyer, SFX.BUY);
      buyer.sendMessage(`§a[Auction] Tawaran diterima! §f${displayName(l.itemData)} §adi-claim.${!gave ? "\n§c⚠ Inventory penuh, item masuk pending." : ""}`);
    } else {
      addPendingItem(l.offerId, l.itemData);
      pushNotif(l.offerId, `§a[Auction] Tawaran §b${fmt(l.offerAmount)} Koin §auntuk §f${displayName(l.itemData)} §aditerima!`);
    }

    updateListing(listingId, x => { x.status = "sold"; x.buyerId = l.offerId; x.buyerName = l.offerName; });
    pushHistory({ type: "offer_accepted", item: displayName(l.itemData), seller: seller.name, buyer: l.offerName, price: l.offerAmount });
    return { ok: true, amount: l.offerAmount, itemName: displayName(l.itemData), buyerName: l.offerName, sellerName: seller.name, hasEnch: l.itemData.enchantments?.length > 0 };
  });

  if (!result || !result.ok) { seller.sendMessage("§c[Auction] Gagal memproses."); return; }
  playSfx(seller, SFX.SOLD);
  seller.sendMessage(`§a[Auction] Tawaran diterima!\n§8  Item  : §f${result.itemName}\n§8  Harga : §e${fmt(result.amount)} Koin`);

  if (result.amount >= CFG.BROADCAST_MIN_PRICE) {
    const enchBadge = result.hasEnch ? " §d✦" : "";
    world.sendMessage(
      `\n§6§l[Auction]§r §e${result.buyerName} §fmembeli §e${result.itemName}${enchBadge} §fdari §e${result.sellerName} §fseharga §e${fmt(result.amount)} Koin§f!\n`
    );
  }
}

async function declineOffer(seller, listingId) {
  const result = await withLock(seller.id, () => {
    const l = getListings().find(x => x.id === listingId);
    if (!l || !l.offerId) return false;

    const bidder = world.getPlayers().find(p => p.id === l.offerId);
    if (bidder) { addCoin(bidder, l.offerAmount); bidder.sendMessage(`§c[Auction] Tawaran §e${fmt(l.offerAmount)} Koin §cuntuk §f${displayName(l.itemData)} §cditolak. Koin dikembalikan.`); }
    else { pushNotif(l.offerId, `§c[Auction] Tawaran §e${fmt(l.offerAmount)} Koin §cditolak. Koin dikembalikan.`); }

    if (!bidder) {
      addPendingCoin(l.offerId, l.offerAmount);
    }

    updateListing(listingId, x => { x.offerId = null; x.offerName = null; x.offerAmount = 0; });
    return true;
  });

  if (!result) { seller.sendMessage("§c[Auction] Gagal."); return; }
  playSfx(seller, SFX.CANCEL);
  seller.sendMessage("§8[Auction] Tawaran ditolak. Koin dikembalikan ke penawar.");
}

async function cancelListing(seller, listingId) {
  const confirm = await new MessageFormData()
    .title("§l  Batalkan Listing?  §r")
    .body(`${CFG.HR}\n§c Item akan dikembalikan ke inventory.\n§c Fee listing TIDAK dikembalikan!\n${CFG.HR}`)
    .button1("§f Tidak").button2("§c Batalkan").show(seller);
  if (confirm.canceled || confirm.selection !== 1) return;

  const result = await withLock(seller.id, () => {
    const l = getListings().find(x => x.id === listingId);
    if (!l || l.status !== "active") return { ok: false };

    // Refund buyout offer bidder
    if (l.offerId && l.offerAmount > 0) {
      const bidder = world.getPlayers().find(p => p.id === l.offerId);
      if (bidder) { addCoin(bidder, l.offerAmount); bidder.sendMessage(`§e[Auction] Listing dibatalkan. §f${fmt(l.offerAmount)} Koin §edikembalikan.`); }
      else {
        pushNotif(l.offerId, `§e[Auction] Listing dibatalkan. §f${fmt(l.offerAmount)} Koin §edikembalikan.`);
        addPendingCoin(l.offerId, l.offerAmount);
      }
    }

    // Refund auction bidder
    if (l.mode === "auction" && l.bidderId && l.currentBid > 0) {
      const bidder = world.getPlayers().find(p => p.id === l.bidderId);
      if (bidder) { addCoin(bidder, l.currentBid); bidder.sendMessage(`§e[Auction] Lelang dibatalkan. §f${fmt(l.currentBid)} Koin §edikembalikan.`); }
      else {
        pushNotif(l.bidderId, `§e[Auction] Lelang dibatalkan. §f${fmt(l.currentBid)} Koin §edikembalikan.`);
        addPendingCoin(l.bidderId, l.currentBid);
      }
    }

    // Return item
    const gave = giveItem(seller, l.itemData);
    if (!gave) addPendingItem(seller.id, l.itemData);

    removeListing(listingId);
    return { ok: true, gave, itemName: displayName(l.itemData) };
  });

  if (!result || !result.ok) { seller.sendMessage("§c[Auction] Gagal membatalkan."); return; }
  playSfx(seller, SFX.CANCEL);
  seller.sendMessage(`§8[Auction] Listing dibatalkan. §f${result.itemName} §8dikembalikan.${!result.gave ? "\n§c⚠ Inventory penuh, item masuk pending." : ""}`);
}
