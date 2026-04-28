// auction/ui_browse.js — Premium UI v2.0 + Auction Bidding
import { world } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG, SFX, CATEGORIES, CAT_OTHER, CAT_ENCHANTED } from "../config.js";
import { getActiveListings, updateListing, pushHistory, pushNotif, addPendingItem, addPendingCoin, calcFee, getFee, writeTx, clearTx } from "../utils/storage.js";
import { displayName, enchantSummary, giveItem, getCategory, rawItemName } from "../utils/items.js";
import { getCoin, setCoin, addCoin, withLock, fmt, timeLeft, playSfx, getMinBid, getEffectivePrice } from "../utils/helpers.js";
import { UIClose } from "../../ui_close.js";

export async function uiBrowse(player) {
  while (true) {
    const allListings = getActiveListings().filter(l => l.sellerId !== player.id);
    if (!allListings.length) {
      await new ActionFormData()
        .title("§8 ♦ §eBROWSE§r §8♦ §r")
        .body(`${CFG.HR}\n§e  B R O W S E\n${CFG.HR}\n${CFG.SP}\n  §8Tidak ada listing aktif saat ini.\n${CFG.SP}\n${CFG.HR}`)
        .button("§6  Kembali", "textures/items/arrow").show(player);
      return;
    }
    const counts = {};
    let enchCount = 0;
    for (const cat of CATEGORIES) counts[cat.id] = 0;
    counts[CAT_OTHER.id] = 0;
    for (const l of allListings) {
      const cat = getCategory(l.itemData.typeId);
      counts[cat.id]++;
      if (l.itemData.enchantments?.length > 0) enchCount++;
    }
    let body = `${CFG.HR}\n§e  K A T E G O R I\n${CFG.HR}\n${CFG.SP}\n`;
    body += `  §6◆ §eTotal Listing\n  §8└ §f${allListings.length} §8tersedia\n${CFG.SP}\n${CFG.HR}`;
    const form = new ActionFormData().title(`§8 ♦ §eKATEGORI§r §8♦ §r`).body(body);
    const catBtns = [];
    for (const cat of CATEGORIES) {
      const c = counts[cat.id];
      form.button(`${cat.color}  ${cat.label}\n§r  §e${c} listing`, cat.tex);
      catBtns.push(cat.id);
    }
    form.button(`${CAT_ENCHANTED.color}  ${CAT_ENCHANTED.label}\n§r  §e${enchCount} listing`, CAT_ENCHANTED.tex);
    catBtns.push(CAT_ENCHANTED.id);
    form.button(`${CAT_OTHER.color}  ${CAT_OTHER.label}\n§r  §e${counts[CAT_OTHER.id]} listing`, CAT_OTHER.tex);
    catBtns.push(CAT_OTHER.id);
    form.button(`§f  Semua (${allListings.length})\n§r  §eLihat semua listing`, "textures/items/spyglass");
    catBtns.push("all");
    form.button("§6  Kembali", "textures/items/arrow");
    playSfx(player, SFX.OPEN);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (res.selection === catBtns.length) return;
    await uiCategoryListings(player, catBtns[res.selection]);
  }
}

