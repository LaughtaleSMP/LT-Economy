// ============================================================
// Bank/main.js — Sistem Bank Koin Advanced
// Trigger: ketik /bank atau !bank di chat
// Fallback: /scriptevent bank:open
// ============================================================

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG } from "./config.js";

// ═══════════════════════════════════════════════════════════
// STORAGE HELPERS
// ═══════════════════════════════════════════════════════════

const dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try {
      const str = JSON.stringify(v);
      if (str.length > 30_000)
        console.warn(`[Bank] dp.set WARNING: "${k}" ukuran ${str.length} chars!`);
      world.setDynamicProperty(k, str);
    } catch (e) { console.error("[Bank] dp.set gagal:", k, e); }
  },
  del: (k) => { try { world.setDynamicProperty(k, undefined); } catch {} },
};

// ═══════════════════════════════════════════════════════════
// COIN HELPERS — Wraps scoreboard "coin"
// ═══════════════════════════════════════════════════════════

function ensureCoinObj() {
  return world.scoreboard.getObjective(CFG.COIN_OBJ)
    ?? world.scoreboard.addObjective(CFG.COIN_OBJ, "Koin");
}

function getCoin(player) {
  try {
    return ensureCoinObj()?.getScore(player.scoreboardIdentity ?? player) ?? 0;
  } catch { return 0; }
}

function setCoin(player, n) {
  try {
    ensureCoinObj()?.setScore(
      player.scoreboardIdentity ?? player,
      Math.max(0, Math.floor(n))
    );
  } catch (e) { console.error("[Bank] setCoin error:", e); }
}

const addCoin    = (player, n) => setCoin(player, getCoin(player) + n);
const deductCoin = (player, n) => {
  const cur = getCoin(player);
  if (cur < n) return false;
  setCoin(player, cur - n);
  return true;
};

// ═══════════════════════════════════════════════════════════
// DAILY LIMIT
// ═══════════════════════════════════════════════════════════

const todayStr = () => new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

function getDailyUsed(playerId) {
  const d = dp.get(CFG.K_DAILY + playerId, { total: 0, date: "" });
  return d.date === todayStr() ? d.total : 0;
}

function addDailyUsed(playerId, amount) {
  const today = todayStr();
  const d     = dp.get(CFG.K_DAILY + playerId, { total: 0, date: today });
  if (d.date !== today) d.total = 0;
  d.date   = today;
  d.total += amount;
  dp.set(CFG.K_DAILY + playerId, d);
}

// ═══════════════════════════════════════════════════════════
// TRANSACTION HISTORY
// ═══════════════════════════════════════════════════════════

// type: "sent" | "received" | "req_accepted_out" | "req_accepted_in"
function pushHistory(playerId, entry) {
  const hist = dp.get(CFG.K_HIST + playerId, []);
  hist.unshift({ ...entry, ts: Date.now() });
  dp.set(CFG.K_HIST + playerId, hist.slice(0, CFG.MAX_HISTORY));
}

const getHistory = (playerId) => dp.get(CFG.K_HIST + playerId, []);

// ═══════════════════════════════════════════════════════════
// REQUEST SYSTEM
// ═══════════════════════════════════════════════════════════

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function getIncomingReqs(playerId) {
  const reqs  = dp.get(CFG.K_REQ_IN + playerId, []);
  const now   = Date.now();
  const valid = reqs.filter(r => (now - r.createdAt) < CFG.REQUEST_EXPIRE_MS);
  if (valid.length !== reqs.length) dp.set(CFG.K_REQ_IN + playerId, valid); // auto-prune
  return valid;
}

function addIncomingReq(toId, req) {
  const reqs = getIncomingReqs(toId);
  if (reqs.length >= CFG.MAX_PENDING_REQ) return false;
  reqs.push(req);
  dp.set(CFG.K_REQ_IN + toId, reqs);
  return true;
}

function removeReq(playerId, reqId) {
  const reqs = getIncomingReqs(playerId).filter(r => r.id !== reqId);
  dp.set(CFG.K_REQ_IN + playerId, reqs);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

const getSettings  = ()  => dp.get(CFG.K_SETTINGS, { taxPct: CFG.TAX_PERCENT });
const saveSettings = (s) => dp.set(CFG.K_SETTINGS, s);
const getTax       = ()  => getSettings().taxPct;
const calcTax      = (amount) => Math.ceil(amount * getTax() / 100);

// ═══════════════════════════════════════════════════════════
// STATE — cooldown & active sessions
// ═══════════════════════════════════════════════════════════

const bankCooldown   = new Map(); // playerId → lastTick
const activeSessions = new Set(); // playerIds yang sedang di UI bank

function checkCooldown(player) {
  const last = bankCooldown.get(player.id) ?? -(CFG.COOLDOWN_TICKS + 1);
  return (system.currentTick - last) >= CFG.COOLDOWN_TICKS;
}
const setCooldown = (player) => bankCooldown.set(player.id, system.currentTick);

// ═══════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════

const fmt = (n) => Math.floor(n).toLocaleString("id-ID");

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)              return `${s}dtk lalu`;
  if (s < 3600)            return `${Math.floor(s / 60)}mnt lalu`;
  if (s < 86400)           return `${Math.floor(s / 3600)}jam lalu`;
  return `${Math.floor(s / 86400)}hr lalu`;
}

