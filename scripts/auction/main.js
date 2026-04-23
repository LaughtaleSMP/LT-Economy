// auction/main.js — Entry point: menu utama, events, commands, about
// Premium UI Design v2.0 — Matching Daily System Style

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { CFG, SFX } from "./config.js";
import {
  getActiveListings, pruneExpired, flushNotifs,
  getPendingItems, savePendingItems, pushHistory,
  pushNotif, addPendingItem, addPendingCoin, claimPendingCoin, getFee,
  recoverTx, calcFee,
} from "./utils/storage.js";
import { displayName, giveItem } from "./utils/items.js";
import {
  getCoin, addCoin, fmt, playSfx,
  activeSessions, checkCooldown, setCooldown, onPlayerLeave,
} from "./utils/helpers.js";
import { uiBrowse } from "./ui/browse.js";
import { uiSell, uiMyListings } from "./ui/sell.js";
import { uiAdmin } from "./ui/admin.js";

// ═══════════════════════════════════════════════════════════
// OPEN AUCTION
// ═══════════════════════════════════════════════════════════
async function openAuction(player) {
  if (activeSessions.has(player.id)) return;
  activeSessions.add(player.id);
  setCooldown(player);
  try { await _menuLoop(player); }
  finally { activeSessions.delete(player.id); }
}

async function _menuLoop(player) {
  claimPending(player);

  while (true) {
    const coin    = getCoin(player);
    const active  = getActiveListings();
    const myCount = active.filter(l => l.sellerId === player.id).length;
    const myOffers = active.filter(l => l.sellerId === player.id && l.offerId).length;
    const myBids = active.filter(l => l.mode === "auction" && l.sellerId === player.id && l.bidCount > 0).length;
    const isAdmin = player.hasTag(CFG.ADMIN_TAG);

    let body = `${CFG.HR}\n`;
    body += `§6§l  A U C T I O N   H O U S E\n`;
    body += `${CFG.HR}\n${CFG.SP}\n`;
    body += `  §6⛃ §eSaldo\n`;
    body += `  §8└ §e${fmt(coin)} Koin\n`;
    body += `${CFG.SP}\n`;
    body += `  §b◆ §eListing Aktif\n`;
    body += `  §8├ §f${active.length} §8total\n`;
    body += `  §8└ §b${myCount} §8milikmu\n`;
    body += `${CFG.SP}\n`;
    body += `  §e✦ §eFee Listing\n`;
    body += `  §8└ §f${getFee()}%\n`;
    body += `${CFG.SP}\n${CFG.HR}`;

    const btns = [];
    const form = new ActionFormData()
      .title("§l§8 ♦ §6AUCTION§r§l §8♦ §r")
      .body(body);

    form.button(`§e§l  ◆ Semua Listing\n§r  §eBrowse per kategori`);
    btns.push("browse");

    form.button(`§a§l  ✦ Jual Item\n§r  §ePasang dari inventory`);
    btns.push("sell");

    const badge = (myOffers + myBids) > 0 ? ` §c(${myOffers + myBids})` : "";
    form.button(`§b§l  ◆ Listing Saya${badge}\n§r  §eKelola listing & tawaran`);
    btns.push("my");

    form.button(`§e§l  ◆ About\n§r  §8Panduan & aturan`);
    btns.push("about");

    if (isAdmin) {
      form.button(`§c§l  ★ Admin\n§r  §eKelola auction`);
      btns.push("admin");
    }

    form.button("§6§l  ◀ Tutup");
    btns.push("close");

    playSfx(player, SFX.OPEN);
    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "close") return;

    switch (btns[res.selection]) {
      case "browse": await uiBrowse(player);     break;
      case "sell":   await uiSell(player);       break;
      case "my":     await uiMyListings(player); break;
      case "about":  await uiAbout(player);      break;
      case "admin":  await uiAdmin(player);      break;
    }
  }
}

function claimPending(player) {
  const pending = getPendingItems(player.id);
  if (pending.length > 0) {
    let claimed = 0;
    const remain = [];
    for (const itemData of pending) {
      if (giveItem(player, itemData)) claimed++;
      else remain.push(itemData);
    }
    savePendingItems(player.id, remain);
    if (claimed > 0) player.sendMessage(`§a[Auction] ${claimed} item pending diklaim!`);
  }
  const pendCoin = claimPendingCoin(player, addCoin);
  if (pendCoin > 0) {
    player.sendMessage(`§a[Auction] §e${fmt(pendCoin)} Koin §adari penjualan diterima!`);
  }
}