async function uiCategoryListings(player, categoryId) {
  const SORT_MODES  = ["newest", "cheapest", "expensive", "expiring"];
  const SORT_LABELS = { newest: "Terbaru", cheapest: "Termurah", expensive: "Termahal", expiring: "Hampir Expired" };
  const SORT_ICONS  = { newest: "§b⏱", cheapest: "§a▼", expensive: "§c▲", expiring: "§e⌛" };
  let sortMode = "newest";
  while (true) {
    const allListings = getActiveListings().filter(l => l.sellerId !== player.id);
    let listings, titleLabel;
    if (categoryId === "all") {
      listings = allListings; titleLabel = "§f Semua";
    } else if (categoryId === CAT_ENCHANTED.id) {
      listings = allListings.filter(l => l.itemData.enchantments?.length > 0);
      titleLabel = `${CAT_ENCHANTED.color} ${CAT_ENCHANTED.label}`;
    } else {
      const catDef = CATEGORIES.find(c => c.id === categoryId) ?? CAT_OTHER;
      listings = allListings.filter(l => getCategory(l.itemData.typeId).id === categoryId);
      titleLabel = `${catDef.color} ${catDef.label}`;
    }
    if (!listings.length) {
      await new ActionFormData().title(` ${titleLabel} §r`)
        .body(`${CFG.HR}\n  §8Tidak ada listing di kategori ini.\n${CFG.HR}`)
        .button("§6  Kembali", "textures/items/arrow").show(player);
      return;
    }
    switch (sortMode) {
      case "cheapest":  listings.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b)); break;
      case "expensive": listings.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a)); break;
      case "newest":    listings.sort((a, b) => b.createdAt - a.createdAt); break;
      case "expiring":  listings.sort((a, b) => a.expiresAt - b.expiresAt); break;
    }
    let body = `${CFG.HR}\n  ${SORT_ICONS[sortMode]} §eUrutan: §f${SORT_LABELS[sortMode]}\n`;
    body += `  §8${listings.length} listing tersedia\n${CFG.HR}`;
    const form = new ActionFormData().title(`§8 ♦ ${titleLabel.trim()}§r §8♦ §r`).body(body);
    form.button(` Urutkan: §r§f${SORT_LABELS[sortMode]}\n§r§8Klik untuk ubah urutan`, "textures/items/compass_item");
    for (const l of listings) {
      const name = displayName(l.itemData);
      const qty = l.itemData.amount > 1 ? ` x${l.itemData.amount}` : "";
      const ench = l.itemData.enchantments?.length ? " §dEnch" : "";
      const renamed = l.itemData.nameTag ? " §c⚠" : "";
      const isAuc = l.mode === "auction";
      if (isAuc) {
        const hasBid = l.bidderId && l.currentBid > 0;
        const bidInfo = hasBid
          ? `§b${fmt(l.currentBid)}⛃ §8by §f${l.bidderName}`
          : `§e${fmt(l.startBid)}⛃ §8start`;
        const icon = hasBid ? "textures/items/diamond" : "textures/items/gold_ingot";
        form.button(`§f  ${name}${qty}${ench}${renamed}\n§r  ${bidInfo} §8| §b${l.sellerName} §8| §f${timeLeft(l.expiresAt)}`, icon);
      } else {
        form.button(`§f  ${name}${qty}${ench}${renamed}\n§r  §e${fmt(l.price)}⛃ §8| §b${l.sellerName} §8| §f${timeLeft(l.expiresAt)}`, "textures/items/emerald");
      }
    }
    form.button("§6  Kembali", "textures/items/arrow");
    playSfx(player, SFX.OPEN);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (res.selection === listings.length + 1) return;
    if (res.selection === 0) {
      const idx = SORT_MODES.indexOf(sortMode);
      sortMode = SORT_MODES[(idx + 1) % SORT_MODES.length];
      continue;
    }
    await uiListingDetail(player, listings[res.selection - 1].id);
  }
}