function minsLeft(req) {
  return Math.max(0, Math.floor(
    (CFG.REQUEST_EXPIRE_MS - (Date.now() - req.createdAt)) / 60_000
  ));
}

// ═══════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════

function getCoinLeaderboard(limit = 10) {
  try {
    const obj = world.scoreboard.getObjective(CFG.COIN_OBJ);
    if (!obj) return [];
    const onlineNames = new Set(world.getPlayers().map(p => p.name));
    const entries = [];
    for (const ident of obj.getParticipants()) {
      try {
        const score = obj.getScore(ident) ?? 0;
        if (score <= 0) continue;
        entries.push({ name: ident.displayName, coin: score, isOnline: onlineNames.has(ident.displayName) });
      } catch {}
    }
    return entries.sort((a, b) => b.coin - a.coin).slice(0, limit);
  } catch (e) { console.warn("[Bank] leaderboard error:", e); return []; }
}

// ═══════════════════════════════════════════════════════════
// EXECUTE TRANSFER (core logic)
// ═══════════════════════════════════════════════════════════

function executeTransfer(from, to, amount, note = "") {
  const tax       = calcTax(amount);
  const totalOut  = amount + tax;
  const dailyUsed = getDailyUsed(from.id);

  if (dailyUsed + totalOut > CFG.DAILY_LIMIT) return { ok: false, err: "daily_limit" };
  if (!deductCoin(from, totalOut))            return { ok: false, err: "insufficient" };

  addCoin(to, amount);
  addDailyUsed(from.id, totalOut);

  const ts = Date.now();
  pushHistory(from.id, { type: "sent",     to:   to.name,   amount, tax, note, ts });
  pushHistory(to.id,   { type: "received", from: from.name, amount,       note, ts });

  return { ok: true, amount, tax, totalOut };
}

// ═══════════════════════════════════════════════════════════
// UI: ENTRY POINT — openBankMenu
// ═══════════════════════════════════════════════════════════

async function openBankMenu(player) {
  if (activeSessions.has(player.id)) return;
  activeSessions.add(player.id);
  setCooldown(player);
  try { await _menuLoop(player); }
  finally { activeSessions.delete(player.id); }
}