// ═══════════════════════════════════════════════════════════
// ABOUT — Multi-page guide
// ═══════════════════════════════════════════════════════════
async function uiAbout(player) {
  while (true) {
    let body = `${CFG.HR}\n`;
    body += `§6§l  A U C T I O N   H O U S E\n`;
    body += `${CFG.HR}\n\n`;
    body += `  §fJual beli item antar player\n`;
    body += `  §fdengan aman & terstruktur.\n\n`;
    body += `  §8Pilih topik di bawah.\n`;
    body += `\n${CFG.HR}`;

    const form = new ActionFormData()
      .title("§l§8 ♦ §eABOUT§r§l §8♦ §r").body(body);
    const btns = [];

    form.button(`§e§l  ⛃ Mode Buyout\n§r  §8Harga tetap, beli langsung`); btns.push("buyout");
    form.button(`§b§l  ⚡ Mode Auction\n§r  §8Lelang naik, bid war`); btns.push("auction");
    form.button(`§e§l  ◆ Fee & Aturan\n§r  §8Biaya, limit, durasi`); btns.push("rules");
    form.button(`§e§l  ◆ Cara Pakai\n§r  §8Langkah-langkah`); btns.push("howto");
    form.button("§6§l  ◀ Kembali"); btns.push("back");

    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "back") return;

    switch (btns[res.selection]) {
      case "buyout":  await aboutBuyout(player); break;
      case "auction": await aboutAuction(player); break;
      case "rules":   await aboutRules(player); break;
      case "howto":   await aboutHowTo(player); break;
    }
  }
}

async function aboutBuyout(player) {
  let body = `${CFG.HR}\n`;
  body += `§e§l  ⛃ MODE BUYOUT\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §fMode standar jual beli.\n`;
  body += `  §fSeller pasang harga tetap,\n`;
  body += `  §fbuyer beli langsung.\n\n`;
  body += `  §e§lCARA KERJA\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §f1. §eSeller pasang item + harga\n`;
  body += `  §f2. §eBuyer bisa §aBeli Langsung\n`;
  body += `  §f3. §eAtau §bAjukan Tawaran §8(nego)\n`;
  body += `  §f4. §eSeller terima/tolak tawaran\n\n`;
  body += `  §e§lTAWARAN (OFFER)\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fTawar harga §cdi bawah §fharga listing\n`;
  body += `  §8├ §fKoin ditahan sampai direspons\n`;
  body += `  §8├ §fSeller bisa terima atau tolak\n`;
  body += `  §8└ §fJika ditolak, koin dikembalikan\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData().title("§l§8 ♦ §e BUYOUT §r§l §8♦ §r")
    .body(body).button("§6§l  ◀ Kembali").show(player);
}

async function aboutAuction(player) {
  const minInc = CFG.MIN_BID_INCREMENT;
  const pctInc = CFG.BID_INCREMENT_PCT;
  const snipeMin = Math.floor(CFG.ANTI_SNIPE_THRESHOLD_MS / 60000);

  let body = `${CFG.HR}\n`;
  body += `§b§l  ⚡ MODE AUCTION\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §fMode lelang naik §8(bid war)§f.\n`;
  body += `  §fPlayer saling bid, harga naik.\n`;
  body += `  §fPemenang = bid tertinggi saat\n`;
  body += `  §fwaktu habis.\n\n`;
  body += `  §e§lCARA KERJA\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §f1. §eSeller pasang item + starting bid\n`;
  body += `  §f2. §eBuyout price §8(opsional)\n`;
  body += `  §f3. §eBuyer pasang bid §8(naik terus)\n`;
  body += `  §f4. §eWaktu habis = pemenang otomatis\n\n`;
  body += `  §e§lATURAN BID\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fBid pertama §8≥ §estarting bid\n`;
  body += `  §8├ §fBid berikutnya §8≥ §ecurrent + increment\n`;
  body += `  §8├ §fIncrement: §e${pctInc}% §8atau §e${fmt(minInc)}⛃\n`;
  body += `  §8│ §8(mana yang lebih besar)\n`;
  body += `  §8└ §fKoin ditahan §8(escrow)\n\n`;
  body += `  §e§lOUTBID & REFUND\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fJika di-outbid, koin §aotomatis\n`;
  body += `  §8│ §adikembalikan §8langsung\n`;
  body += `  §8└ §fJika offline, masuk §epending\n\n`;
  body += `  §e§lANTI-SNIPE\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fJika ada bid di §c${snipeMin} menit\n`;
  body += `  §8│ §fterakhir, waktu §edi-extend\n`;
  body += `  §8│ §e${snipeMin} menit §8lagi\n`;
  body += `  §8└ §fMencegah snipe di detik akhir\n\n`;
  body += `  §e§lBUYOUT\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fJika seller set buyout price,\n`;
  body += `  §8│ §fbuyer bisa §abeli langsung\n`;
  body += `  §8├ §fSemua bidder §aotomatis di-refund\n`;
  body += `  §8└ §fBuyout = opsional\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData().title("§l§8 ♦ §b AUCTION §r§l §8♦ §r")
    .body(body).button("§6§l  ◀ Kembali").show(player);
}