async function uiListingDetail(player, listingId) {
  while (true) {
    const listings = getActiveListings();
    const l = listings.find(x => x.id === listingId);
    if (!l) { player.sendMessage("§c[Auction] Listing tidak ditemukan/sudah expired."); return; }
    const name = displayName(l.itemData);
    const qty = l.itemData.amount > 1 ? ` x${l.itemData.amount}` : "";
    const ench = enchantSummary(l.itemData);
    const myCoin = getCoin(player);
    const isAuc = l.mode === "auction";
    // Calculate effective balance: include refundable escrow if player is current bidder
    const myEscrow = (isAuc && l.bidderId === player.id && l.currentBid > 0) ? l.currentBid : 0;
    const effectiveCoin = myCoin + myEscrow;

    let body = `${CFG.HR}\n§e  D E T A I L\n${CFG.HR}\n${CFG.SP}\n`;
    body += `  §6◆ §eItem\n`;
    body += `  §8├ §f${name}${qty}\n`;
    if (l.itemData.nameTag) body += `  §8├ §eAsli    §8── §7${rawItemName(l.itemData.typeId)}\n`;
    if (ench) body += `  §8├ §d✦ ${ench}\n`;
    body += `  §8├ §ePenjual §8── §a${l.sellerName}\n`;
    body += `  §8├ §eMode    §8── ${isAuc ? "§b⚡ Auction" : "§e⛃ Buyout"}\n`;

    if (isAuc) {
      body += `  §8├ §eStart   §8── §e${fmt(l.startBid)}⛃\n`;
      if (l.bidderId && l.currentBid > 0) {
        body += `  §8├ §eBid     §8── §b${fmt(l.currentBid)}⛃ §8(${l.bidCount || 1} bid)\n`;
        body += `  §8├ §eBidder  §8── §f${l.bidderName}\n`;
      } else {
        body += `  §8├ §eBid     §8── §8Belum ada bid\n`;
      }
      if (l.price > 0) body += `  §8├ §eBuyout  §8── §e${fmt(l.price)}⛃\n`;
      const minBid = getMinBid(l);
      body += `  §8├ §eMin Bid §8── §f${fmt(minBid)}⛃\n`;
      if (myEscrow > 0) body += `  §8├ §eBid Kamu §8── §b${fmt(myEscrow)}⛃ §8(ditahan)\n`;
    } else {
      body += `  §8├ §eHarga   §8── §e${fmt(l.price)}⛃\n`;
      if (l.offerId && l.offerAmount > 0) {
        body += `${CFG.SP}\n  §b✦ §eTawaran Aktif\n`;
        body += `  §8└ §b${fmt(l.offerAmount)}⛃ §8oleh §f${l.offerName}\n`;
      }
    }
    body += `  §8└ §eSisa    §8── §f${timeLeft(l.expiresAt)}\n`;
    body += `${CFG.SP}\n${CFG.HR_THIN}\n  §6⛃ §eSaldo §8── §e${fmt(myCoin)}⛃${myEscrow > 0 ? ` §8(+§b${fmt(myEscrow)}⛃ §8escrow)` : ""}\n${CFG.HR}`;

    const btns = [];
    const form = new ActionFormData().title(`§8 ♦ §eDETAIL§r §8♦ §r`).body(body);

    if (isAuc) {
      // Auction: Bid button — use effectiveCoin (balance + refundable escrow)
      const minBid = getMinBid(l);
      if (effectiveCoin >= minBid) {
        const costLabel = myEscrow > 0 ? `§8Tambah §e${fmt(minBid - myEscrow)}⛃` : `§8Min §e${fmt(minBid)}⛃`;
        form.button(`§b  Pasang Bid\n§r  ${costLabel}`, "textures/items/diamond"); btns.push("bid");
      } else {
        form.button(`§8  Saldo Kurang\n§r  §8Butuh §e${fmt(minBid - myEscrow)}⛃`, "textures/items/redstone_dust"); btns.push("noop");
      }
      // Buyout button (if set)
      if (l.price > 0) {
        if (myCoin >= l.price) {
          form.button(`§a  Buyout Langsung\n§r  §e${fmt(l.price)}⛃`, "textures/items/emerald"); btns.push("buy");
        } else {
          form.button(`§8  Buyout §c${fmt(l.price)}⛃\n§r  §8Saldo kurang`, "textures/items/redstone_dust"); btns.push("noop");
        }
      }
    } else {
      // Buyout mode
      if (myCoin >= l.price) {
        form.button(`§a  Beli Sekarang\n§r  §e${fmt(l.price)}⛃`, "textures/items/emerald"); btns.push("buy");
      } else {
        form.button(`§8  Saldo Kurang\n§r  §8Butuh §e${fmt(l.price)}⛃`, "textures/items/redstone_dust"); btns.push("noop");
      }
      form.button(`§b  Ajukan Tawaran\n§r  §eTawar harga lebih rendah`, "textures/items/gold_nugget"); btns.push("offer");
    }
    form.button("§6  Kembali", "textures/items/arrow"); btns.push("back");
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "back") return;
    if (btns[res.selection] === "buy") { await executeBuyout(player, listingId); return; }
    if (btns[res.selection] === "offer") { await uiMakeOffer(player, listingId); }
    if (btns[res.selection] === "bid") { await uiPlaceBid(player, listingId); }
  }
}