async function _menuLoop(player) {
  while (true) {
    const coin     = getCoin(player);
    const reqs     = getIncomingReqs(player.id);
    const daily    = getDailyUsed(player.id);
    const tax      = getTax();
    const isAdmin  = player.hasTag(CFG.ADMIN_TAG);
    const reqBadge = reqs.length ? ` §c(${reqs.length})` : "";
    const dailyPct = Math.min(100, Math.round(daily / CFG.DAILY_LIMIT * 100));

    const body =
      `${CFG.HR}\n` +
      `§e★ Saldo   : §f${fmt(coin)} Koin\n` +
      `§7Pajak Transfer: §f${tax}%\n` +
      `§7Limit Harian  : §f${fmt(daily)} §7/ §f${fmt(CFG.DAILY_LIMIT)} §7(§e${dailyPct}%§7)\n` +
      `${CFG.HR}`;

    const btns = [];
    const form = new ActionFormData()
      .title("§l§6  🏦 BANK KOIN  §r")
      .body(body);

    form.button(`§l Transfer Koin\n§r§7Kirim koin ke player lain`);        btns.push("transfer");
    form.button(`§l Minta Koin\n§r§7Request koin dari player`);             btns.push("request");
    form.button(`§l Permintaan Masuk${reqBadge}\n§r§7${reqs.length > 0 ? `${reqs.length} menunggu respons` : "Tidak ada permintaan"}`); btns.push("inbox");
    form.button(`§l Riwayat Transaksi\n§r§7Lihat history transfer`);       btns.push("history");
    form.button(`§l Top Koin\n§r§7Leaderboard saldo terbesar`);            btns.push("top");
    if (isAdmin) { form.button(`§l Admin Panel\n§r§cKelola sistem bank`);  btns.push("admin"); }
    form.button(`§l Tutup`); btns.push("close");

    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "close") return;

    switch (btns[res.selection]) {
      case "transfer": await uiTransfer(player);    break;
      case "request":  await uiSendRequest(player); break;
      case "inbox":    await uiInbox(player);        break;
      case "history":  await uiHistory(player);      break;
      case "top":      await uiLeaderboard(player);  break;
      case "admin":    await uiAdmin(player);         break;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// UI: TRANSFER
// ═══════════════════════════════════════════════════════════

async function uiTransfer(player) {
  // ── Step 1: Pilih player tujuan ──────────────────────────
  const others = world.getPlayers().filter(p => p.id !== player.id);

  if (!others.length) {
    await new ActionFormData()
      .title("§l  Transfer  §r")
      .body(`${CFG.HR}\n§cTidak ada player online lain saat ini.\n${CFG.HR}`)
      .button("§l Kembali").show(player);
    return;
  }

  const form1 = new ActionFormData()
    .title("§l  Transfer — Pilih Tujuan  §r")
    .body(`${CFG.HR}\n§7Pilih player yang akan menerima koin:\n${CFG.HR}`);

  for (const p of others)
    form1.button(`§a● §f${p.name}\n§7Saldo: §e${fmt(getCoin(p))} Koin`);
  form1.button("§l ← Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === others.length) return;

  const target = others[res1.selection];
  const targetFresh = world.getPlayers().find(p => p.id === target.id);
  if (!targetFresh) {
    player.sendMessage(`§c[Bank] §f${target.name} §csudah offline.`);
    return;
  }

  // ── Step 2: Input jumlah & catatan ──────────────────────
  const myCoin   = getCoin(player);
  const daily    = getDailyUsed(player.id);
  const remain   = CFG.DAILY_LIMIT - daily;
  const maxAllow = Math.min(CFG.MAX_TRANSFER, remain);
  const tax      = getTax();

  const res2 = await new ModalFormData()
    .title(`§l  Transfer ke ${target.name}  §r`)
    .textField(
      `§fJumlah Koin\n` +
      `§7Saldo kamu  : §e${fmt(myCoin)} Koin\n` +
      `§7Min / Maks  : §e${fmt(CFG.MIN_TRANSFER)} §7/ §e${fmt(maxAllow)}\n` +
      `§7Pajak       : §f${tax}% §7(ditambahkan ke jumlah)\n` +
      `§7Sisa limit  : §e${fmt(remain)} Koin hari ini`,
      `Contoh: 500`,
      { defaultValue: "" }
    )
    .textField("§fCatatan §7(opsional, maks 50 karakter)", "Contoh: bayar hutang", { defaultValue: "" })
    .show(player);

  if (res2.canceled) return;

  const rawAmount = String(res2.formValues?.[0] ?? "").trim();
  const note      = String(res2.formValues?.[1] ?? "").trim().slice(0, 50);
  const amount    = Math.floor(Number(rawAmount));

  if (!Number.isFinite(amount) || amount < CFG.MIN_TRANSFER) {
    player.sendMessage(`§c[Bank] Jumlah tidak valid. Minimal §f${fmt(CFG.MIN_TRANSFER)} Koin.`); return;
  }
  if (amount > CFG.MAX_TRANSFER) {
    player.sendMessage(`§c[Bank] Melebihi batas per transaksi (§f${fmt(CFG.MAX_TRANSFER)} Koin§c).`); return;
  }
  if (amount > remain) {
    player.sendMessage(`§c[Bank] Sisa limit hari ini: §f${fmt(remain)} Koin.`); return;
  }

  const taxAmt = calcTax(amount);
  const total  = amount + taxAmt;

  if (myCoin < total) {
    player.sendMessage(
      `§c[Bank] Saldo tidak cukup!\n§7Butuh §f${fmt(total)} §7(${fmt(amount)} + pajak ${fmt(taxAmt)})§7, punya §e${fmt(myCoin)}.`
    );
    return;
  }

  // ── Step 3: Konfirmasi ───────────────────────────────────
  const confirm = await new MessageFormData()
    .title("§l  Konfirmasi Transfer  §r")
    .body(
      `${CFG.HR}\n` +
      `§fKirim ke      : §a${target.name}\n` +
      `§fJumlah        : §e${fmt(amount)} Koin\n` +
      `§fPajak (${tax}%)    : §c-${fmt(taxAmt)} Koin\n` +
      `§8───────────────────\n` +
      `§fTotal keluar  : §c${fmt(total)} Koin\n` +
      `§fSaldo sesudah : §e${fmt(myCoin - total)} Koin\n` +
      (note ? `§fCatatan       : §7${note}\n` : "") +
      `${CFG.HR}`
    )
    .button1("§7  Batal")
    .button2("§a  ✔ Transfer Sekarang")
    .show(player);

  if (confirm.canceled || confirm.selection !== 1) return;

  // ── Execute ───────────────────────────────────────────────
  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { player.sendMessage(`§c[Bank] ${target.name} sudah offline, transfer dibatalkan.`); return; }

  const result = executeTransfer(player, tgt, amount, note);

  if (!result.ok) {
    const msg = result.err === "daily_limit"
      ? `§c[Bank] Limit transfer harian terlampaui!`
      : `§c[Bank] Saldo tidak cukup!`;
    player.sendMessage(msg);
    return;
  }

  player.sendMessage(
    `§a[Bank] ✔ Transfer berhasil!\n` +
    `§7 Dikirim ke  : §f${tgt.name}\n` +
    `§7 Jumlah      : §e${fmt(result.amount)} Koin\n` +
    `§7 Pajak       : §c${fmt(result.tax)} Koin\n` +
    `§7 Saldo kini  : §e${fmt(getCoin(player))} Koin`
  );

  tgt.sendMessage(
    `§a[Bank] 💰 Kamu menerima transfer!\n` +
    `§7 Dari    : §f${player.name}\n` +
    `§7 Jumlah  : §e${fmt(result.amount)} Koin\n` +
    (note ? `§7 Catatan  : §f${note}\n` : "") +
    `§7 Saldo   : §e${fmt(getCoin(tgt))} Koin`
  );
}

// ═══════════════════════════════════════════════════════════
// UI: SEND REQUEST (minta koin dari player lain)
// ═══════════════════════════════════════════════════════════

async function uiSendRequest(player) {
  const others = world.getPlayers().filter(p => p.id !== player.id);

  if (!others.length) {
    await new ActionFormData()
      .title("§l  Minta Koin  §r")
      .body(`${CFG.HR}\n§cTidak ada player online lain.\n${CFG.HR}`)
      .button("§l Kembali").show(player);
    return;
  }

  // ── Step 1: Pilih target ─────────────────────────────────
  const form1 = new ActionFormData()
    .title("§l  Minta Koin — Pilih Player  §r")
    .body(`${CFG.HR}\n§7Pilih player yang akan dimintai koin:\n${CFG.HR}`);

  for (const p of others) {
    const inReqs = getIncomingReqs(p.id);
    const full   = inReqs.length >= CFG.MAX_PENDING_REQ;
    form1.button(`${full ? "§8" : "§a"}● §f${p.name}\n§e${fmt(getCoin(p))} Koin${full ? " §8[inbox penuh]" : ""}`);
  }
  form1.button("§l ← Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === others.length) return;

  const target = others[res1.selection];

  // Cek inbox target
  const tgtReqs = getIncomingReqs(target.id);
  if (tgtReqs.length >= CFG.MAX_PENDING_REQ) {
    player.sendMessage(`§c[Bank] Inbox §f${target.name} §cpenuh (${CFG.MAX_PENDING_REQ} maks). Coba lagi nanti.`);
    return;
  }

  // ── Step 2: Input jumlah & alasan ───────────────────────
  const res2 = await new ModalFormData()
    .title(`§l  Minta Koin dari ${target.name}  §r`)
    .textField(
      `§fJumlah Koin §7(min §e${fmt(CFG.MIN_TRANSFER)}§7)\n§7Request kadaluarsa dalam 5 menit.`,
      "Contoh: 200",
      { defaultValue: "" }
    )
    .textField(
      "§fAlasan §c(wajib diisi, maks 60 karakter)",
      "Contoh: minta bayar hutang kemarin",
      { defaultValue: "" }
    )
    .show(player);

  if (res2.canceled) return;

  const amount = Math.floor(Number(String(res2.formValues?.[0] ?? "").trim()));
  const reason = String(res2.formValues?.[1] ?? "").trim().slice(0, 60);

  if (!Number.isFinite(amount) || amount < CFG.MIN_TRANSFER) {
    player.sendMessage(`§c[Bank] Jumlah minimal §f${fmt(CFG.MIN_TRANSFER)} Koin.`); return;
  }
  if (!reason) {
    player.sendMessage(`§c[Bank] Alasan tidak boleh kosong!`); return;
  }

  // ── Kirim request ────────────────────────────────────────
  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { player.sendMessage(`§c[Bank] ${target.name} sudah offline.`); return; }

  const req = {
    id:        genId(),
    fromId:    player.id,
    fromName:  player.name,
    amount,
    reason,
    createdAt: Date.now(),
  };

  if (!addIncomingReq(tgt.id, req)) {
    player.sendMessage(`§c[Bank] Gagal mengirim request. Inbox ${tgt.name} penuh.`); return;
  }

  player.sendMessage(
    `§a[Bank] ✔ Request terkirim!\n` +
    `§7 Kepada  : §f${tgt.name}\n` +
    `§7 Jumlah  : §e${fmt(amount)} Koin\n` +
    `§7 Alasan  : §f${reason}\n` +
    `§8 Request kadaluarsa dalam 5 menit.`
  );

  tgt.sendMessage(
    `§e[Bank] 📨 Permintaan koin masuk!\n` +
    `§7 Dari    : §f${player.name}\n` +
    `§7 Jumlah  : §e${fmt(amount)} Koin\n` +
    `§7 Alasan  : §f${reason}\n` +
    `§7 Buka §f/bank §7→ §fPermintaan Masuk §7untuk merespons.`
  );
}

// ═══════════════════════════════════════════════════════════
// UI: INBOX (Permintaan masuk)
// ═══════════════════════════════════════════════════════════

async function uiInbox(player) {
  while (true) {
    const reqs = getIncomingReqs(player.id);

    if (!reqs.length) {
      await new ActionFormData()
        .title("§l  Permintaan Masuk  §r")
        .body(`${CFG.HR}\n§7Tidak ada permintaan koin masuk saat ini.\n${CFG.HR}`)
        .button("§l ← Kembali").show(player);
      return;
    }

    // ── Daftar request ───────────────────────────────────
    const form = new ActionFormData()
      .title(`§l  Permintaan Masuk (${reqs.length})  §r`)
      .body(`${CFG.HR}\n§7Pilih permintaan untuk menerima atau menolak:\n${CFG.HR}`);

    for (const r of reqs) {
      const mins = minsLeft(r);
      form.button(
        `§a${r.fromName}\n` +
        `§e${fmt(r.amount)} Koin §8| §7${mins}mnt tersisa`
      );
    }
    form.button("§l ← Kembali");

    const res = await form.show(player);
    if (res.canceled || res.selection === reqs.length) return;

    const req    = reqs[res.selection];
    const myCoin = getCoin(player);
    const tax    = calcTax(req.amount);
    const total  = req.amount + tax;

    // ── Detail request ───────────────────────────────────
    const detail = await new ActionFormData()
      .title(`§l  Permintaan dari ${req.fromName}  §r`)
      .body(
        `${CFG.HR}\n` +
        `§f Dari            : §a${req.fromName}\n` +
        `§f Jumlah          : §e${fmt(req.amount)} Koin\n` +
        `§f Alasan          : §7${req.reason}\n` +
        `${CFG.HR}\n` +
        `§f Pajak (${getTax()}%)      : §c-${fmt(tax)} Koin\n` +
        `§f Total yang keluar: §c${fmt(total)} Koin\n` +
        `§f Saldo kamu      : §e${fmt(myCoin)} Koin\n` +
        `§f Sisa            : §e${fmt(Math.max(0, myCoin - total))} Koin\n` +
        `${CFG.HR}\n` +
        `§8 Sisa waktu: ${minsLeft(req)} menit`
      )
      .button("§c Tolak")
      .button(myCoin >= total ? "§a Terima & Transfer" : "§8 Saldo Tidak Cukup")
      .show(player);

    if (detail.canceled) continue;

    if (detail.selection === 0) {
      // ── Tolak ────────────────────────────────────────
      removeReq(player.id, req.id);
      player.sendMessage(`§7[Bank] Request dari §f${req.fromName} §7ditolak.`);
      const sender = world.getPlayers().find(p => p.id === req.fromId);
      if (sender) sender.sendMessage(`§c[Bank] Request koin ke §f${player.name} §cditolak.`);
      continue;
    }

    if (detail.selection === 1) {
      // ── Terima ───────────────────────────────────────
      if (myCoin < total) {
        player.sendMessage(`§c[Bank] Saldo tidak cukup. Butuh §f${fmt(total)} Koin.`);
        continue;
      }

      const requester = world.getPlayers().find(p => p.id === req.fromId);
      if (!requester) {
        player.sendMessage(`§c[Bank] §f${req.fromName} §csudah offline. Request dibatalkan.`);
        removeReq(player.id, req.id);
        continue;
      }

      const result = executeTransfer(player, requester, req.amount, `[Request] ${req.reason}`);
      removeReq(player.id, req.id);

      if (!result.ok) {
        player.sendMessage(result.err === "daily_limit"
          ? `§c[Bank] Limit transfer harian terlampaui!`
          : `§c[Bank] Saldo tidak cukup!`
        );
        continue;
      }

      player.sendMessage(
        `§a[Bank] ✔ Request diterima!\n` +
        `§7 Dikirim ke : §f${requester.name}\n` +
        `§7 Jumlah     : §e${fmt(result.amount)} §7(pajak: §c${fmt(result.tax)}§7)\n` +
        `§7 Saldo kini : §e${fmt(getCoin(player))} Koin`
      );

      requester.sendMessage(
        `§a[Bank] 💰 Request koinmu diterima!\n` +
        `§7 Dari   : §f${player.name}\n` +
        `§7 Jumlah : §e${fmt(result.amount)} Koin\n` +
        `§7 Saldo  : §e${fmt(getCoin(requester))} Koin`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════
// UI: RIWAYAT TRANSAKSI
// ═══════════════════════════════════════════════════════════

async function uiHistory(player) {
  const hist = getHistory(player.id);

  let body = `${CFG.HR}\n§eRiwayat Transaksi\n${CFG.HR}\n`;

  if (!hist.length) {
    body += "§7Belum ada riwayat transaksi.\n";
  } else {
    for (const h of hist) {
      if (h.type === "sent") {
        body += `§c→ §f-${fmt(h.amount + (h.tax ?? 0))} §7ke §f${h.to}`;
        if (h.note) body += `§8 (${h.note})`;
        body += `\n§8   ${timeAgo(h.ts)}\n`;
      } else if (h.type === "received") {
        body += `§a← §f+${fmt(h.amount)} §7dari §f${h.from}`;
        if (h.note) body += `§8 (${h.note})`;
        body += `\n§8   ${timeAgo(h.ts)}\n`;
      }
    }
  }

  body += CFG.HR;

  await new ActionFormData()
    .title("§l  Riwayat Transaksi  §r")
    .body(body)
    .button("§l ← Kembali")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// UI: LEADERBOARD
// ═══════════════════════════════════════════════════════════

async function uiLeaderboard(player) {
  const entries = getCoinLeaderboard(10);
  const medals  = ["§6①", "§7②", "§e③"];

  let body = `${CFG.HR}\n§eTop 10 Koin Terbanyak\n${CFG.HR}\n`;

  if (!entries.length) {
    body += "§7Belum ada data koin.\n";
  } else {
    entries.forEach((e, i) => {
      const rank   = i < 3 ? medals[i] : `§7${i + 1}.`;
      const online = e.isOnline ? " §a●" : " §8○";
      body += `${rank}${online} §f${e.name}  §e${fmt(e.coin)} Koin\n`;
    });
  }

  body += `${CFG.HR}\n§a● §7= online  §8○ §7= offline`;

  await new ActionFormData()
    .title("§l  🏆 Top Koin  §r")
    .body(body)
    .button("§l ← Kembali")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// UI: ADMIN PANEL
// ═══════════════════════════════════════════════════════════

async function uiAdmin(player) {
  if (!player.hasTag(CFG.ADMIN_TAG)) { player.sendMessage("§c[Bank] Akses ditolak."); return; }

  while (true) {
    const settings = getSettings();

    const form = new ActionFormData()
      .title("§l§c  Bank Admin Panel  §r")
      .body(
        `${CFG.HR}\n` +
        `§c ADMIN §f| §a${player.name}\n` +
        `§7 Pajak saat ini : §f${settings.taxPct}%\n` +
        `§7 Player online  : §f${world.getPlayers().length}\n` +
        `${CFG.HR}`
      )
      .button("§l Beri Koin ke Player")
      .button("§l Kurangi Koin Player")
      .button("§l Ubah Pajak Transfer")
      .button("§l Reset Limit Harian Player")
      .button("§l Hapus Riwayat Player")
      .button("§l Lihat Saldo Semua Player")
      .button("§l ← Kembali");

    const res = await form.show(player);
    if (res.canceled || res.selection === 6) return;

    if (res.selection === 0) await adminGiveCoin(player);
    if (res.selection === 1) await adminDeductCoin(player);
    if (res.selection === 2) await adminSetTax(player, settings);
    if (res.selection === 3) await adminResetDaily(player);
    if (res.selection === 4) await adminClearHistory(player);
    if (res.selection === 5) await adminViewBalances(player);
  }
}

// ── Admin: Beri Koin ─────────────────────────────────────

async function adminGiveCoin(admin) {
  const target = await pickOnlinePlayer(admin, "Beri Koin — Pilih Player");
  if (!target) return;

  const res = await new ModalFormData()
    .title(`§l  Beri Koin ke ${target.name}  §r`)
    .textField(
      `§7Saldo saat ini: §e${fmt(getCoin(target))} Koin`,
      "Contoh: 1000", { defaultValue: "0" }
    )
    .show(admin);

  if (res.canceled) return;
  const amount = Math.floor(Number(String(res.formValues?.[0] ?? "0").trim()));
  if (!Number.isFinite(amount) || amount <= 0) { admin.sendMessage("§c[Bank Admin] Angka tidak valid."); return; }

  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { admin.sendMessage("§c[Bank Admin] Player offline."); return; }

  addCoin(tgt, amount);
  admin.sendMessage(`§a[Bank Admin] ✔ Diberikan §f${fmt(amount)} §aKoin ke §f${tgt.name}. Saldo: §e${fmt(getCoin(tgt))}`);
  tgt.sendMessage(`§a[Bank] Admin memberikan §e${fmt(amount)} Koin§a kepadamu! Saldo: §e${fmt(getCoin(tgt))}`);
}

// ── Admin: Kurangi Koin ──────────────────────────────────

async function adminDeductCoin(admin) {
  const target = await pickOnlinePlayer(admin, "Kurangi Koin — Pilih Player");
  if (!target) return;

  const res = await new ModalFormData()
    .title(`§l  Kurangi Koin dari ${target.name}  §r`)
    .textField(
      `§7Saldo saat ini: §e${fmt(getCoin(target))} Koin\n§cKoin tidak boleh minus (min 0)`,
      "Contoh: 500", { defaultValue: "0" }
    )
    .show(admin);

  if (res.canceled) return;
  const amount = Math.floor(Number(String(res.formValues?.[0] ?? "0").trim()));
  if (!Number.isFinite(amount) || amount <= 0) { admin.sendMessage("§c[Bank Admin] Angka tidak valid."); return; }

  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { admin.sendMessage("§c[Bank Admin] Player offline."); return; }

  const before = getCoin(tgt);
  setCoin(tgt, Math.max(0, before - amount));
  const after = getCoin(tgt);
  const actual = before - after;

  admin.sendMessage(`§a[Bank Admin] ✔ Dikurangi §f${fmt(actual)} §aKoin dari §f${tgt.name}. Saldo: §e${fmt(after)}`);
  tgt.sendMessage(`§c[Bank] Admin mengurangi §c${fmt(actual)} Koin§c dari akunmu. Saldo: §e${fmt(after)}`);
}

// ── Admin: Ubah Pajak ────────────────────────────────────

async function adminSetTax(admin, settings) {
  const res = await new ModalFormData()
    .title("§l  Ubah Pajak Transfer  §r")
    .slider(`§fPajak Transfer §7(saat ini: §f${settings.taxPct}%§7)`, 0, 50, 1, settings.taxPct)
    .show(admin);

  if (res.canceled) return;
  const newTax = res.formValues?.[0] ?? settings.taxPct;
  settings.taxPct = newTax;
  saveSettings(settings);
  admin.sendMessage(`§a[Bank Admin] ✔ Pajak diubah ke §f${newTax}%`);
  world.sendMessage(`§e[Bank] Admin mengubah pajak transfer menjadi §f${newTax}%.`);
}

// ── Admin: Reset Limit Harian ────────────────────────────

async function adminResetDaily(admin) {
  const target = await pickOnlinePlayer(admin, "Reset Limit — Pilih Player");
  if (!target) return;

  const used = getDailyUsed(target.id);
  const confirm = await new MessageFormData()
    .title("§l  Reset Limit Harian?  §r")
    .body(`§fReset limit harian §c${target.name}§f?\n§7 Terpakai: §e${fmt(used)} §7/ §e${fmt(CFG.DAILY_LIMIT)} Koin`)
    .button1("§7 Batal").button2("§a Ya, Reset").show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;
  dp.del(CFG.K_DAILY + target.id);
  admin.sendMessage(`§a[Bank Admin] ✔ Limit harian §f${target.name} §adireset.`);
  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (tgt) tgt.sendMessage(`§a[Bank] Limit transfer harianmu telah direset oleh admin.`);
}

// ── Admin: Hapus Riwayat ─────────────────────────────────

async function adminClearHistory(admin) {
  const target = await pickOnlinePlayer(admin, "Hapus Riwayat — Pilih Player");
  if (!target) return;

  const confirm = await new MessageFormData()
    .title("§l  Hapus Riwayat?  §r")
    .body(`§fHapus seluruh riwayat transaksi §c${target.name}§f?\n§cTindakan ini tidak bisa diurungkan!`)
    .button1("§7 Batal").button2("§c Ya, Hapus").show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;
  dp.del(CFG.K_HIST + target.id);
  admin.sendMessage(`§a[Bank Admin] ✔ Riwayat §f${target.name} §adihapus.`);
}

// ── Admin: Lihat Saldo Semua ─────────────────────────────

async function adminViewBalances(admin) {
  const players = world.getPlayers();
  let body = `${CFG.HR}\n§e Saldo Semua Player Online\n${CFG.HR}\n`;
  const sorted = [...players].sort((a, b) => getCoin(b) - getCoin(a));
  for (const p of sorted) {
    const coin  = getCoin(p);
    const daily = getDailyUsed(p.id);
    body += `§a● §f${p.name}  §e${fmt(coin)} Koin\n§8  Terpakai hari ini: ${fmt(daily)}\n`;
  }
  body += CFG.HR;

  await new ActionFormData()
    .title("§l  Saldo Semua Player  §r")
    .body(body)
    .button("§l ← Kembali")
    .show(admin);
}

// ── Admin: Helper pick player ────────────────────────────

async function pickOnlinePlayer(admin, title) {
  const players = world.getPlayers().filter(p => p.id !== admin.id);
  if (!players.length) {
    admin.sendMessage("§c[Bank Admin] Tidak ada player lain yang online.");
    return null;
  }

  const form = new ActionFormData()
    .title(`§l  ${title}  §r`)
    .body(`${CFG.HR}\n§7Pilih player:\n${CFG.HR}`);

  for (const p of players)
    form.button(`§a● §f${p.name}\n§e${fmt(getCoin(p))} Koin`);
  form.button("§l ← Kembali");

  const res = await form.show(admin);
  if (res.canceled || res.selection === players.length) return null;
  return players[res.selection];
}

// ═══════════════════════════════════════════════════════════
// COMMAND INTERCEPTION — /bank atau !bank
// ═══════════════════════════════════════════════════════════

// ── Registrasi /bank sebagai custom command resmi ─────────
// Cara ini membuat /bank bisa dipakai meski cheat OFF,
// karena command didaftarkan ke engine sebelum world load.
// ═══════════════════════════════════════════════════════════
// COMMAND INTERCEPTION — /bank (cheat OFF) + !bank fallback
// ═══════════════════════════════════════════════════════════

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:bank",
        description: "Buka menu Bank Koin",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!checkCooldown(player)) {
          system.run(() => player.sendMessage("§c[Bank] Tunggu sebentar sebelum membuka bank lagi!"));
          return;
        }
        if (activeSessions.has(player.id)) return;
        system.run(() => openBankMenu(player).catch(e => console.error("[Bank] openBankMenu error:", e)));
        return { status: 0 };
      }
    );
    console.log("[Bank] Custom command /lt:bank terdaftar (cheat OFF ✔)");
  } catch (e) {
    console.warn("[Bank] Registrasi command gagal:", e);
  }
});

// ── Fallback: !bank / bank via chat ──────────────────────
world.beforeEvents.chatSend.subscribe(event => {
  const msg = event.message.trim();
  if (msg !== "!bank" && msg.toLowerCase() !== "bank") return;
  event.cancel = true;

  const player = event.sender;
  if (!checkCooldown(player)) {
    system.run(() => player.sendMessage("§c[Bank] Tunggu sebentar sebelum membuka bank lagi!"));
    return;
  }
  if (activeSessions.has(player.id)) return;

  system.run(() => {
    openBankMenu(player).catch(e => console.error("[Bank] openBankMenu error:", e));
  });
});

// ── ScriptEvent fallback: /scriptevent bank:open ──────────
system.afterEvents.scriptEventReceive.subscribe(ev => {
  if (ev.id !== "bank:open") return;
  const src = ev.sourceEntity;
  if (!src || typeof src.hasTag !== "function") return; // bukan player
  if (activeSessions.has(src.id)) return;
  system.run(() => {
    openBankMenu(src).catch(e => console.error("[Bank] Error:", e));
  });
});

// ═══════════════════════════════════════════════════════════
// EVENTS — Notifikasi & Cleanup
// ═══════════════════════════════════════════════════════════

// Notifikasi request saat player login
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      const live = world.getPlayers().find(p => p.id === player.id);
      if (!live) return;
      const reqs = getIncomingReqs(live.id);
      if (reqs.length > 0)
        live.sendMessage(
          `§e[Bank] 📨 Kamu punya §f${reqs.length} §epermintaan koin masuk!\n§7Ketik §f/bank §7→ §fPermintaan Masuk §7untuk melihatnya.`
        );
    } catch {}
  }, 100);
});

// Bersihkan state saat player disconnect
world.afterEvents.playerLeave.subscribe(ev => {
  bankCooldown.delete(ev.playerId);
  activeSessions.delete(ev.playerId);
});

console.log(`[Bank] Sistem Bank Koin aktif! Trigger: §f/lt:bank §7(cheat OFF ✔) atau §f!bank §7di chat.`);