async function aboutRules(player) {
  const feePct = getFee();
  const exFee = calcFee(1000);

  let body = `${CFG.HR}\n`;
  body += `§e§l  ◆ FEE & ATURAN\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §e§lFEE LISTING\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fFee: §e${feePct}% §8dari harga\n`;
  body += `  §8├ §fDipotong dari saldo saat pasang\n`;
  body += `  §8├ §c✖ §fTidak dikembalikan jika batal\n`;
  body += `  §8└ §fContoh: 1.000⛃ → fee §c${fmt(exFee)}⛃\n\n`;
  body += `  §e§lLIMIT\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fMax listing per player: §e${CFG.MAX_LISTINGS}\n`;
  body += `  §8├ §fMax listing global: §e${CFG.MAX_GLOBAL}\n`;
  body += `  §8├ §fHarga min: §e${fmt(CFG.MIN_PRICE)}⛃\n`;
  body += `  §8└ §fHarga maks: §e${fmt(CFG.MAX_BUYOUT)}⛃\n\n`;
  body += `  §e§lDURASI\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fSemua listing: §e24 jam\n`;
  body += `  §8├ §fExpired = item dikembalikan\n`;
  body += `  §8└ §fAuction expired = §apemenang otomatis\n\n`;
  body += `  §e§lKEAMANAN\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fCrash protection §8(TX journal)\n`;
  body += `  §8├ §fPending system §8(offline claim)\n`;
  body += `  §8└ §fLock system §8(anti-duplikat)\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData().title("§l§8 ♦ §e ATURAN §r§l §8♦ §r")
    .body(body).button("§6§l  ◀ Kembali").show(player);
}

async function aboutHowTo(player) {
  let body = `${CFG.HR}\n`;
  body += `§e§l  ◆ CARA PAKAI\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §e§lJUAL ITEM\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §f1. §eBuka menu §8(!auction)\n`;
  body += `  §f2. §eTekan §a✦ Jual Item\n`;
  body += `  §f3. §ePilih item dari inventory\n`;
  body += `  §f4. §ePilih jumlah §8(jika stackable)\n`;
  body += `  §f5. §ePilih mode: §e⛃ Buyout §8atau §b⚡ Auction\n`;
  body += `  §f6. §eSet harga/bid → konfirmasi\n\n`;
  body += `  §e§lBELI ITEM\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §f1. §eBuka menu → §e◆ Semua Listing\n`;
  body += `  §f2. §ePilih kategori & item\n`;
  body += `  §f3. §eBuyout: §aBeli Langsung\n`;
  body += `  §f4. §eBuyout: §bAjukan Tawaran §8(nego turun)\n`;
  body += `  §f5. §eAuction: §b⚡ Pasang Bid §8(naik)\n`;
  body += `  §f6. §eAuction: §aBuyout §8(jika tersedia)\n\n`;
  body += `  §e§lKELOLA LISTING\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fBuka §b◆ Listing Saya\n`;
  body += `  §8├ §fTerima/tolak tawaran §8(buyout)\n`;
  body += `  §8├ §fLihat bid masuk §8(auction)\n`;
  body += `  §8└ §fBatalkan listing kapan saja\n\n`;
  body += `  §e§lBUKA MENU\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8├ §fKetik §e!auction §8di chat\n`;
  body += `  §8└ §fAtau command §e/lt:auction\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData().title("§l§8 ♦ §e GUIDE §r§l §8♦ §r")
    .body(body).button("§6§l  ◀ Kembali").show(player);
}