async function executeBuyout(buyer, listingId) {
  const result = await withLock(buyer.id, () => {
    const l = getActiveListings().find(x => x.id === listingId);
    if (!l) return { ok: false, err: "not_found" };
    if (l.price <= 0) return { ok: false, err: "no_buyout" };
    if (getCoin(buyer) < l.price) return { ok: false, err: "insufficient" };
    writeTx(buyer.id, { type: "buy", listingId, price: l.price });
    setCoin(buyer, getCoin(buyer) - l.price);

    // Refund buyout offer
    if (l.offerId && l.offerAmount > 0) {
      const bidder = world.getPlayers().find(p => p.id === l.offerId);
      if (bidder) addCoin(bidder, l.offerAmount);
      else { pushNotif(l.offerId, `§a[Auction] Tawaran kamu §e${fmt(l.offerAmount)} Koin §adikembalikan.`); addPendingCoin(l.offerId, l.offerAmount); }
    }
    // Refund auction bidder
    if (l.mode === "auction" && l.bidderId && l.currentBid > 0) {
      const bidder = world.getPlayers().find(p => p.id === l.bidderId);
      if (bidder) { addCoin(bidder, l.currentBid); bidder.sendMessage(`§e[Auction] Item di-buyout! §f${fmt(l.currentBid)} Koin §edikembalikan.`); }
      else { pushNotif(l.bidderId, `§e[Auction] Item di-buyout. §f${fmt(l.currentBid)} Koin §edikembalikan.`); addPendingCoin(l.bidderId, l.currentBid); }
    }

    const gave = giveItem(buyer, l.itemData);
    if (!gave) addPendingItem(buyer.id, l.itemData);
    const seller = world.getPlayers().find(p => p.id === l.sellerId);
    if (seller) {
      addCoin(seller, l.price); playSfx(seller, SFX.SOLD);
      seller.sendMessage(`§a[Auction] Item §f${displayName(l.itemData)} §aterjual!\n§8  Pembeli: §f${buyer.name}\n§8  Harga : §e${fmt(l.price)} Koin`);
    } else { pushNotif(l.sellerId, `§a[Auction] Item §f${displayName(l.itemData)} §aterjual seharga §e${fmt(l.price)} Koin §aoleh §f${buyer.name}§a!`); addPendingCoin(l.sellerId, l.price); }
    updateListing(listingId, x => { x.status = "sold"; x.buyerName = buyer.name; x.buyerId = buyer.id; });
    pushHistory({ type: "sold", item: displayName(l.itemData), seller: l.sellerName, buyer: buyer.name, price: l.price });
    clearTx(buyer.id);
    return { ok: true, price: l.price, itemName: displayName(l.itemData), gave, sellerName: l.sellerName, hasEnch: l.itemData.enchantments?.length > 0 };
  });
  if (result === false) { buyer.sendMessage("§c[Auction] Transaksi sedang diproses, coba lagi."); return; }
  if (!result.ok) { buyer.sendMessage(result.err === "insufficient" ? "§c[Auction] Saldo tidak cukup!" : "§c[Auction] Listing sudah tidak tersedia."); return; }
  playSfx(buyer, SFX.BUY);
  buyer.sendMessage(`§a[Auction] Pembelian berhasil!\n§8  Item  : §f${result.itemName}\n§8  Harga : §e${fmt(result.price)} Koin` + (!result.gave ? "\n§c⚠ Inventory penuh! Item masuk pending." : ""));
  if (result.price >= CFG.BROADCAST_MIN_PRICE) {
    const enchBadge = result.hasEnch ? " §d✦" : "";
    world.sendMessage(`\n§6[Auction]§r §e${buyer.name} §fmembeli §e${result.itemName}${enchBadge} §fdari §e${result.sellerName} §fseharga §e${fmt(result.price)} Koin§f!\n`);
  }
}

