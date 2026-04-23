// Bank/main.js

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG } from "./config.js";
import { getByteLength } from "../dp_manager.js";

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
      const byteLen = getByteLength(str);
      if (byteLen > 30_000)
        console.warn(`[Bank] dp.set WARNING: "${k}" ${byteLen} bytes (limit 32KB)`);
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
// DAILY LIMIT + FREE TRANSFER COUNTER
// ═══════════════════════════════════════════════════════════
const todayStr = () => new Date().toISOString().slice(0, 10);

function _getDailyRaw(playerId) {
  return dp.get(CFG.K_DAILY + playerId, { total: 0, date: "", freeUsed: 0 });
}

function getDailyUsed(playerId) {
  const d = _getDailyRaw(playerId);
  return d.date === todayStr() ? d.total : 0;
}

function getFreeLeft(playerId) {
  const d = _getDailyRaw(playerId);
  const used = d.date === todayStr() ? (d.freeUsed || 0) : 0;
  return Math.max(0, CFG.FREE_TRANSFERS - used);
}

function addDailyUsed(playerId, amount, usedFree, cachedRaw) {
  const today = todayStr();
  const d     = cachedRaw ?? _getDailyRaw(playerId);
  if (d.date !== today) { d.total = 0; d.freeUsed = 0; }
  d.date   = today;
  d.total += amount;
  if (usedFree) d.freeUsed = (d.freeUsed || 0) + 1;
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

// [PERF] removeReq: langsung baca+tulis 1x, tanpa panggil getIncomingReqs (yang bisa tulis lagi)
function removeReq(playerId, reqId) {
  const reqs = dp.get(CFG.K_REQ_IN + playerId, []);
  const filtered = reqs.filter(r => r.id !== reqId);
  if (filtered.length) dp.set(CFG.K_REQ_IN + playerId, filtered);
  else dp.del(CFG.K_REQ_IN + playerId);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
// [PERF] Settings di-cache — hindari dp.get() berulang tiap getTax()
let _settingsCache = null;
const getSettings  = ()  => {
  if (!_settingsCache) _settingsCache = dp.get(CFG.K_SETTINGS, { taxPct: CFG.TAX_PERCENT });
  return _settingsCache;
};
const saveSettings = (s) => { _settingsCache = s; dp.set(CFG.K_SETTINGS, s); };
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
// EXECUTE TRANSFER — atomic dengan lock, supports free transfer
// ═══════════════════════════════════════════════════════════
async function executeTransfer(from, to, amount, note = "") {
  return withLock(from.id, () => {
    const dailyRaw = _getDailyRaw(from.id);
    const today    = todayStr();
    const daily    = dailyRaw.date === today ? dailyRaw.total : 0;
    const freeUsed = dailyRaw.date === today ? (dailyRaw.freeUsed || 0) : 0;
    const isFree   = freeUsed < CFG.FREE_TRANSFERS;

    const tax      = isFree ? 0 : calcTax(amount);
    const totalOut = amount + tax;

    if (daily + totalOut > CFG.DAILY_LIMIT)  return { ok: false, err: "daily_limit" };

    const curBal = getCoin(from);
    if (curBal < totalOut)                   return { ok: false, err: "insufficient" };

    setCoin(from, curBal - totalOut);
    addCoin(to, amount);
    addDailyUsed(from.id, totalOut, isFree, dailyRaw);

    const ts = Date.now();
    pushHistory(from.id, { type: "sent",     to:   to.name,   amount, tax, note, ts });
    pushHistory(to.id,   { type: "received", from: from.name, amount,       note, ts });
    pushGlobalLog({ from: from.name, to: to.name, amount, tax, note, ts });

    return { ok: true, amount, tax, totalOut, isFree };
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

    let body = `${CFG.HR}\n`;
    body += `§6§l  B A N K   K O I N\n`;
    body += `${CFG.HR}\n\n`;
    body += `  §6⛃ §eSaldo\n`;
    body += `  §8└ §e${fmt(coin)} Koin\n\n`;
    body += `  §e◆ §eInfo\n`;
    body += `  §8├ §ePajak §8── §f${getTax()}%\n`;
    body += `  §8└ §eLimit §8── §f${fmt(daily)}§8/${fmt(CFG.DAILY_LIMIT)} §8(§e${dailyPct}%§8)\n`;
    body += `\n${CFG.HR}`;

    const btns = [];
    const form = new ActionFormData().title("§l§8 ♦ §6BANK KOIN§r§l §8♦ §r").body(body);

    form.button(`§e§l  Transfer Koin\n§r  §8Kirim ke player lain`); btns.push("transfer");
    form.button(`§b§l  Minta Koin\n§r  §8Request dari player lain`); btns.push("request");
    form.button(`§a§l  Permintaan${reqBadge}\n§r  §8${reqs.length ? `${reqs.length} menunggu` : "Tidak ada"}`); btns.push("inbox");
    form.button(`§f§l  Mutasi Saya\n§r  §810 transaksi terakhir`); btns.push("history");
    form.button(`§6§l  Top Koin\n§r  §8Leaderboard saldo`); btns.push("top");
    if (isAdmin) { form.button(`§c§l  Admin\n§r  §8Kelola bank`); btns.push("admin"); }
    form.button("§8§l  Tutup"); btns.push("close");

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
      .title("§l§8 ♦ §eTRANSFER§r§l §8♦ §r")
      .body(`${CFG.HR}\n§c Tidak ada player online lain.\n${CFG.HR}`)
      .button("§6§l  ◀ Kembali").show(player);
    return;
  }

  const form1 = new ActionFormData()
    .title("§l§8 ♦ §eTRANSFER§r§l §8♦ §r")
    .body(`${CFG.HR}\n§8 Pilih player tujuan:\n${CFG.HR}`);
  for (const p of others)
    form1.button(`§a§l  ${p.name}\n§r  §e${fmt(getCoin(p))}⛃`);
  form1.button("§6§l  ◀ Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === others.length) return;
  const target = others[res1.selection];

  // Step 2: Input jumlah
  const myCoin = getCoin(player);
  const remain = Math.min(CFG.MAX_TRANSFER, CFG.DAILY_LIMIT - getDailyUsed(player.id));
  const freeLeft = getFreeLeft(player.id);

  const freeInfo = freeLeft > 0
    ? `§a GRATIS ${freeLeft}x tersisa §7(tanpa pajak)`
    : `§7 Pajak: §f${getTax()}% §7(ditambah ke jumlah)`;

  const res2 = await new ModalFormData()
    .title(`§l  Transfer ke ${target.name}  §r`)
    .textField(
      `§f Jumlah\n§7 Saldo: §e${fmt(myCoin)} §7| Min: §e${fmt(CFG.MIN_TRANSFER)} §7| Maks: §e${fmt(remain)}\n${freeInfo}`,
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

  // Free transfer: skip tax if quota available
  const isFree = getFreeLeft(player.id) > 0;
  const taxAmt = isFree ? 0 : calcTax(amount);
  const total  = amount + taxAmt;
  if (myCoin < total) {
    player.sendMessage(`§c[Bank] Saldo tidak cukup! Butuh §f${fmt(total)}` + (taxAmt > 0 ? ` §c(${fmt(amount)} + pajak ${fmt(taxAmt)}).` : `.`));
    return;
  }

  // Step 3: Konfirmasi
  const taxLine = isFree
    ? `§f Pajak   : §a GRATIS §7(sisa ${getFreeLeft(player.id) - 1}x setelah ini)\n`
    : `§f Pajak   : §c-${fmt(taxAmt)} Koin\n`;

  const confirm = await new MessageFormData()
    .title("§l  Konfirmasi Transfer  §r")
    .body(
      `${CFG.HR}\n` +
      `§f Kepada  : §a${target.name}\n` +
      `§f Jumlah  : §e${fmt(amount)} Koin\n` +
      taxLine +
      `${CFG.HR}\n` +
      `§f Total   : ${isFree ? "§e" : "§c"}${fmt(total)} Koin\n` +
      `§f Sisa    : §e${fmt(myCoin - total)} Koin\n` +
      (note ? `§f Catatan : §7${note}\n` : "") +
      `${CFG.HR}`
    )
    .button1("§f Batal")
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
    `§7 Pajak  : ${result.isFree ? "§a GRATIS" : `§c${fmt(result.tax)} Koin`}\n` +
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
      .title("§l§8 ♦ §bMINTA KOIN§r§l §8♦ §r")
      .body(`${CFG.HR}\n§c Tidak ada player online lain.\n${CFG.HR}`)
      .button("§6§l  ◀ Kembali").show(player);
    return;
  }

  const inboxCounts = new Map();
  for (const p of others) inboxCounts.set(p.id, getIncomingReqs(p.id).length);

  const form1 = new ActionFormData()
    .title("§l§8 ♦ §bMINTA KOIN§r§l §8♦ §r")
    .body(`${CFG.HR}\n§8 Pilih player:\n${CFG.HR}`);
  for (const p of others) {
    const full = (inboxCounts.get(p.id) ?? 0) >= CFG.MAX_PENDING_REQ;
    form1.button(`${full ? "§8§l" : "§a§l"}  ${p.name}\n§r  §e${fmt(getCoin(p))}⛃`);
  }
  form1.button("§6§l  ◀ Kembali");

  const res1 = await form1.show(player);
  if (res1.canceled || res1.selection === others.length) return;
  const target = others[res1.selection];

  // [PERF] Gunakan cached count, bukan panggil getIncomingReqs lagi
  if ((inboxCounts.get(target.id) ?? 0) >= CFG.MAX_PENDING_REQ) {
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
        .title("§l§8 ♦ §aPERMINTAAN§r§l §8♦ §r")
        .body(`${CFG.HR}\n§8 Tidak ada permintaan masuk.\n${CFG.HR}`)
        .button("§6§l  ◀ Kembali").show(player);
      return;
    }

    const form = new ActionFormData()
      .title(`§l§8 ♦ §aPERMINTAAN §f(${reqs.length})§r§l §8♦ §r`)
      .body(`${CFG.HR}\n§8 Pilih permintaan:\n${CFG.HR}`);
    for (const r of reqs)
      form.button(`§f§l  ${r.fromName}\n§r  §e${fmt(r.amount)}⛃ §8| §f${minsLeft(r)}mnt`);
    form.button("§6§l  ◀ Kembali");

    const res = await form.show(player);
    if (res.canceled || res.selection === reqs.length) return;

    const req    = reqs[res.selection];
    const myCoin = getCoin(player);
    const freeLeft = getFreeLeft(player.id);
    const isFreePreview = freeLeft > 0;
    const tax    = isFreePreview ? 0 : calcTax(req.amount);
    const total  = req.amount + tax;

    const taxLine = isFreePreview
      ? `§f Pajak   : §a GRATIS §7(sisa ${freeLeft - 1}x setelah ini)\n`
      : `§f Pajak   : §c-${fmt(tax)} Koin\n`;

    const detail = await new ActionFormData()
      .title(`§l§8 ♦ §f${req.fromName}§r§l §8♦ §r`)
      .body(
        `${CFG.HR}\n` +
        `  §eDari   §8── §a${req.fromName}\n` +
        `  §eJumlah §8── §e${fmt(req.amount)}⛃\n` +
        `  §eAlasan §8── §f${req.reason}\n` +
        `${CFG.HR}\n` +
        taxLine +
        `  §eTotal  §8── ${isFreePreview ? "§e" : "§c"}${fmt(total)}⛃\n` +
        `  §eSaldo  §8── §e${fmt(myCoin)}⛃\n` +
        `  §8Sisa: ${minsLeft(req)} menit\n` +
        `${CFG.HR}`
      )
      .button("§c§l  Tolak")
      .button(myCoin >= total ? "§a§l  Terima" : "§8§l  Saldo Kurang")
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
      `§7 Jumlah : §e${fmt(result.amount)} §7(pajak: ${result.isFree ? "§a GRATIS" : `§c${fmt(result.tax)}`}§7)\n` +
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
  const hist = getHistory(player.id).slice(0, 10);

  let body = `${CFG.HR}\n§6§l  M U T A S I\n${CFG.HR}\n`;

  if (!hist.length) {
    body += "\n§8 Belum ada riwayat transaksi.\n";
  } else {
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      const isSent = h.type === "sent";

      body += `\n§f${i + 1}. `;

      if (isSent) {
        const totalKeluar = h.amount + (h.tax ?? 0);
        body += `§c▼ Kirim §8── §fke §a${h.to ?? "?"}\n`;
        body += `§8   §c-${fmt(totalKeluar)}⛃`;
        if ((h.tax ?? 0) > 0)
          body += ` §8(pajak §c${fmt(h.tax)}§8)`;
      } else {
        body += `§a▲ Terima §8── §fdari §a${h.from ?? "?"}\n`;
        body += `§8   §a+${fmt(h.amount)}⛃`;
      }

      if (h.note && h.note.trim()) {
        body += `\n§8   Catatan: §f${h.note}`;
      }

      body += `\n§8   ${timeAgo(h.ts)}\n`;
    }
  }

  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§l§8 ♦ §fMUTASI§r§l §8♦ §r")
    .body(body)
    .button("§6§l  ◀ Kembali")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// UI: LEADERBOARD
// ═══════════════════════════════════════════════════════════
async function uiLeaderboard(player) {
  const entries = getCoinLeaderboard(10);
  const medals  = ["§6§l1.", "§f§l2.", "§e§l3."];
  let body      = `${CFG.HR}\n§6§l  T O P   K O I N\n${CFG.HR}\n\n`;

  if (!entries.length) {
    body += "§8 Belum ada data.\n";
  } else {
    entries.forEach((e, i) => {
      const rank   = i < 3 ? medals[i] : `§8${i + 1}.`;
      const status = e.isOnline ? "§a" : "§8";
      body += `  ${rank} ${status}${e.name}  §e${fmt(e.coin)}⛃\n`;
    });
  }

  await new ActionFormData()
    .title("§l§8 ♦ §6TOP KOIN§r§l §8♦ §r")
    .body(body + `\n${CFG.HR}`)
    .button("§6§l  ◀ Kembali")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// UI: ADMIN
// ═══════════════════════════════════════════════════════════
async function uiAdmin(player) {
  if (!player.hasTag(CFG.ADMIN_TAG)) { player.sendMessage("§c[Bank] Akses ditolak."); return; }

  while (true) {
    const settings = getSettings();
    let ab = `${CFG.HR}\n`;
    ab += `§c§l  A D M I N\n`;
    ab += `${CFG.HR}\n\n`;
    ab += `  §eAdmin  §8── §a${player.name}\n`;
    ab += `  §ePajak  §8── §f${settings.taxPct}%\n`;
    ab += `  §eOnline §8── §f${world.getPlayers().length} player\n`;
    ab += `\n${CFG.HR}`;

    const form = new ActionFormData()
      .title("§l§8 ♦ §cADMIN§r§l §8♦ §r")
      .body(ab)
      .button("§a§l  Beri Koin\n§r  §8Tambah saldo player")
      .button("§c§l  Kurangi Koin\n§r  §8Potong saldo player")
      .button("§e§l  Ubah Pajak\n§r  §8Persentase transfer")
      .button("§b§l  Reset Limit\n§r  §8Reset limit harian")
      .button("§c§l  Hapus Riwayat\n§r  §8Hapus mutasi player")
      .button("§f§l  Lihat Saldo\n§r  §8Semua player online")
      .button("§6§l  Log Global\n§r  §8Mutasi terakhir")
      .button("§8§l  ◀ Kembali");

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
    .button1("§f Batal").button2("§a Reset").show(admin);

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
    .button1("§f Batal").button2("§c Hapus").show(admin);

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
    .title(`§l§8 ♦ §f${title.toUpperCase()}§r§l §8♦ §r`)
    .body(`${CFG.HR}\n§8 Pilih player:\n${CFG.HR}`);
  for (const p of players)
    form.button(`§a§l  ${p.name}\n§r  §e${fmt(getCoin(p))}⛃`);
  form.button("§6§l  ◀ Kembali");

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
