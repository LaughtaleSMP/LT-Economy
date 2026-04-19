// Bank/main.js

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG } from "./config.js";

// ═══════════════════════════════════════════════════════════
// LOCK — mencegah race condition pada transaksi bersamaan
// ═══════════════════════════════════════════════════════════
const lockSet = new Set();

async function withLock(id, fn) {
  if (lockSet.has(id)) return false;
  lockSet.add(id);
  try { return await fn(); }
  finally { lockSet.delete(id); }
}

// ═══════════════════════════════════════════════════════════
// STORAGE
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
        console.warn(`[Bank] dp.set WARNING: "${k}" ${str.length} chars`);
      world.setDynamicProperty(k, str);
    } catch (e) { console.error("[Bank] dp.set gagal:", k, e); }
  },
  del: (k) => { try { world.setDynamicProperty(k, undefined); } catch {} },
};

// ═══════════════════════════════════════════════════════════
// COIN HELPERS
// ═══════════════════════════════════════════════════════════
function ensureCoinObj() {
  return world.scoreboard.getObjective(CFG.COIN_OBJ)
    ?? world.scoreboard.addObjective(CFG.COIN_OBJ, "Koin");
}

function getCoin(player) {
  try { return ensureCoinObj()?.getScore(player.scoreboardIdentity ?? player) ?? 0; }
  catch { return 0; }
}

function setCoin(player, n) {
  try {
    ensureCoinObj()?.setScore(
      player.scoreboardIdentity ?? player,
      Math.max(0, Math.floor(n))
    );
  } catch (e) { console.error("[Bank] setCoin error:", e); }
}

const addCoin = (player, n) => setCoin(player, getCoin(player) + n);

// ═══════════════════════════════════════════════════════════
// DAILY LIMIT
// ═══════════════════════════════════════════════════════════
const todayStr = () => new Date().toISOString().slice(0, 10);

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
// HISTORY — personal per player
// ═══════════════════════════════════════════════════════════
function pushHistory(playerId, entry) {
  const hist = dp.get(CFG.K_HIST + playerId, []);
  hist.unshift({ ...entry, ts: Date.now() });
  dp.set(CFG.K_HIST + playerId, hist.slice(0, CFG.MAX_HISTORY));
}

const getHistory = (playerId) => dp.get(CFG.K_HIST + playerId, []);

// ═══════════════════════════════════════════════════════════
// GLOBAL LOG — semua transaksi, 10 terakhir (untuk admin)
// ═══════════════════════════════════════════════════════════
function pushGlobalLog(entry) {
  try {
    const hist = dp.get(CFG.K_GLOBAL_HIST, []);
    hist.unshift({ ...entry, ts: entry.ts ?? Date.now() });
    dp.set(CFG.K_GLOBAL_HIST, hist.slice(0, CFG.MAX_GLOBAL_HIST));
  } catch (e) { console.warn("[Bank] pushGlobalLog error:", e); }
}

// ═══════════════════════════════════════════════════════════
// PENDING NOTIFICATIONS — untuk player yang offline
// ═══════════════════════════════════════════════════════════
function pushPendingNotif(playerId, msg) {
  const list = dp.get(CFG.K_NOTIF_PEND + playerId, []);
  list.push(msg);
  dp.set(CFG.K_NOTIF_PEND + playerId, list.slice(0, 10));
}

function flushPendingNotifs(player) {
  const list = dp.get(CFG.K_NOTIF_PEND + player.id, []);
  if (!list.length) return;
  dp.del(CFG.K_NOTIF_PEND + player.id);
  for (const msg of list) player.sendMessage(msg);
}

