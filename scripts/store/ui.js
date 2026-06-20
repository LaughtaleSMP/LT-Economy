// ============================================================
// store/ui.js — UI menus untuk Store
//
// Design: match Bank/Auction style dengan konsistensi penuh.
// ============================================================

import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG, SFX, readBasis, calcProgressiveCost, getTier } from "./config.js";
import { CATEGORIES, ITEMS_BY_CAT, baseUnitPrice } from "./catalog.js";
import {
  getCoin, addCoin, fmt, playSfx, withLock,
  giveItems, canFitItems, checkPurchaseCd, setPurchaseCd,
} from "./helpers.js";
import { getDaily, getDailyQty, addDailyQty, getStats, addStats, pushAudit, getAuditLog } from "./storage.js";
import { UIClose } from "../ui_close.js";
import { getNudgeLine } from "../nudge.js";
import { trackFlow } from "../eco_flow.js";
import { pointActivity } from "../welfare/demurrage.js";

// ═══════════════════════════════════════════════════════════
// MAIN MENU
// ═══════════════════════════════════════════════════════════

export async function openStoreMenu(player) {
  while (true) {
    const coin = getCoin(player);
    const basis = readBasis();
    const isAdmin = player.hasTag(CFG.ADMIN_TAG);

    // ── Quick stats aggregate ──
    let totalItems = 0;
    let totalBought = 0;
    let atMaxTier = 0;
    for (const cat of CATEGORIES) {
      totalItems += ITEMS_BY_CAT.get(cat.id)?.length ?? 0;
      const b = getDailyQty(player, cat.id);
      totalBought += b;
      if (getTier(b).mult >= CFG.TIERS[CFG.TIERS.length - 1].mult) atMaxTier++;
    }

    // ── Kondisi pasar (dari basis vs default) ──
    let marketMood = "§a⚖ §fStabil";
    if (basis > CFG.DEFAULT_BASIS * 1.3) marketMood = "§c▲ §fInflasi tinggi — harga naik";
    else if (basis > CFG.DEFAULT_BASIS * 1.1) marketMood = "§e▲ §fInflasi ringan";
    else if (basis < CFG.DEFAULT_BASIS * 0.8) marketMood = "§b▼ §fDeflasi — harga turun";

    let body = `${CFG.HR}\n`;
    body += `§6  ✦  T O K O   B U I L D  ✦\n`;
    body += `  §7Bahan resmi untuk event & kreasi\n`;
    body += `${CFG.HR}\n\n`;

    // Market status card
    body += `  §e◈ §fSaldo   §8│ §e${fmt(coin)} §6Koin\n`;
    body += `  §b◈ §fBasis   §8│ §f${fmt(basis)}§7/jam §8(dinamis)\n`;
    body += `  §d◈ §fPasar   §8│ ${marketMood}\n`;
    body += `\n${CFG.HR_THIN}\n\n`;

    // Inventory summary
    body += `  §a▸ §eRingkasan Hari Ini\n`;
    body += `  §8├ §fTotal item  §8── §f${totalItems} §7jenis\n`;
    body += `  §8├ §fSudah beli  §8── §f${fmt(totalBought)}u §7lintas kategori\n`;
    body += `  §8└ §fMax tier    §8── §c${atMaxTier}§8/${CATEGORIES.length} §7kategori\n`;
    body += `\n`;

    // Rules hint
    body += `  §6▸ §eAturan Cepat\n`;
    body += `  §8├ §7Harga naik progresif §8(§atier 1§8→§4tier 5§8)\n`;
    body += `  §8├ §7Reset kuota §f20:00 WIB\n`;
    body += `  §8└ §7Koin §cdibakar§7 (sink ekonomi, anti-inflasi)\n`;
    // [P0 Awareness] Daily nudge — 1×/player/day, hanya tampil kalau ada slot.
    const nudge = getNudgeLine(player);
    if (nudge) body += `\n${nudge}`;
    body += `\n${CFG.HR}`;

    const form = new ActionFormData()
      .title("§8 ♦ §6STORE§r §8♦ §r")
      .body(body);

    const btns = [];
    for (const cat of CATEGORIES) {
      const bought = getDailyQty(player, cat.id);
      const tier = getTier(bought);
      const itemCount = ITEMS_BY_CAT.get(cat.id)?.length ?? 0;
      const quotaPct = Math.round(bought / CFG.MAX_DAILY_QTY * 100);
      // Quota mini bar (5 karakter)
      const qf = Math.round(quotaPct / 100 * 5);
      const miniBar = `${tier.label}${"▰".repeat(qf)}§8${"▰".repeat(5 - qf)}`;

      form.button(
        `${cat.color}${cat.label}\n§r  §8${itemCount} item §8• ${tier.label}×${tier.mult.toFixed(1)} §8• ${miniBar}`,
        cat.icon
      );
      btns.push({ type: "cat", id: cat.id });
    }

    form.button("§bRiwayat Pembelian\n§r  §8Statistik & pembelian hari ini", "textures/items/paper");
    btns.push({ type: "stats" });

    form.button("§ePanduan Harga\n§r  §8Cara kerja tier, basis, dan diskon", "textures/items/book_writable");
    btns.push({ type: "guide" });

    if (isAdmin) {
      form.button("§cAdmin\n§r  §8Log pembelian & kelola store", "textures/items/nether_star");
      btns.push({ type: "admin" });
    }

    form.button("§fTutup", "textures/items/redstone_dust");
    btns.push({ type: "close" });

    playSfx(player, SFX.OPEN);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    const action = btns[res.selection];
    if (!action || action.type === "close") return;

    switch (action.type) {
      case "cat":   await uiCategory(player, action.id); break;
      case "stats": await uiStats(player); break;
      case "guide": await uiGuide(player); break;
      case "admin": await uiAdmin(player); break;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// CATEGORY BROWSER
// ═══════════════════════════════════════════════════════════

async function uiCategory(player, catId) {
  const cat = CATEGORIES.find(c => c.id === catId);
  if (!cat) return;
  const items = ITEMS_BY_CAT.get(catId) || [];

  while (true) {
    const coin = getCoin(player);
    const bought = getDailyQty(player, catId);
    const tier = getTier(bought);
    const basis = readBasis();

    // ── Tier info: current + next + preview all tiers ──
    const nextTierIdx = CFG.TIERS.findIndex(t => t.maxQty > bought);
    const nextTier = nextTierIdx >= 0 ? CFG.TIERS[nextTierIdx] : null;
    const prevCap = nextTierIdx > 0 ? CFG.TIERS[nextTierIdx - 1].maxQty : 0;
    const afterNext = CFG.TIERS[nextTierIdx + 1];

    // ── Progress bar 14 karakter, full-width ──
    const BAR_W = 14;
    let progressBar = "";
    let progressPct = 0;
    let nextLabel = "";
    if (nextTier && nextTier.maxQty !== Infinity) {
      progressPct = Math.min(100, Math.round((bought - prevCap) / (nextTier.maxQty - prevCap) * 100));
      const filled = Math.round(progressPct / 100 * BAR_W);
      progressBar = `${tier.label}${"▰".repeat(filled)}§8${"▱".repeat(BAR_W - filled)}`;
      const nm = afterNext ? afterNext.mult.toFixed(1) : tier.mult.toFixed(1);
      const nl = afterNext ? afterNext.label : tier.label;
      nextLabel = `${nl}×${nm} §8@ §f${nextTier.maxQty}u`;
    } else {
      progressBar = `${tier.label}${"▰".repeat(BAR_W)}`;
      progressPct = 100;
      nextLabel = "§4MAX TIER";
    }

    // ── Price range (cheapest → most expensive item this tier) ──
    let minPrice = Infinity, maxPrice = 0;
    for (const it of items) {
      const up = baseUnitPrice(it, basis);
      const tp = Math.ceil(up * tier.mult);
      if (tp < minPrice) minPrice = tp;
      if (tp > maxPrice) maxPrice = tp;
    }
    if (!Number.isFinite(minPrice)) minPrice = 0;

    // ── Affordability count ──
    let affordCount = 0;
    for (const it of items) {
      const up = baseUnitPrice(it, basis);
      const tp = Math.ceil(up * tier.mult);
      if (coin >= tp) affordCount++;
    }

    // ── Quota indicator ──
    const quotaPct = Math.min(100, Math.round(bought / CFG.MAX_DAILY_QTY * 100));
    const qFilled = Math.round(quotaPct / 100 * 10);
    const qCol = quotaPct >= 85 ? "§c" : quotaPct >= 60 ? "§e" : "§a";
    const quotaBar = `${qCol}${"▰".repeat(qFilled)}§8${"▱".repeat(10 - qFilled)}`;

    // ── Mini tier stages visualization ──
    // Render semua 5 tier sebagai block dengan highlight current
    const tierStages = CFG.TIERS.map((t, i) => {
      const isCurrent = t === tier;
      const marker = isCurrent ? "◆" : "◇";
      return `${t.label}${marker}`;
    }).join("§8─");

    // ── Build body ──
    let body = `${CFG.HR}\n`;
    body += `${cat.color}  ${cat.label.toUpperCase()}\n`;
    body += `  §8${cat.tagline || ""}\n`;
    body += `${CFG.HR}\n\n`;

    // Theme
    if (cat.theme) {
      body += `  §7"${cat.theme}§7"\n`;
      body += `${CFG.HR_THIN}\n\n`;
    }

    // Stats row
    body += `  §e◈ §fSaldo  §8│ §e${fmt(coin)} §6Koin\n`;
    body += `  §b◈ §fBasis  §8│ §f${fmt(basis)}§8/jam  §8│  §bHarga ${cat.color}${fmt(minPrice)}§8-${cat.color}${fmt(maxPrice)}⛃\n`;
    body += `  §a◈ §fMampu  §8│ §a${affordCount}§8/§f${items.length} §7item terjangkau\n`;
    body += `\n`;

    // Tier section
    body += `  ${tier.label}▸ §eTier Aktif §8│ ${tier.label}×${tier.mult.toFixed(1)} §7multiplier\n`;
    body += `  §8  ${tierStages}\n`;
    body += `  §8├ §f${progressBar}§8 §f${progressPct}%%\n`;
    body += `  §8└ §7Next: ${nextLabel}\n`;
    body += `\n`;

    // Quota
    body += `  §6▸ §eKuota Harian §8│ §f${bought}§8/§f${CFG.MAX_DAILY_QTY}u\n`;
    body += `  §8  ${quotaBar} §f${quotaPct}%%\n`;
    body += `  §8  §7Reset §f20:00 WIB §7tiap hari\n`;

    body += `\n${CFG.HR}`;

    const form = new ActionFormData()
      .title(`§8 ♦ ${cat.color}${cat.label}§r §8♦ §r`)
      .body(body);

    const btns = [];
    for (const item of items) {
      const unitPrice = baseUnitPrice(item, basis);
      const tierPrice = Math.ceil(unitPrice * tier.mult);
      const canAfford = coin >= tierPrice;
      const priceCol = canAfford ? tier.label : "§c";
      const nameCol = canAfford ? "§f" : "§8";
      form.button(
        `${nameCol}${item.label}\n§r  ${priceCol}${fmt(tierPrice)}⛃ §8/unit §8• §8${item.qty} blk`,
        item.icon
      );
      btns.push(item);
    }
    form.button("§cKembali", "textures/items/arrow");
    btns.push(null);

    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    const picked = btns[res.selection];
    if (!picked) return;

    await uiBuy(player, picked);
  }
}

// ═══════════════════════════════════════════════════════════
// BUY MODAL — pilih quantity, hitung harga progresif
// ═══════════════════════════════════════════════════════════

async function uiBuy(player, item) {
  const basis = readBasis();
  const unitPrice = baseUnitPrice(item, basis);
  const alreadyBought = getDailyQty(player, item.cat);
  const remainingLimit = Math.max(0, CFG.MAX_DAILY_QTY - alreadyBought);
  const maxBuy = Math.min(CFG.MAX_PER_PURCHASE, remainingLimit);

  if (maxBuy <= 0) {
    await new ActionFormData()
      .title("§8 ♦ §cLIMIT TERCAPAI§r §8♦ §r")
      .body(
        `${CFG.HR}\n` +
        `  §fKamu sudah mencapai limit harian\n` +
        `  §funtuk kategori §e${item.cat}§f.\n\n` +
        `  §8Reset §f20:00 WIB §8setiap hari.\n` +
        `${CFG.HR}`
      )
      .button("§cKembali", "textures/items/arrow")
      .show(player);
    return;
  }

  // Preview 3 sample qty + input manual
  const samples = [1, Math.min(4, maxBuy), Math.min(16, maxBuy)];
  const uniqueSamples = [...new Set(samples.filter(q => q <= maxBuy && q > 0))];

  const coin = getCoin(player);

  let body = `${CFG.HR}\n`;
  body += `§6  ${item.label}\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §fHarga dasar §8│ §e${fmt(unitPrice)}⛃ §8/unit\n`;
  body += `  §fSaldo       §8│ §e${fmt(coin)}⛃\n`;
  body += `  §fSudah beli  §8│ §f${alreadyBought}§8/${CFG.MAX_DAILY_QTY}u\n`;
  body += `\n  §ePreview Harga\n`;
  for (const qty of uniqueSamples) {
    const { totalCost } = calcProgressiveCost(unitPrice, alreadyBought, qty);
    const isi = item.qty * qty;
    const canBuy = coin >= totalCost;
    const c = canBuy ? "§e" : "§c";
    body += `  §8│ §f${qty}x §8→ ${c}${fmt(totalCost)}⛃ §8(${isi}blk)\n`;
  }
  body += `\n${CFG.HR}`;

  const form = new ActionFormData()
    .title("§8 ♦ §6BELI§r §8♦ §r")
    .body(body);

  const btns = [];
  for (const qty of uniqueSamples) {
    const { totalCost } = calcProgressiveCost(unitPrice, alreadyBought, qty);
    const canBuy = coin >= totalCost;
    btns.push(qty);
    form.button(
      `${canBuy ? "§a" : "§8"}Beli ${qty} unit\n§r  ${canBuy ? "§e" : "§c"}${fmt(totalCost)}⛃ §8total`,
      item.icon
    );
  }
  // Input manual
  form.button(`§eInput Jumlah\n§r  §8Masukkan qty manual §8(max §f${maxBuy}§8)`, "textures/items/paper");
  btns.push("custom");
  form.button("§cKembali", "textures/items/arrow");
  btns.push(null);

  const res = await form.show(player);
  if (res.canceled) throw new UIClose();
  const chosen = btns[res.selection];
  if (chosen === null || chosen === undefined) return;

  let qty;
  if (chosen === "custom") {
    const modal = await new ModalFormData()
      .title("§8 ♦ §6INPUT JUMLAH§r §8♦ §r")
      .textField(
        `§fBerapa unit? §8(1-${maxBuy})\n§7Harga berubah sesuai tier.`,
        `contoh: ${Math.min(4, maxBuy)}`,
        { defaultValue: "1" }
      )
      .show(player);
    if (modal.canceled) return;
    qty = Math.floor(Number(String(modal.formValues?.[0] ?? "").trim()));
    if (!Number.isFinite(qty) || qty < 1) {
      player.sendMessage("§8[§cStore§8]§c Jumlah tidak valid.");
      return;
    }
    if (qty > maxBuy) {
      player.sendMessage(`§8[§cStore§8]§c Maks ${maxBuy} unit per transaksi.`);
      return;
    }
  } else {
    qty = chosen;
  }

  await confirmAndBuy(player, item, qty);
}

// ═══════════════════════════════════════════════════════════
// CONFIRM + EXECUTE — atomic transaction
// ═══════════════════════════════════════════════════════════

async function confirmAndBuy(player, item, qty) {
  const basis = readBasis();
  const unitPrice = baseUnitPrice(item, basis);
  const alreadyBought = getDailyQty(player, item.cat);
  const { totalCost, breakdown } = calcProgressiveCost(unitPrice, alreadyBought, qty);
  const totalBlocks = item.qty * qty;

  // Breakdown string
  let brStr = "";
  for (const b of breakdown) {
    brStr += `\n  §8│ §f${b.qty}x ×§6${b.tierMult.toFixed(1)} §8→ §e${fmt(b.cost)}⛃`;
  }

  const body =
    `${CFG.HR}\n` +
    `  §fItem    §8│ §f${item.label}\n` +
    `  §fQty     §8│ §f${qty} unit §8(${totalBlocks} blok)\n` +
    `  §fBreakdown${brStr}\n` +
    `${CFG.HR_THIN}\n` +
    `  §fTotal   §8│ §e${fmt(totalCost)} Koin\n` +
    `  §fSaldo   §8│ §e${fmt(getCoin(player))}⛃ §8→ §e${fmt(getCoin(player) - totalCost)}⛃\n` +
    `${CFG.HR}`;

  const confirm = await new MessageFormData()
    .title("§8 ♦ §6KONFIRMASI§r §8♦ §r")
    .body(body)
    .button1("§c Batal")
    .button2("§a Beli")
    .show(player);

  if (confirm.canceled || confirm.selection !== 1) return;

  // ── RE-CHECK STATE setelah await ──
  // Basis bisa berubah kalau sync.js update, saldo bisa berubah kalau player
  // dapat/transfer koin, limit bisa berubah kalau player belanja dari client lain.
  const freshCoin = getCoin(player);
  const freshBought = getDailyQty(player, item.cat);

  // Re-calc untuk prevent price manipulation via race condition
  const freshBasis = readBasis();
  const freshUnit = baseUnitPrice(item, freshBasis);
  const { totalCost: freshCost } = calcProgressiveCost(freshUnit, freshBought, qty);

  if (freshBought + qty > CFG.MAX_DAILY_QTY) {
    player.sendMessage(`§8[§cStore§8]§c Limit harian terlampaui saat konfirmasi. Sisa: ${CFG.MAX_DAILY_QTY - freshBought}u`);
    playSfx(player, SFX.FAIL);
    return;
  }
  if (freshCoin < freshCost) {
    player.sendMessage(`§8[§cStore§8]§c Saldo tidak cukup. Butuh §e${fmt(freshCost)}⛃§c, punya §e${fmt(freshCoin)}⛃§c.`);
    playSfx(player, SFX.FAIL);
    return;
  }

  // Pre-check inventory space
  if (!canFitItems(player, item.id, totalBlocks)) {
    player.sendMessage(`§8[§cStore§8]§c Inventory penuh! Kosongkan §f${Math.ceil(totalBlocks/64)} slot §cdulu.`);
    playSfx(player, SFX.FAIL);
    return;
  }

  // ── Atomic transaction (lock-protected) ──
  const result = await withLock(player.id, async () => {
    // Purchase cooldown
    if (!checkPurchaseCd(player)) return { ok: false, reason: "cooldown" };

    // Final check inside lock
    const bal = getCoin(player);
    const dq = getDailyQty(player, item.cat);
    const ub = baseUnitPrice(item, readBasis());
    const { totalCost: tc } = calcProgressiveCost(ub, dq, qty);

    if (dq + qty > CFG.MAX_DAILY_QTY) return { ok: false, reason: "limit" };
    if (bal < tc) return { ok: false, reason: "coin" };

    // [§2] Deduct coin FIRST. If scoreboard write fails, abort — don't give items.
    if (!addCoin(player, -tc)) {
      console.error(`[Store] purchase aborted: setCoin failed ${player.name} -${tc}`);
      return { ok: false, reason: "internal" };
    }

    // Try give items
    const given = giveItems(player, item.id, totalBlocks);
    if (given < totalBlocks) {
      // Partial give — refund proportional + return items given
      const refund = tc - Math.ceil(tc * given / totalBlocks);
      // [§2] Refund failure is rare but log — coin already deducted, so we owe player.
      if (!addCoin(player, refund)) {
        console.error(`[Store] partial-refund failed: ${player.name} owed ${refund} coin`);
      }
      // Counter hanya ditambah sesuai yang benar-benar diterima (fair)
      const effectiveUnits = Math.floor(given / item.qty);
      if (effectiveUnits > 0) {
        addDailyQty(player, item.cat, effectiveUnits);
        addStats(player, tc - refund, given);
        trackFlow("store_sink", -(tc - refund));
        try { pointActivity(player); } catch {}
      }
      return { ok: false, reason: "inv_partial", given, refund, charged: tc - refund };
    }

    // Full success
    addDailyQty(player, item.cat, qty);
    addStats(player, tc, totalBlocks);
    setPurchaseCd(player);
    trackFlow("store_sink", -tc);
    try { pointActivity(player); } catch {}
    pushAudit({
      player: player.name,
      itemId: item.id,
      label: item.label,
      qty, blocks: totalBlocks, cost: tc,
      ts: Date.now(),
    });

    return { ok: true, charged: tc, blocks: totalBlocks };
  });

  if (result === false) {
    player.sendMessage("§8[§cStore§8]§c Transaksi sedang diproses, coba lagi sebentar.");
    return;
  }
  if (!result.ok) {
    if (result.reason === "cooldown") player.sendMessage("§8[§cStore§8]§c Terlalu cepat, tunggu sebentar.");
    else if (result.reason === "limit") player.sendMessage("§8[§cStore§8]§c Limit harian terlampaui.");
    else if (result.reason === "coin") player.sendMessage("§8[§cStore§8]§c Saldo tidak cukup.");
    else if (result.reason === "internal") player.sendMessage("§8[§cStore§8]§c Pembelian gagal, coba lagi sebentar.");
    else if (result.reason === "inv_partial") {
      player.sendMessage(
        `§8[§eStore§8]§e Hanya §f${result.given}§e blok yang muat di inventory. ` +
        `Refund §e${fmt(result.refund)}⛃§e. Dibayar §f${fmt(result.charged)}⛃§e.`
      );
    }
    playSfx(player, SFX.FAIL);
    return;
  }

  playSfx(player, SFX.SUCCESS);
  // Notif tier-up kalau melewati tier
  const newBought = getDailyQty(player, item.cat);
  const tier = getTier(newBought - qty);
  const newTier = getTier(newBought);
  if (tier.mult !== newTier.mult) {
    playSfx(player, SFX.TIERUP);
    player.sendMessage(`§8[§6Store§8]§6 Tier naik ke ×${newTier.mult.toFixed(1)} — pembelian berikutnya akan lebih mahal.`);
  }

  player.sendMessage(
    `§8[§aStore§8]§a Berhasil membeli §f${qty}x ${item.label}§a!\n` +
    `§7 Total   : §e${fmt(result.charged)} Koin\n` +
    `§7 Blok    : §f${result.blocks} blk\n` +
    `§7 Saldo   : §e${fmt(getCoin(player))}⛃`
  );
}

// ═══════════════════════════════════════════════════════════
// STATS PAGE
// ═══════════════════════════════════════════════════════════

async function uiStats(player) {
  const stats = getStats(player);
  const daily = getDaily(player);

  let body = `${CFG.HR}\n`;
  body += `§b  ★ STATISTIKMU\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §eLIFETIME\n`;
  body += `  §8│ §fKoin dikeluarkan §8── §e${fmt(stats.totalSpent || 0)}⛃\n`;
  body += `  §8│ §fTotal blok dibeli §8── §f${fmt(stats.totalItems || 0)}\n`;
  if (stats.firstBuy) {
    const days = Math.floor((Date.now() - stats.firstBuy) / 86_400_000);
    body += `  §8└ §fPelanggan §8── §a${days} hari\n`;
  }

  body += `\n  §eHARI INI\n`;
  let anyToday = false;
  for (const cat of CATEGORIES) {
    const qty = daily.qty[cat.id] || 0;
    if (qty > 0) {
      const tier = getTier(qty);
      body += `  §8│ ${cat.color}${cat.label}§8 ── §f${qty}u ${tier.label}×${tier.mult.toFixed(1)}\n`;
      anyToday = true;
    }
  }
  if (!anyToday) body += `  §8└ §7Belum ada pembelian hari ini\n`;

  body += `\n  §8Reset limit §f20:00 WIB\n`;
  body += `${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §bSTATS§r §8♦ §r")
    .body(body)
    .button("§cKembali", "textures/items/arrow")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// PRICING GUIDE
// ═══════════════════════════════════════════════════════════

async function uiGuide(player) {
  const basis = readBasis();

  let body = `${CFG.HR}\n`;
  body += `§e  ★ CARA KERJA HARGA\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §6Harga Dinamis\n`;
  body += `  §8│ Harga ikut §ebasis server §8(${fmt(basis)}/jam)\n`;
  body += `  §8│ Inflasi naik §8→ harga naik otomatis\n`;
  body += `  §8└ Deflasi turun §8→ harga turun\n\n`;

  body += `  §6Tier Pembelian Progresif\n`;
  body += `  §8│ Per kategori, per hari:\n`;
  for (let i = 0; i < CFG.TIERS.length; i++) {
    const t = CFG.TIERS[i];
    const prev = i > 0 ? CFG.TIERS[i - 1].maxQty : 0;
    const range = t.maxQty === Infinity ? `${prev + 1}+` : `${prev + 1}-${t.maxQty}`;
    body += `  §8│ ${t.label}${range}u §8× ${t.label}${t.mult.toFixed(1)}\n`;
  }
  body += `  §8└ Reset §f20:00 WIB §8tiap hari\n\n`;

  body += `  §6Filosofi\n`;
  body += `  §8│ Beli secukupnya §8→ §amurah\n`;
  body += `  §8│ Borong banyak §8→ §cmahal§8 (anti-monopoli)\n`;
  body += `  §8└ Semua koin §cdibakar§8 (sink untuk ekonomi)\n\n`;

  body += `  §6Contoh §8(kategori §ewool§8, basis ${fmt(basis)})\n`;
  body += `  §8│ Beli §f1-5§8 wool putih §8→ ~§e${fmt(Math.ceil(0.55 * basis))}⛃/unit\n`;
  body += `  §8│ Beli §f6-20§8 wool putih §8→ ~§e${fmt(Math.ceil(0.55 * basis * 1.6))}⛃/unit\n`;
  body += `  §8└ Beli §f100+§8 wool putih §8→ ~§c${fmt(Math.ceil(0.55 * basis * 7.0))}⛃/unit\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §ePANDUAN HARGA§r §8♦ §r")
    .body(body)
    .button("§cKembali", "textures/items/arrow")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════

async function uiAdmin(player) {
  if (!player.hasTag(CFG.ADMIN_TAG)) {
    player.sendMessage("§8[§cStore§8]§c Akses ditolak.");
    return;
  }

  const log = getAuditLog();
  const basis = readBasis();

  // Aggregate stats dari audit log
  let totalRev = 0;
  const byItem = new Map();
  for (const e of log) {
    totalRev += e.cost || 0;
    const prev = byItem.get(e.label) || { qty: 0, cost: 0 };
    prev.qty += e.qty || 0;
    prev.cost += e.cost || 0;
    byItem.set(e.label, prev);
  }

  let body = `${CFG.HR}\n`;
  body += `§c  ★ STORE ADMIN\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §fBasis saat ini §8│ §e${fmt(basis)}⛃/jam\n`;
  body += `  §fTotal sink (${log.length} tx) §8│ §6${fmt(totalRev)}⛃\n`;
  body += `\n  §eTOP ITEM (dari log)\n`;

  const top = [...byItem.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
  if (top.length === 0) body += `  §8└ §7Belum ada data\n`;
  else {
    for (const [label, s] of top) {
      body += `  §8│ §f${label}§8 ── §f${s.qty}u §8│ §e${fmt(s.cost)}⛃\n`;
    }
  }

  body += `\n  §eLOG TERAKHIR (${log.length})\n`;
  const recent = log.slice(0, 5);
  if (recent.length === 0) body += `  §8└ §7Belum ada transaksi\n`;
  else {
    for (const e of recent) {
      const ago = Math.floor((Date.now() - (e.ts || 0)) / 60_000);
      body += `  §8│ §f${e.player}§8 beli §f${e.qty}u ${e.label}§8 §e${fmt(e.cost)}⛃ §8${ago}m\n`;
    }
  }
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §cSTORE ADMIN§r §8♦ §r")
    .body(body)
    .button("§cKembali", "textures/items/arrow")
    .show(player);
}