// ═══════════════════════════════════════════════════════════
// PRUNE INTERVAL
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  try {
    const { expired, settled } = pruneExpired();

    // Handle regular expired listings
    for (const l of expired) {
      // Refund buyout offer bidder
      if (l.offerId && l.offerAmount > 0) {
        const bidder = world.getPlayers().find(p => p.id === l.offerId);
        if (bidder) { addCoin(bidder, l.offerAmount); bidder.sendMessage(`§e[Auction] Listing expired. §f${fmt(l.offerAmount)} Koin §edikembalikan.`); }
        else {
          pushNotif(l.offerId, `§e[Auction] Listing expired. §f${fmt(l.offerAmount)} Koin §edikembalikan.`);
          addPendingCoin(l.offerId, l.offerAmount);
        }
      }

      // Return item to seller
      const seller = world.getPlayers().find(p => p.id === l.sellerId);
      if (seller) {
        const gave = giveItem(seller, l.itemData);
        if (!gave) addPendingItem(seller.id, l.itemData);
        seller.sendMessage(`§e[Auction] Listing §f${displayName(l.itemData)} §eexpired. Item dikembalikan.${!gave ? "\n§c⚠ Inventory penuh, item masuk pending." : ""}`);
      } else {
        addPendingItem(l.sellerId, l.itemData);
        pushNotif(l.sellerId, `§e[Auction] Listing §f${displayName(l.itemData)} §eexpired. Item dikembalikan (pending).`);
      }

      pushHistory({ type: "expired", item: displayName(l.itemData), seller: l.sellerName });
    }

    // Handle auction settlements (winner determined)
    for (const l of settled) {
      const itemName = displayName(l.itemData);

      // Give item to winner
      const winner = world.getPlayers().find(p => p.id === l.bidderId);
      if (winner) {
        const gave = giveItem(winner, l.itemData);
        if (!gave) addPendingItem(winner.id, l.itemData);
        playSfx(winner, SFX.BUY);
        winner.sendMessage(`§a[Auction] Kamu memenangkan lelang §f${itemName}§a!\n§8  Harga: §e${fmt(l.currentBid)} Koin${!gave ? "\n§c⚠ Inventory penuh, item masuk pending." : ""}`);
      } else {
        addPendingItem(l.bidderId, l.itemData);
        pushNotif(l.bidderId, `§a[Auction] Kamu memenangkan lelang §f${itemName} §aseharga §e${fmt(l.currentBid)} Koin§a!`);
      }

      // Give koin to seller
      const seller = world.getPlayers().find(p => p.id === l.sellerId);
      if (seller) {
        addCoin(seller, l.currentBid);
        playSfx(seller, SFX.SOLD);
        seller.sendMessage(`§a[Auction] Lelang §f${itemName} §aselesai!\n§8  Pemenang: §f${l.bidderName}\n§8  Harga  : §e${fmt(l.currentBid)} Koin`);
      } else {
        addPendingCoin(l.sellerId, l.currentBid);
        pushNotif(l.sellerId, `§a[Auction] Lelang §f${itemName} §aselesai! Pemenang: §f${l.bidderName}§a, harga: §e${fmt(l.currentBid)} Koin§a.`);
      }

      pushHistory({ type: "auction_won", item: itemName, seller: l.sellerName, buyer: l.bidderName, price: l.currentBid });

      // Broadcast
      if (l.currentBid >= CFG.BROADCAST_MIN_PRICE) {
        const enchBadge = l.itemData.enchantments?.length > 0 ? " §d✦" : "";
        world.sendMessage(`\n§b§l[Auction]§r §e${l.bidderName} §fmemenangkan lelang §e${itemName}${enchBadge} §fdari §e${l.sellerName} §fseharga §e${fmt(l.currentBid)} Koin§f!\n`);
      }
    }
  } catch (e) { console.error("[Auction] prune error:", e); }
}, CFG.PRUNE_INTERVAL);

// ═══════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════
system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name:            "lt:auction",
        description:     "Buka Auction House",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!checkCooldown(player)) {
          system.run(() => player.sendMessage("§c[Auction] Tunggu sebentar!"));
          return;
        }
        if (activeSessions.has(player.id)) return;
        system.run(() => openAuction(player).catch(e => console.error("[Auction] error:", e)));
        return { status: 0 };
      }
    );
    console.log("[Auction] /lt:auction registered.");
  } catch (e) { console.warn("[Auction] Command registration failed:", e); }
});

// ═══════════════════════════════════════════════════════════
// CHAT TRIGGER
// ═══════════════════════════════════════════════════════════
world.beforeEvents.chatSend.subscribe(event => {
  const msg = event.message.trim().toLowerCase();
  if (msg !== "!auction" && msg !== "auction") return;
  event.cancel = true;
  const player = event.sender;
  if (!checkCooldown(player)) {
    system.run(() => player.sendMessage("§c[Auction] Tunggu sebentar!"));
    return;
  }
  if (activeSessions.has(player.id)) return;
  system.run(() => openAuction(player).catch(e => console.error("[Auction] error:", e)));
});

// ═══════════════════════════════════════════════════════════
// SCRIPT EVENT
// ═══════════════════════════════════════════════════════════
system.afterEvents.scriptEventReceive.subscribe(ev => {
  if (ev.id !== "auction:open") return;
  const src = ev.sourceEntity;
  if (!src || typeof src.hasTag !== "function") return;
  if (activeSessions.has(src.id)) return;
  system.run(() => openAuction(src).catch(e => console.error("[Auction] error:", e)));
});

// ═══════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      const live = world.getPlayers().find(p => p.id === player.id);
      if (!live) return;
      const recoveryMsgs = recoverTx(live.id);
      for (const msg of recoveryMsgs) live.sendMessage(msg);
      flushNotifs(live);
      claimPending(live);
    } catch (e) { console.error("[Auction] spawn handler:", e); }
  }, 120);
});

world.afterEvents.playerLeave.subscribe(ev => {
  onPlayerLeave(ev.playerId);
});