// ═══════════════════════════════════════════════════════════
// REQUEST SYSTEM
// ═══════════════════════════════════════════════════════════
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function getIncomingReqs(playerId) {
  const reqs  = dp.get(CFG.K_REQ_IN + playerId, []);
  const now   = Date.now();
  const valid = reqs.filter(r => (now - r.createdAt) < CFG.REQUEST_EXPIRE_MS);
  if (valid.length !== reqs.length) dp.set(CFG.K_REQ_IN + playerId, valid);
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
  dp.set(CFG.K_REQ_IN + playerId, getIncomingReqs(playerId).filter(r => r.id !== reqId));
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
const getSettings  = ()  => dp.get(CFG.K_SETTINGS, { taxPct: CFG.TAX_PERCENT });
const saveSettings = (s) => dp.set(CFG.K_SETTINGS, s);
const getTax       = ()  => getSettings().taxPct;
const calcTax      = (n) => Math.ceil(n * getTax() / 100);

// ═══════════════════════════════════════════════════════════
// SOUND
// ═══════════════════════════════════════════════════════════
const SFX = {
  OPEN:    { id: "random.click",   pitch: 1.3, vol: 0.7 },
  SEND:    { id: "random.orb",     pitch: 0.8, vol: 1.0 },
  RECEIVE: { id: "random.levelup", pitch: 1.0, vol: 1.0 },
  REQUEST: { id: "note.pling",     pitch: 1.2, vol: 0.8 },
  DECLINE: { id: "note.bass",      pitch: 0.6, vol: 0.8 },
  ADMIN:   { id: "random.levelup", pitch: 1.8, vol: 1.0 },
};

const playSfx = (player, s) => {
  try { player.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch {}
};

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const bankCooldown   = new Map();
const activeSessions = new Set();

const checkCooldown = (p) =>
  (system.currentTick - (bankCooldown.get(p.id) ?? -(CFG.COOLDOWN_TICKS + 1))) >= CFG.COOLDOWN_TICKS;
const setCooldown   = (p) => bankCooldown.set(p.id, system.currentTick);

// ═══════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════
const fmt = (n) => Math.floor(n).toLocaleString("id-ID");

function timeAgo(ts) {
  if (!ts) return "?";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return `${s}dtk lalu`;
  if (s < 3600)  return `${Math.floor(s / 60)}mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}jam lalu`;
  return `${Math.floor(s / 86400)}hr lalu`;
}

const minsLeft = (req) =>
  Math.max(0, Math.floor((CFG.REQUEST_EXPIRE_MS - (Date.now() - req.createdAt)) / 60_000));

// ═══════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════
function getCoinLeaderboard(limit = 10) {
  try {
    const obj = world.scoreboard.getObjective(CFG.COIN_OBJ);
    if (!obj) return [];
    const onlineMap = new Map(world.getPlayers().map(p => [p.name, getCoin(p)]));
    const entries   = [];
    for (const ident of obj.getParticipants()) {
      try {
        const name = ident.displayName;
        if (!name) continue;
        if (name.startsWith("command.")) continue;
        if (name.includes(".scoreboard.")) continue;
        const isOnline = onlineMap.has(name);
        const score    = isOnline ? onlineMap.get(name) : (obj.getScore(ident) ?? 0);
        if (score <= 0) continue;
        entries.push({ name, coin: score, isOnline });
      } catch {}
    }
    return entries.sort((a, b) => b.coin - a.coin).slice(0, limit);
  } catch (e) { console.warn("[Bank] leaderboard error:", e); return []; }
}

// ═══════════════════════════════════════════════════════════
// EXECUTE TRANSFER — atomic dengan lock
// ═══════════════════════════════════════════════════════════
async function executeTransfer(from, to, amount, note = "") {
  return withLock(from.id, () => {
    const tax      = calcTax(amount);
    const totalOut = amount + tax;
    const daily    = getDailyUsed(from.id);

    if (daily + totalOut > CFG.DAILY_LIMIT)  return { ok: false, err: "daily_limit" };

    const curBal = getCoin(from);
    if (curBal < totalOut)                   return { ok: false, err: "insufficient" };

    setCoin(from, curBal - totalOut);
    addCoin(to, amount);
    addDailyUsed(from.id, totalOut);

    const ts = Date.now();
    pushHistory(from.id, { type: "sent",     to:   to.name,   amount, tax, note, ts });
    pushHistory(to.id,   { type: "received", from: from.name, amount,       note, ts });
    pushGlobalLog({ from: from.name, to: to.name, amount, tax, note, ts });

    return { ok: true, amount, tax, totalOut };
  });
}

// ═══════════════════════════════════════════════════════════
// OPEN BANK
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
    const dailyPct = Math.min(100, Math.round(daily / CFG.DAILY_LIMIT * 100));
    const isAdmin  = player.hasTag(CFG.ADMIN_TAG);
    const reqBadge = reqs.length ? ` §c(${reqs.length})` : "";

    const body =
      `${CFG.HR}\n` +
      `§e Saldo  : §f${fmt(coin)} Koin\n` +
      `§7 Pajak  : §f${getTax()}%\n` +
      `§7 Limit  : §f${fmt(daily)} §7/ §f${fmt(CFG.DAILY_LIMIT)} §7(§e${dailyPct}%§7)\n` +
      `${CFG.HR}`;

    const btns = [];
    const form = new ActionFormData().title("§l§6  BANK KOIN  §r").body(body);

    form.button(`§l Transfer Koin\n§r§7Kirim ke player lain`);                                                         btns.push("transfer");
    form.button(`§l Minta Koin\n§r§7Request dari player lain`);                                                        btns.push("request");
    form.button(`§l Permintaan${reqBadge}\n§r§7${reqs.length ? `${reqs.length} menunggu` : "Tidak ada"}`);            btns.push("inbox");
    form.button(`§l Mutasi Saya\n§r§710 transaksi terakhir`);                                                          btns.push("history");
    form.button(`§l Top Koin\n§r§7Leaderboard saldo`);                                                                 btns.push("top");
    if (isAdmin) { form.button(`§l Admin\n§r§cKelola bank`); btns.push("admin"); }
    form.button("§l Tutup"); btns.push("close");

    playSfx(player, SFX.OPEN);
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
  const others = world.getPlayers().filter(p => p.id !== player.id);
  if (!others.length) {
    await new ActionFormData()
      .title("§l  Transfer  §r")
      .body(`${CFG.HR}\n§c Tidak ada player online lain.\n${CFG.HR}`)
      .button("§l Kembali").show(player);
    return;
  }

  // Step 1: Pilih tujuan
  const form1 = new ActionFormData()
    .title("§l  Transfer — Pilih Tujuan  §r")
    .body(`${CFG.HR}\n§7 Pilih player tujuan:\n${CFG.HR}`);
  for (const p of others)
    form1.button(`§a[Online] §f${p.name}\n§7Saldo: §e${fmt(getCoin(p))} Koin`);
  form1.button("§l Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === others.length) return;
  const target = others[res1.selection];

  // Step 2: Input jumlah
  const myCoin = getCoin(player);
  const remain = Math.min(CFG.MAX_TRANSFER, CFG.DAILY_LIMIT - getDailyUsed(player.id));

  const res2 = await new ModalFormData()
    .title(`§l  Transfer ke ${target.name}  §r`)
    .textField(
      `§f Jumlah\n§7 Saldo: §e${fmt(myCoin)} §7| Min: §e${fmt(CFG.MIN_TRANSFER)} §7| Maks: §e${fmt(remain)}\n§7 Pajak: §f${getTax()}% §7(ditambah ke jumlah)`,
      "Contoh: 500",
      { defaultValue: "" }
    )
    .textField("§f Catatan §7(opsional, maks 50 karakter)", "Contoh: bayar hutang", { defaultValue: "" })
    .show(player);

  if (res2.canceled) return;

  const amount = Math.floor(Number(String(res2.formValues?.[0] ?? "").trim()));
  const note   = String(res2.formValues?.[1] ?? "").trim().slice(0, 50);

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
    player.sendMessage(`§c[Bank] Saldo tidak cukup! Butuh §f${fmt(total)} §c(${fmt(amount)} + pajak ${fmt(taxAmt)}).`);
    return;
  }

  // Step 3: Konfirmasi
  const confirm = await new MessageFormData()
    .title("§l  Konfirmasi Transfer  §r")
    .body(
      `${CFG.HR}\n` +
      `§f Kepada  : §a${target.name}\n` +
      `§f Jumlah  : §e${fmt(amount)} Koin\n` +
      `§f Pajak   : §c-${fmt(taxAmt)} Koin\n` +
      `§8 ──────────────────\n` +
      `§f Total   : §c${fmt(total)} Koin\n` +
      `§f Sisa    : §e${fmt(myCoin - total)} Koin\n` +
      (note ? `§f Catatan : §7${note}\n` : "") +
      `${CFG.HR}`
    )
    .button1("§7 Batal")
    .button2("§a Transfer")
    .show(player);

  if (confirm.canceled || confirm.selection !== 1) return;

  // Re-check target masih online
  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) {
    player.sendMessage(`§c[Bank] ${target.name} sudah offline, transfer dibatalkan.`);
    return;
  }

  const result = await executeTransfer(player, tgt, amount, note);

  if (result === false) {
    player.sendMessage("§c[Bank] Ada transaksi lain berjalan. Coba lagi sebentar.");
    return;
  }
  if (!result.ok) {
    player.sendMessage(result.err === "daily_limit"
      ? "§c[Bank] Limit transfer harian terlampaui!"
      : "§c[Bank] Saldo tidak cukup!"
    );
    return;
  }

  playSfx(player, SFX.SEND);
  playSfx(tgt,    SFX.RECEIVE);

  player.sendMessage(
    `§a[Bank] Transfer berhasil!\n` +
    `§7 Ke     : §f${tgt.name}\n` +
    `§7 Jumlah : §e${fmt(result.amount)} Koin\n` +
    `§7 Pajak  : §c${fmt(result.tax)} Koin\n` +
    `§7 Saldo  : §e${fmt(getCoin(player))} Koin`
  );
  tgt.sendMessage(
    `§a[Bank] Kamu menerima koin!\n` +
    `§7 Dari   : §f${player.name}\n` +
    `§7 Jumlah : §e${fmt(result.amount)} Koin\n` +
    (note ? `§7 Catatan : §f${note}\n` : "") +
    `§7 Saldo  : §e${fmt(getCoin(tgt))} Koin`
  );
}