async function uiPlaceBid(buyer, listingId) {
  const l = getActiveListings().find(x => x.id === listingId);
  if (!l || l.mode !== "auction") { buyer.sendMessage("§c[Auction] Listing tidak tersedia."); return; }
  const minBid = getMinBid(l);
  const myCoin = getCoin(buyer);

  // If buyer is current bidder, their escrow will be refunded — factor it into effective balance
  const myEscrow = (l.bidderId === buyer.id && l.currentBid > 0) ? l.currentBid : 0;
  const effectiveCoin = myCoin + myEscrow;

  // Generate bid options in 10% increments from current bid (or startBid)
  const baseBid = l.bidCount > 0 ? l.currentBid : l.startBid;
  const maxCap = l.price > 0 ? Math.min(effectiveCoin, l.price - 1) : effectiveCoin;
  const bidOptions = [];

  // First option is always the minimum bid
  if (minBid <= maxCap) bidOptions.push(minBid);

  // Generate 10% increments: +10%, +20%, +30%, +40%, +50% from base
  for (let pct = 10; pct <= 50; pct += 10) {
    const bidVal = Math.ceil(baseBid * (100 + pct) / 100);
    if (bidVal <= minBid) continue;
    if (bidVal > maxCap) break;
    if (bidOptions.length > 0 && bidVal === bidOptions[bidOptions.length - 1]) continue;
    bidOptions.push(bidVal);
  }

  if (!bidOptions.length) {
    buyer.sendMessage(`§c[Auction] Saldo tidak cukup untuk bid! Minimal §f${fmt(minBid - myEscrow)} Koin.`);
    return;
  }

  let body = `${CFG.HR}\n§b  ⚡ P A S A N G   B I D\n${CFG.HR}\n${CFG.SP}\n`;
  body += `  §6◆ §eItem    §8── §f${displayName(l.itemData)}\n`;
  if (l.itemData.nameTag) body += `  §8├ §eAsli    §8── §7${rawItemName(l.itemData.typeId)}\n`;
  if (l.bidCount > 0) {
    body += `  §b⚡ §eBid     §8── §b${fmt(l.currentBid)} Koin §8(${l.bidCount} bid)\n`;
  } else {
    body += `  §e⚡ §eStart   §8── §e${fmt(l.startBid)} Koin\n`;
  }
  body += `  §8├ §eMin Bid §8── §f${fmt(minBid)} Koin\n`;
  if (myEscrow > 0) {
    body += `  §8├ §eBid Kamu§8── §b${fmt(myEscrow)} Koin §8(ditahan)\n`;
  }
  body += `  §8└ §eSaldo   §8── §e${fmt(myCoin)} Koin${myEscrow > 0 ? ` §8(+§b${fmt(myEscrow)}§8 escrow)` : ""}\n`;
  body += `${CFG.SP}\n  §8Pilih nominal bid (kelipatan 10%):\n${CFG.HR}`;

  const form = new ActionFormData().title(`§8 ♦ §bBID§r §8♦ §r`).body(body);
  const btnActions = [];

  for (const bidVal of bidOptions) {
    const pctLabel = baseBid > 0 ? `+${Math.round((bidVal - baseBid) / baseBid * 100)}%` : "";
    const extraCost = bidVal - myEscrow; // actual cost after escrow refund
    if (bidVal === minBid) {
      const costInfo = myEscrow > 0 ? `§8Tambah §e${fmt(extraCost)}⛃` : `§8Min bid`;
      form.button(`§b  ${fmt(bidVal)} Koin\n§r  ${costInfo}`, "textures/items/diamond");
    } else {
      const costInfo = myEscrow > 0 ? `§8${pctLabel} · tambah §e${fmt(extraCost)}⛃` : `§8${pctLabel} dari ${l.bidCount > 0 ? "bid" : "start"}`;
      form.button(`§b  ${fmt(bidVal)} Koin\n§r  ${costInfo}`, "textures/items/diamond");
    }
    btnActions.push(bidVal);
  }

  form.button("§6  Kembali", "textures/items/arrow");
  btnActions.push("back");

  playSfx(buyer, SFX.OPEN);
  const res = await form.show(buyer);
  if (res.canceled || btnActions[res.selection] === "back") return;

  const amount = btnActions[res.selection];
  const extraCost = amount - myEscrow;

  // Confirm — show actual cost (difference)
  let confirmBody = `${CFG.HR}\n§e  K O N F I R M A S I\n${CFG.HR}\n${CFG.SP}\n`;
  confirmBody += `  §6◆ §eItem    §8── §f${displayName(l.itemData)}\n`;
  if (l.itemData.nameTag) confirmBody += `  §8├ §eAsli    §8── §7${rawItemName(l.itemData.typeId)}\n`;
  confirmBody += `  §b⚡ §eBid     §8── §b${fmt(amount)} Koin\n`;
  if (myEscrow > 0) {
    confirmBody += `  §8├ §eBid lama §8── §b${fmt(myEscrow)} Koin §8(dikembalikan)\n`;
    confirmBody += `  §8└ §eTambahan §8── §e${fmt(extraCost)} Koin\n`;
  }
  confirmBody += `${CFG.SP}\n  §8Koin ditahan sampai lelang selesai\n  §8atau kamu di-outbid.\n${CFG.HR}`;

  const confirm = await new MessageFormData()
    .title("  Konfirmasi Bid  §r")
    .body(confirmBody)
    .button1("§f Batal").button2("§b Pasang Bid").show(buyer);
  if (confirm.canceled || confirm.selection !== 1) return;

  const result = await withLock(buyer.id, () => {
    const fresh = getActiveListings().find(x => x.id === listingId);
    if (!fresh || fresh.mode !== "auction") return { ok: false, err: "gone" };
    const freshMin = getMinBid(fresh);
    if (amount < freshMin) return { ok: false, err: "outbid" };

    // Calculate actual cost: only the difference if re-bidding
    const freshEscrow = (fresh.bidderId === buyer.id && fresh.currentBid > 0) ? fresh.currentBid : 0;
    const actualCost = amount - freshEscrow;

    if (getCoin(buyer) < actualCost) return { ok: false, err: "insufficient" };

    // Refund previous bidder (only if different player)
    if (fresh.bidderId && fresh.currentBid > 0 && fresh.bidderId !== buyer.id) {
      const oldBidder = world.getPlayers().find(p => p.id === fresh.bidderId);
      if (oldBidder) { addCoin(oldBidder, fresh.currentBid); playSfx(oldBidder, SFX.OUTBID); oldBidder.sendMessage(`§e[Auction] Kamu di-outbid! §f${fmt(fresh.currentBid)} Koin §edikembalikan.`); }
      else { pushNotif(fresh.bidderId, `§e[Auction] Kamu di-outbid. §f${fmt(fresh.currentBid)} Koin §edikembalikan.`); addPendingCoin(fresh.bidderId, fresh.currentBid); }
    }

    // Deduct only the difference (actualCost) — no need to refund+recharge
    writeTx(buyer.id, { type: "bid", listingId, amount });
    setCoin(buyer, getCoin(buyer) - actualCost);
    // IMPORTANT: capture prevBidderId BEFORE updateListing, because fresh and x
    // are the same object reference from cache — mutating x also mutates fresh!
    const prevBidderId = fresh.bidderId;
    updateListing(listingId, x => {
      x.bidderId = buyer.id;
      x.bidderName = buyer.name;
      x.currentBid = amount;
      x.bidCount = (x.bidCount || 0) + (prevBidderId === buyer.id ? 0 : 1);
      // Anti-snipe: extend if bid within threshold
      const remaining = x.expiresAt - Date.now();
      if (remaining < CFG.ANTI_SNIPE_THRESHOLD_MS) {
        x.expiresAt = Date.now() + CFG.ANTI_SNIPE_MS;
      }
    });
    clearTx(buyer.id);
    return { ok: true, actualCost };
  });

  if (result === false) { buyer.sendMessage("§c[Auction] Coba lagi sebentar."); return; }
  if (!result.ok) {
    if (result.err === "outbid") buyer.sendMessage("§c[Auction] Sudah ada bid lebih tinggi! Coba lagi.");
    else buyer.sendMessage("§c[Auction] Listing tidak tersedia / saldo kurang.");
    return;
  }
  playSfx(buyer, SFX.BID);
  if (myEscrow > 0) {
    buyer.sendMessage(`§a[Auction] Bid dinaikkan ke §b${fmt(amount)} Koin§a! Tambahan: §e${fmt(result.actualCost)} Koin`);
  } else {
    buyer.sendMessage(`§a[Auction] Bid §b${fmt(amount)} Koin §aberhasil dipasang!`);
  }
  const seller = world.getPlayers().find(p => p.id === l.sellerId);
  if (seller) {
    playSfx(seller, SFX.BID);
    seller.sendMessage(`§b[Auction] Bid baru!\n§8  Item : §f${displayName(l.itemData)}\n§8  Dari : §f${buyer.name}\n§8  Bid  : §b${fmt(amount)} Koin`);
  } else { pushNotif(l.sellerId, `§b[Auction] Bid baru §b${fmt(amount)} Koin §edari §f${buyer.name} §euntuk §f${displayName(l.itemData)}§e!`); }
}