// ═══════════════════════════════════════════════════════════
// UI: SEND REQUEST
// ═══════════════════════════════════════════════════════════
async function uiSendRequest(player) {
  const others = world.getPlayers().filter(p => p.id !== player.id);
  if (!others.length) {
    await new ActionFormData()
      .title("§l  Minta Koin  §r")
      .body(`${CFG.HR}\n§c Tidak ada player online lain.\n${CFG.HR}`)
      .button("§l Kembali").show(player);
    return;
  }

  // Step 1: Pilih target
  const form1 = new ActionFormData()
    .title("§l  Minta Koin — Pilih Player  §r")
    .body(`${CFG.HR}\n§7 Pilih player:\n${CFG.HR}`);
  for (const p of others) {
    const full = getIncomingReqs(p.id).length >= CFG.MAX_PENDING_REQ;
    form1.button(`${full ? "§8[Penuh]" : "§a[Online]"} §f${p.name}\n§e${fmt(getCoin(p))} Koin`);
  }
  form1.button("§l Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === others.length) return;
  const target = others[res1.selection];

  if (getIncomingReqs(target.id).length >= CFG.MAX_PENDING_REQ) {
    player.sendMessage(`§c[Bank] Inbox §f${target.name} §cpenuh.`);
    return;
  }

  // Step 2: Input
  const res2 = await new ModalFormData()
    .title(`§l  Minta Koin dari ${target.name}  §r`)
    .textField(
      `§f Jumlah §7(min §e${fmt(CFG.MIN_TRANSFER)}§7)\n§8 Kadaluarsa dalam 5 menit`,
      "Contoh: 200",
      { defaultValue: "" }
    )
    .textField("§f Alasan §c(wajib diisi, maks 60 karakter)", "Contoh: bayar hutang", { defaultValue: "" })
    .show(player);

  if (res2.canceled) return;

  const amount = Math.floor(Number(String(res2.formValues?.[0] ?? "").trim()));
  const reason = String(res2.formValues?.[1] ?? "").trim().slice(0, 60);

  if (!Number.isFinite(amount) || amount < CFG.MIN_TRANSFER) {
    player.sendMessage(`§c[Bank] Jumlah minimal §f${fmt(CFG.MIN_TRANSFER)} Koin.`); return;
  }
  if (!reason) {
    player.sendMessage("§c[Bank] Alasan tidak boleh kosong!"); return;
  }

  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { player.sendMessage(`§c[Bank] ${target.name} sudah offline.`); return; }

  const req = { id: genId(), fromId: player.id, fromName: player.name, amount, reason, createdAt: Date.now() };
  if (!addIncomingReq(tgt.id, req)) {
    player.sendMessage(`§c[Bank] Inbox ${tgt.name} penuh.`); return;
  }

  playSfx(tgt, SFX.REQUEST);
  player.sendMessage(
    `§a[Bank] Request terkirim!\n` +
    `§7 Kepada : §f${tgt.name}\n` +
    `§7 Jumlah : §e${fmt(amount)} Koin\n` +
    `§7 Alasan : §f${reason}`
  );
  tgt.sendMessage(
    `§e[Bank] Permintaan koin masuk!\n` +
    `§7 Dari   : §f${player.name}\n` +
    `§7 Jumlah : §e${fmt(amount)} Koin\n` +
    `§7 Alasan : §f${reason}\n` +
    `§8 Buka /bank -> Permintaan untuk respons`
  );
}

// ═══════════════════════════════════════════════════════════
// UI: INBOX
// ═══════════════════════════════════════════════════════════
async function uiInbox(player) {
  while (true) {
    const reqs = getIncomingReqs(player.id);
    if (!reqs.length) {
      await new ActionFormData()
        .title("§l  Permintaan Masuk  §r")
        .body(`${CFG.HR}\n§7 Tidak ada permintaan masuk.\n${CFG.HR}`)
        .button("§l Kembali").show(player);
      return;
    }

    const form = new ActionFormData()
      .title(`§l  Permintaan (${reqs.length})  §r`)
      .body(`${CFG.HR}\n§7 Pilih permintaan:\n${CFG.HR}`);
    for (const r of reqs)
      form.button(`§f${r.fromName}  §e${fmt(r.amount)} Koin\n§8${minsLeft(r)}mnt tersisa`);
    form.button("§l Kembali");

    const res = await form.show(player);
    if (res.canceled || res.selection === reqs.length) return;

    const req    = reqs[res.selection];
    const myCoin = getCoin(player);
    const tax    = calcTax(req.amount);
    const total  = req.amount + tax;

    const detail = await new ActionFormData()
      .title(`§l  Permintaan dari ${req.fromName}  §r`)
      .body(
        `${CFG.HR}\n` +
        `§f Dari    : §a${req.fromName}\n` +
        `§f Jumlah  : §e${fmt(req.amount)} Koin\n` +
        `§f Alasan  : §7${req.reason}\n` +
        `${CFG.HR}\n` +
        `§f Pajak   : §c-${fmt(tax)} Koin\n` +
        `§f Total   : §c${fmt(total)} Koin\n` +
        `§f Saldo   : §e${fmt(myCoin)} Koin\n` +
        `§8 Sisa: ${minsLeft(req)} menit\n` +
        `${CFG.HR}`
      )
      .button("§c Tolak")
      .button(myCoin >= total ? "§a Terima" : "§8 Saldo Kurang")
      .show(player);

    if (detail.canceled) continue;

    if (detail.selection === 0) {
      removeReq(player.id, req.id);
      playSfx(player, SFX.DECLINE);
      player.sendMessage(`§7[Bank] Request dari §f${req.fromName} §7ditolak.`);
      const sender = world.getPlayers().find(p => p.id === req.fromId);
      if (sender) {
        playSfx(sender, SFX.DECLINE);
        sender.sendMessage(`§c[Bank] Request koin ke §f${player.name} §cditolak.`);
      } else {
        pushPendingNotif(req.fromId, `§c[Bank] Request koin ke §f${player.name} §cditolak.`);
      }
      continue;
    }

    if (getCoin(player) < total) {
      player.sendMessage(`§c[Bank] Saldo tidak cukup. Butuh §f${fmt(total)} Koin.`);
      continue;
    }

    const requester = world.getPlayers().find(p => p.id === req.fromId);
    if (!requester) {
      removeReq(player.id, req.id);
      pushPendingNotif(req.fromId,
        `§e[Bank] §f${player.name} §emau menerima requestmu tapi kamu offline saat itu.\n§8 Kirim request lagi saat kamu online.`
      );
      player.sendMessage(`§c[Bank] §f${req.fromName} §csudah offline. Request dihapus.`);
      continue;
    }

    const result = await executeTransfer(player, requester, req.amount, `[Request] ${req.reason}`);

    if (result === false) {
      player.sendMessage("§c[Bank] Ada transaksi lain berjalan. Coba lagi sebentar.");
      continue;
    }

    removeReq(player.id, req.id);

    if (!result.ok) {
      player.sendMessage(result.err === "daily_limit"
        ? "§c[Bank] Limit transfer harian terlampaui!"
        : "§c[Bank] Saldo tidak cukup!"
      );
      continue;
    }

    playSfx(player,    SFX.SEND);
    playSfx(requester, SFX.RECEIVE);

    player.sendMessage(
      `§a[Bank] Request diterima!\n` +
      `§7 Ke     : §f${requester.name}\n` +
      `§7 Jumlah : §e${fmt(result.amount)} §7(pajak: §c${fmt(result.tax)}§7)\n` +
      `§7 Saldo  : §e${fmt(getCoin(player))} Koin`
    );
    requester.sendMessage(
      `§a[Bank] Request koin diterima!\n` +
      `§7 Dari   : §f${player.name}\n` +
      `§7 Jumlah : §e${fmt(result.amount)} Koin\n` +
      `§7 Saldo  : §e${fmt(getCoin(requester))} Koin`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// UI: MUTASI PRIBADI — 10 transaksi terakhir player
// ═══════════════════════════════════════════════════════════
async function uiHistory(player) {
  // Ambil max 10 entri terakhir dari history personal
  const hist = getHistory(player.id).slice(0, 10);

  let body = `${CFG.HR}\n§e 10 Mutasi Terakhir Kamu\n${CFG.HR}\n`;

  if (!hist.length) {
    body += "\n§7 Belum ada riwayat transaksi.\n";
  } else {
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      const isSent = h.type === "sent";

      // Nomor urut
      body += `\n§7${i + 1}. `;

      if (isSent) {
        // Transfer keluar
        const totalKeluar = h.amount + (h.tax ?? 0);
        body += `§c▼ Kirim §fke §a${h.to ?? "?"}\n`;
        body += `§7   Jumlah : §c-${fmt(totalKeluar)} Koin`;
        if ((h.tax ?? 0) > 0)
          body += ` §8(pajak §c${fmt(h.tax)}§8)`;
      } else {
        // Transfer masuk
        body += `§a▲ Terima §fdari §a${h.from ?? "?"}\n`;
        body += `§7   Jumlah : §a+${fmt(h.amount)} Koin`;
      }

      if (h.note && h.note.trim()) {
        body += `\n§7   Catatan: §f${h.note}`;
      }

      body += `\n§8   ${timeAgo(h.ts)}\n`;
    }
  }

  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§l  Mutasi Saya  §r")
    .body(body)
    .button("§l Kembali")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// UI: LEADERBOARD
// ═══════════════════════════════════════════════════════════
async function uiLeaderboard(player) {
  const entries = getCoinLeaderboard(10);
  const medals  = ["§6[1]", "§7[2]", "§e[3]"];
  let body      = `${CFG.HR}\n§e Top 10 Koin\n${CFG.HR}\n`;

  if (!entries.length) {
    body += "§7 Belum ada data.\n";
  } else {
    entries.forEach((e, i) => {
      const rank   = i < 3 ? medals[i] : `§7${i + 1}.`;
      const status = e.isOnline ? "§a[O]" : "§8[X]";
      body += `${rank} ${status} §f${e.name}  §e${fmt(e.coin)} Koin\n`;
    });
  }

  await new ActionFormData()
    .title("§l  Top Koin  §r")
    .body(body + CFG.HR)
    .button("§l Kembali")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// UI: ADMIN
// ═══════════════════════════════════════════════════════════
async function uiAdmin(player) {
  if (!player.hasTag(CFG.ADMIN_TAG)) { player.sendMessage("§c[Bank] Akses ditolak."); return; }

  while (true) {
    const settings = getSettings();
    const form     = new ActionFormData()
      .title("§l§c  Bank Admin  §r")
      .body(
        `${CFG.HR}\n` +
        `§c Admin  §7| §a${player.name}\n` +
        `§7 Pajak  : §f${settings.taxPct}%\n` +
        `§7 Online : §f${world.getPlayers().length} player\n` +
        `${CFG.HR}`
      )
      .button("§l Beri Koin")
      .button("§l Kurangi Koin")
      .button("§l Ubah Pajak")
      .button("§l Reset Limit Harian")
      .button("§l Hapus Riwayat")
      .button("§l Lihat Saldo")
      .button("§l Log Mutasi Global")
      .button("§l Kembali");

    playSfx(player, SFX.ADMIN);
    const res = await form.show(player);
    if (res.canceled || res.selection === 7) return;

    if (res.selection === 0) await adminGiveCoin(player);
    if (res.selection === 1) await adminDeductCoin(player);
    if (res.selection === 2) await adminSetTax(player);
    if (res.selection === 3) await adminResetDaily(player);
    if (res.selection === 4) await adminClearHistory(player);
    if (res.selection === 5) await adminViewBalances(player);
    if (res.selection === 6) await adminViewGlobalLog(player);
  }
}

// ═══════════════════════════════════════════════════════════
// UI: ADMIN — LOG MUTASI GLOBAL (10 terakhir)
// ═══════════════════════════════════════════════════════════
async function adminViewGlobalLog(admin) {
  const hist = dp.get(CFG.K_GLOBAL_HIST, []);
  let body   = `${CFG.HR}\n§e 10 Mutasi Terakhir (Global)\n${CFG.HR}\n`;

  if (!hist.length) {
    body += "\n§7 Belum ada mutasi tercatat.\n";
  } else {
    for (let i = 0; i < hist.length; i++) {
      const h      = hist[i];
      const taxInfo = (h.tax ?? 0) > 0 ? ` §8(pajak §c${fmt(h.tax)}§8)` : "";
      body +=
        `\n§f${i + 1}. §a${h.from ?? "?"} §7→ §c${h.to ?? "?"}\n` +
        `§7   Jumlah : §e${fmt(h.amount)} Koin${taxInfo}\n` +
        (h.note && h.note.trim() ? `§7   Catatan: §f${h.note}\n` : "") +
        `§8   ${timeAgo(h.ts)}\n`;
    }
  }

  await new ActionFormData()
    .title("§l  Log Mutasi Global  §r")
    .body(body + CFG.HR)
    .button("§l Kembali")
    .show(admin);
}

async function adminGiveCoin(admin) {
  const target = await pickOnlinePlayer(admin, "Beri Koin");
  if (!target) return;

  const res = await new ModalFormData()
    .title(`§l  Beri Koin — ${target.name}  §r`)
    .textField(`§7 Saldo saat ini: §e${fmt(getCoin(target))} Koin`, "Contoh: 1000", { defaultValue: "0" })
    .show(admin);

  if (res.canceled) return;
  const amount = Math.floor(Number(String(res.formValues?.[0] ?? "0").trim()));
  if (!Number.isFinite(amount) || amount <= 0) { admin.sendMessage("§c[Bank] Angka tidak valid."); return; }

  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { admin.sendMessage("§c[Bank] Player sudah offline."); return; }

  addCoin(tgt, amount);
  playSfx(admin, SFX.ADMIN);
  playSfx(tgt,   SFX.RECEIVE);
  admin.sendMessage(`§a[Bank Admin] Diberikan §f${fmt(amount)} §aKoin ke §f${tgt.name}. Saldo: §e${fmt(getCoin(tgt))}`);
  tgt.sendMessage(`§a[Bank] Admin memberimu §e${fmt(amount)} Koin§a! Saldo: §e${fmt(getCoin(tgt))}`);
}

async function adminDeductCoin(admin) {
  const target = await pickOnlinePlayer(admin, "Kurangi Koin");
  if (!target) return;

  const res = await new ModalFormData()
    .title(`§l  Kurangi Koin — ${target.name}  §r`)
    .textField(`§7 Saldo saat ini: §e${fmt(getCoin(target))} Koin`, "Contoh: 500", { defaultValue: "0" })
    .show(admin);

  if (res.canceled) return;
  const amount = Math.floor(Number(String(res.formValues?.[0] ?? "0").trim()));
  if (!Number.isFinite(amount) || amount <= 0) { admin.sendMessage("§c[Bank] Angka tidak valid."); return; }

  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (!tgt) { admin.sendMessage("§c[Bank] Player sudah offline."); return; }

  const deducted = await withLock(tgt.id, () => {
    const before = getCoin(tgt);
    const actual = Math.min(before, amount);
    setCoin(tgt, before - actual);
    return actual;
  });

  if (deducted === false) { admin.sendMessage("§c[Bank] Player sedang transaksi. Coba lagi."); return; }

  playSfx(admin, SFX.ADMIN);
  admin.sendMessage(`§a[Bank Admin] Dikurangi §f${fmt(deducted)} §aKoin dari §f${tgt.name}. Saldo: §e${fmt(getCoin(tgt))}`);
  tgt.sendMessage(`§c[Bank] Admin mengurangi §c${fmt(deducted)} Koin§c. Saldo: §e${fmt(getCoin(tgt))}`);
}

async function adminSetTax(admin) {
  const settings = getSettings();
  const res = await new ModalFormData()
    .title("§l  Ubah Pajak  §r")
    .slider(
      `§f Pajak §7(saat ini: §f${settings.taxPct}%§7)`,
      0,
      50,
      { valueStep: 1, defaultValue: settings.taxPct }
    )
    .show(admin);

  if (res.canceled) return;

  const newTax = Math.floor(Number(res.formValues?.[0] ?? settings.taxPct));
  if (!Number.isFinite(newTax) || newTax < 0 || newTax > 50) {
    admin.sendMessage("§c[Bank] Nilai pajak tidak valid."); return;
  }

  settings.taxPct = newTax;
  saveSettings(settings);
  playSfx(admin, SFX.ADMIN);
  admin.sendMessage(`§a[Bank Admin] Pajak diubah ke §f${newTax}%`);
  world.sendMessage(`§e[Bank] Pajak transfer diubah menjadi §f${newTax}%.`);
}

async function adminResetDaily(admin) {
  const target = await pickOnlinePlayer(admin, "Reset Limit Harian");
  if (!target) return;

  const used    = getDailyUsed(target.id);
  const confirm = await new MessageFormData()
    .title("§l  Reset Limit?  §r")
    .body(`§f Reset limit harian §c${target.name}§f?\n§7 Terpakai: §e${fmt(used)} §7/ §e${fmt(CFG.DAILY_LIMIT)}`)
    .button1("§7 Batal").button2("§a Reset").show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;
  dp.del(CFG.K_DAILY + target.id);
  playSfx(admin, SFX.ADMIN);
  admin.sendMessage(`§a[Bank Admin] Limit harian §f${target.name} §adireset.`);
  const tgt = world.getPlayers().find(p => p.id === target.id);
  if (tgt) tgt.sendMessage("§a[Bank] Limit transfer harianmu direset oleh admin.");
}

async function adminClearHistory(admin) {
  const target  = await pickOnlinePlayer(admin, "Hapus Riwayat");
  if (!target) return;

  const confirm = await new MessageFormData()
    .title("§l  Hapus Riwayat?  §r")
    .body(`§f Hapus riwayat §c${target.name}§f?\n§c Tidak bisa diurungkan!`)
    .button1("§7 Batal").button2("§c Hapus").show(admin);

  if (confirm.canceled || confirm.selection !== 1) return;
  dp.del(CFG.K_HIST + target.id);
  playSfx(admin, SFX.ADMIN);
  admin.sendMessage(`§a[Bank Admin] Riwayat §f${target.name} §adihapus.`);
}

async function adminViewBalances(admin) {
  const sorted = [...world.getPlayers()].sort((a, b) => getCoin(b) - getCoin(a));
  let body     = `${CFG.HR}\n§e Saldo Player Online\n${CFG.HR}\n`;
  for (const p of sorted)
    body += `§a[O] §f${p.name}  §e${fmt(getCoin(p))} Koin\n§8    Limit: ${fmt(getDailyUsed(p.id))} / ${fmt(CFG.DAILY_LIMIT)}\n`;

  await new ActionFormData()
    .title("§l  Saldo Player  §r")
    .body(body + CFG.HR)
    .button("§l Kembali")
    .show(admin);
}

async function pickOnlinePlayer(admin, title) {
  const players = world.getPlayers().filter(p => p.id !== admin.id);
  if (!players.length) { admin.sendMessage("§c[Bank] Tidak ada player lain online."); return null; }

  const form = new ActionFormData()
    .title(`§l  ${title}  §r`)
    .body(`${CFG.HR}\n§7 Pilih player:\n${CFG.HR}`);
  for (const p of players)
    form.button(`§a[O] §f${p.name}\n§e${fmt(getCoin(p))} Koin`);
  form.button("§l Kembali");

  const res = await form.show(admin);
  if (res.canceled || res.selection === players.length) return null;
  return players[res.selection];
}

// ═══════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════
system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name:            "lt:bank",
        description:     "Buka menu Bank Koin",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!checkCooldown(player)) {
          system.run(() => player.sendMessage("§c[Bank] Tunggu sebentar!"));
          return;
        }
        if (activeSessions.has(player.id)) return;
        system.run(() => openBankMenu(player).catch(e => console.error("[Bank] error:", e)));
        return { status: 0 };
      }
    );
    console.log("[Bank] /lt:bank registered.");
  } catch (e) { console.warn("[Bank] Command registration failed:", e); }
});