async function uiMakeOffer(buyer, listingId) {
  const l = getActiveListings().find(x => x.id === listingId);
  if (!l) { buyer.sendMessage("§c[Auction] Listing sudah tidak ada."); return; }
  const maxOffer = l.price - 1;
  const minOffer = CFG.MIN_PRICE;
  const res = await new ModalFormData()
    .title(`  Ajukan Tawaran  §r`)
    .textField(`§6 Harga listing §8» §e${fmt(l.price)} Koin\n§8 Min: §e${fmt(minOffer)} §8| Maks: §e${fmt(maxOffer)}\n§6 Saldo §8» §e${fmt(getCoin(buyer))} Koin`, "Contoh: 500", { defaultValue: "" })
    .show(buyer);
  if (res.canceled) return;
  const amount = Math.floor(Number(String(res.formValues?.[0] ?? "").trim()));
  if (!Number.isFinite(amount) || amount < minOffer) { buyer.sendMessage(`§c[Auction] Minimal §f${fmt(minOffer)} Koin.`); return; }
  if (amount >= l.price) { buyer.sendMessage("§c[Auction] Tawaran harus di bawah harga listing."); return; }
  if (getCoin(buyer) < amount) { buyer.sendMessage("§c[Auction] Saldo tidak cukup!"); return; }
  const renameWarn = l.itemData.nameTag ? `\n  §8├ §eAsli    §8── §7${rawItemName(l.itemData.typeId)}` : "";
  const confirm = await new MessageFormData()
    .title("  Konfirmasi Tawaran  §r")
    .body(`${CFG.HR}\n§e  K O N F I R M A S I\n${CFG.HR}\n${CFG.SP}\n  §6◆ §eItem    §8── §f${displayName(l.itemData)}${renameWarn}\n  §b✦ §eTawaran §8── §b${fmt(amount)} Koin\n${CFG.SP}\n  §8Koin ditahan sampai penjual merespons.\n${CFG.HR}`)
    .button1("§f Batal").button2("§a Kirim").show(buyer);
  if (confirm.canceled || confirm.selection !== 1) return;
  const result = await withLock(buyer.id, () => {
    const fresh = getActiveListings().find(x => x.id === listingId);
    if (!fresh) return { ok: false, err: "gone" };
    if (getCoin(buyer) < amount) return { ok: false, err: "insufficient" };
    if (fresh.offerId && fresh.offerAmount > 0 && fresh.offerId !== buyer.id) {
      const oldBidder = world.getPlayers().find(p => p.id === fresh.offerId);
      if (oldBidder) { addCoin(oldBidder, fresh.offerAmount); oldBidder.sendMessage("§e[Auction] Tawaranmu digantikan. Koin dikembalikan."); }
      else { pushNotif(fresh.offerId, `§e[Auction] Tawaranmu §e${fmt(fresh.offerAmount)} Koin §edigantikan.`); addPendingCoin(fresh.offerId, fresh.offerAmount); }
    }
    if (fresh.offerId === buyer.id && fresh.offerAmount > 0) addCoin(buyer, fresh.offerAmount);
    setCoin(buyer, getCoin(buyer) - amount);
    updateListing(listingId, x => { x.offerId = buyer.id; x.offerName = buyer.name; x.offerAmount = amount; });
    return { ok: true };
  });
  if (result === false) { buyer.sendMessage("§c[Auction] Coba lagi sebentar."); return; }
  if (!result.ok) { buyer.sendMessage("§c[Auction] Listing tidak tersedia / saldo kurang."); return; }
  playSfx(buyer, SFX.OFFER);
  buyer.sendMessage(`§a[Auction] Tawaran §e${fmt(amount)} Koin §aterkirim!`);
  const seller = world.getPlayers().find(p => p.id === l.sellerId);
  if (seller) {
    playSfx(seller, SFX.OFFER);
    seller.sendMessage(`§e[Auction] Tawaran baru!\n§8  Item  : §f${displayName(l.itemData)}\n§8  Dari  : §f${buyer.name}\n§8  Harga : §b${fmt(amount)} Koin\n§8  Buka Listing Saya untuk merespons.`);
  } else { pushNotif(l.sellerId, `§e[Auction] Tawaran baru §b${fmt(amount)} Koin §edari §f${buyer.name} §euntuk §f${displayName(l.itemData)}§e!`); }
}