world.beforeEvents.chatSend.subscribe(event => {
  const msg = event.message.trim();
  if (msg !== "!bank" && msg.toLowerCase() !== "bank") return;
  event.cancel = true;
  const player = event.sender;
  if (!checkCooldown(player)) {
    system.run(() => player.sendMessage("§c[Bank] Tunggu sebentar!"));
    return;
  }
  if (activeSessions.has(player.id)) return;
  system.run(() => openBankMenu(player).catch(e => console.error("[Bank] error:", e)));
});

system.afterEvents.scriptEventReceive.subscribe(ev => {
  if (ev.id !== "bank:open") return;
  const src = ev.sourceEntity;
  if (!src || typeof src.hasTag !== "function") return;
  if (activeSessions.has(src.id)) return;
  system.run(() => openBankMenu(src).catch(e => console.error("[Bank] error:", e)));
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

      flushPendingNotifs(live);

      const reqs = getIncomingReqs(live.id);
      if (reqs.length > 0) {
        playSfx(live, SFX.REQUEST);
        live.sendMessage(
          `§e[Bank] Kamu punya §f${reqs.length} §epermintaan koin masuk!\n§8 Buka /bank -> Permintaan`
        );
      }
    } catch {}
  }, 100);
});

world.afterEvents.playerLeave.subscribe(ev => {
  bankCooldown.delete(ev.playerId);
  activeSessions.delete(ev.playerId);
  lockSet.delete(ev.playerId);
});

console.log("[Bank] Bank Koin aktif. Trigger: /lt:bank atau ketik 'bank' di chat.");