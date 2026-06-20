// SLO: Penalty success >= 99.9%. Kill reward atomic >= 99.9%.
//      Failure -> console.warn, no crash. Max 3 intervals.
import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { isPurgeActive } from "../purge_gate.js";
import { ActionFormData } from "@minecraft/server-ui";
import { CFG } from "./config.js";
import { getTPS, getTPSColor } from "../MobuXP/monitor/tps_tracker.js";
import { UIClose } from "../ui_close.js";
import { pGet, pSet, getOnlinePlayer } from "../player_dp.js";
import { trackFlow } from "../eco_flow.js";
import { getKillFx, setKillFx, spawnKillEffect, playKillFxSound, broadcastKillFxSound, evictKillFxCache, pruneKillFxCache } from "../kill_fx.js";
import { getGem, deductGem } from "../gacha/utils/scoreboard.js";
import { isEidActive, getToken, addToken, deductToken, getEidQuestInfo } from "../eid_quest.js";
import "./knockback.js"; // KB v2 — self-contained, auto-subscribes to entityHurt


const dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try { world.setDynamicProperty(k, JSON.stringify(v)); }
    catch { }
  },
  del: (k) => { try { world.setDynamicProperty(k, undefined); } catch { } },
};

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
    ensureCoinObj()?.setScore(player.scoreboardIdentity ?? player, Math.floor(n));
    return true;
  } catch {
    return false;
  }
}


const fmt = (n) => Math.floor(n).toLocaleString("id-ID");

const SFX = {
  TOGGLE_ON: { id: "random.anvil_use", pitch: 1.2, vol: 0.8 },
  TOGGLE_OFF: { id: "random.click", pitch: 0.8, vol: 0.7 },
  KILL: { id: "random.levelup", pitch: 1.5, vol: 1.0 },
  DEATH: { id: "note.bass", pitch: 0.5, vol: 1.0 },
  BLOCKED: { id: "note.bass", pitch: 0.7, vol: 0.5 },
  MENU: { id: "random.click", pitch: 1.3, vol: 0.7 },
};
const sfx = (p, s) => { try { p.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch { } };

/**
 * Kick player — runs from server dimension context (full permission).
 * Must be called from within system.run / system.runTimeout context.
 */
function kickPlayer(playerName, reason) {
  const safeName = playerName.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  try {
    const r = world.getDimension("overworld").runCommand(`kick "${safeName}" ${reason}`);
    if (r.successCount <= 0) console.warn(`[PvP-Kick] successCount=0: ${playerName}`);
  } catch (e) {
    console.warn(`[PvP-Kick] failed: ${e}`);
  }
}

const toggleCooldown = new Map();
const killCooldown = new Map();
const globalKillCD = new Map();
const combatTagUntil = new Map();
const pvpActiveUntil = new Map();
const graceUntil = new Map();
const activeSessions = new Set();
const pvpActivePlayers = new Set();
const _warnCooldown = new Map();
const lastAttacker = new Map();
const _pvpHitSpam = new Map();
const _victimKillCD = new Map();
const playerJoinTime = new Map();

const combatStatsCache = new Map();
const combatStatsDirty = new Set();
const hudOnCache = new Map();
let killLogCache = null;
let killLogDirty = false;
let lbCache = null;
let lbDirty = false;

function getTpsDisplay() {
  const t = getTPS();
  return `${getTPSColor(t)}${t.toFixed(1)}`;
}

let _landCache = null;
let _landCacheTick = 0;
function getLandAreas() {
  const now = system.currentTick;
  if (_landCache && now - _landCacheTick < 200) return _landCache;
  try {
    const cc = world.getDynamicProperty(`${CFG.LAND_DP_KEY}_chunks`);
    if (!cc) { _landCache = []; _landCacheTick = now; return []; }
    let raw = "";
    for (let i = 0; i < cc; i++) raw += world.getDynamicProperty(`${CFG.LAND_DP_KEY}_chunk_${i}`) || "";
    _landCache = JSON.parse(raw) || [];
  } catch { _landCache = []; }
  _landCacheTick = now;
  return _landCache;
}

function isInProtectedLand(player) {
  try {
    const loc = player.location;
    const dim = player.dimension.id;
    for (const area of getLandAreas()) {
      if (!area?.from || !area?.to || area.dimension !== dim) continue;
      const x1 = Math.min(area.from.x, area.to.x), x2 = Math.max(area.from.x, area.to.x);
      const y1 = Math.min(area.from.y, area.to.y), y2 = Math.max(area.from.y, area.to.y);
      const z1 = Math.min(area.from.z, area.to.z), z2 = Math.max(area.from.z, area.to.z);
      if (loc.x >= x1 && loc.x <= x2 && loc.y >= y1 && loc.y <= y2 && loc.z >= z1 && loc.z <= z2) return true;
    }
  } catch { }
  return false;
}

function getStats(pid) {
  if (combatStatsCache.has(pid)) return combatStatsCache.get(pid);
  const def = { kills: 0, deaths: 0, earned: 0, lost: 0, streak: 0, bestStreak: 0, lastKillTs: 0 };
  const p = getOnlinePlayer(pid);
  const v = p ? pGet(p, CFG.K_STATS, def) : dp.get(CFG.K_STATS + pid, def);
  combatStatsCache.set(pid, v);
  return v;
}
function setStats(pid, s) {
  combatStatsCache.set(pid, s);
  combatStatsDirty.add(pid);
}

function getKillLog() {
  if (killLogCache === null) killLogCache = dp.get(CFG.K_LOG, []);
  return killLogCache;
}
function pushKillLog(kn, vn, amt) {
  const log = getKillLog();
  log.unshift({ k: kn, v: vn, c: amt, t: Date.now() });
  if (log.length > 15) log.splice(15);
  killLogDirty = true;
}

function isHudOn(pid) {
  if (hudOnCache.has(pid)) return hudOnCache.get(pid);
  const p = getOnlinePlayer(pid);
  const v = p ? pGet(p, CFG.K_HUD_ENABLED, true) : dp.get(CFG.K_HUD_ENABLED + pid, true);
  hudOnCache.set(pid, v);
  return v;
}
function setHudOn(pid, v) {
  hudOnCache.set(pid, v);
  const p = getOnlinePlayer(pid);
  if (p) pSet(p, CFG.K_HUD_ENABLED, v);
  else dp.set(CFG.K_HUD_ENABLED + pid, v);
}

function getPlayerStatus(player) {
  let hp = 20, maxHp = 20, armor = 0, weapon = "Tangan Kosong";
  try {
    const hc = player.getComponent("minecraft:health");
    if (hc) { hp = hc.currentValue; maxHp = hc.effectiveMax; }
  } catch { }
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) {
      const held = inv.getItem(player.selectedSlotIndex);
      if (held) weapon = held.typeId.replace("minecraft:", "").replace(/_/g, " ");
      const eq = player.getComponent("minecraft:equippable");
      if (eq) {
        const slots = ["Head", "Chest", "Legs", "Feet"];
        const vals = { leather: 1, chainmail: 2, iron: 3, golden: 2, diamond: 4, netherite: 5 };
        for (const s of slots) {
          try {
            const item = eq.getEquipment(s);
            if (item) {
              for (const [k, v] of Object.entries(vals)) {
                if (item.typeId.includes(k)) { armor += v; break; }
              }
            }
          } catch { }
        }
      }
    }
  } catch { }
  const inCombat = (combatTagUntil.get(player.id) ?? 0) > system.currentTick;
  const isGrace = (graceUntil.get(player.id) ?? 0) > system.currentTick;
  return { hp, maxHp, armor, weapon, inCombat, isGrace };
}

function getStreakMult(streak) {
  let m = 1;
  for (const t of CFG.STREAK_MULTIPLIER) { if (streak >= t.min) m = t.mult; }
  return m;
}

function progressBar(cur, max, w = 10) {
  if (max <= 0) return "§8" + "░".repeat(w);
  const r = Math.min(cur / max, 1), f = Math.floor(r * w), e = w - f;
  if (r >= 1) return "§a" + "█".repeat(w);
  if (r >= 0.5) return "§2" + "█".repeat(f) + "§8" + "░".repeat(e);
  if (r >= 0.25) return "§e" + "█".repeat(f) + "§8" + "░".repeat(e);
  return "§c" + "█".repeat(f) + "§8" + "░".repeat(e);
}

function isPvPOn(player) {
  return player.hasTag(CFG.PVP_TAG);
}

function togglePvP(player) {
  const now = system.currentTick;
  const lastToggle = toggleCooldown.get(player.id) ?? -999;
  if (now - lastToggle < CFG.TOGGLE_CD_TICKS) {
    const remain = Math.ceil((CFG.TOGGLE_CD_TICKS - (now - lastToggle)) / 20);
    player.sendMessage(`§8[§cPvP§8]§c Tunggu §f${remain} detik §csebelum toggle lagi.`);
    sfx(player, SFX.BLOCKED);
    return "cooldown";
  }
  if (isPvPOn(player)) {
    if ((combatTagUntil.get(player.id) ?? 0) > now) {
      const remain = Math.ceil(((combatTagUntil.get(player.id) ?? 0) - now) / 20);
      player.sendMessage(`§8[§cPvP§8]§c Dalam pertarungan! Tunggu §f${remain}s`);
      sfx(player, SFX.BLOCKED);
      return "combat_tag";
    }
    toggleCooldown.set(player.id, now);
    player.removeTag(CFG.PVP_TAG);
    pvpActivePlayers.delete(player.id);
    pvpActiveUntil.delete(player.id);
    graceUntil.delete(player.id);
    sfx(player, SFX.TOGGLE_OFF);
    player.sendMessage(`§8[§aPvP§8]§a §7PvP nonaktif.`);
    return "off";
  } else {
    const coin = getCoin(player);
    if (coin < CFG.MIN_COIN_TO_ENABLE) {
      player.sendMessage(`§8[§cPvP§8]§c Koin tidak cukup!\n§7Minimal §e${fmt(CFG.MIN_COIN_TO_ENABLE)} Koin §7untuk aktifkan PvP.\n§7Saldo: §c${fmt(coin)} Koin`);
      sfx(player, SFX.BLOCKED);
      return "no_coin";
    }
    toggleCooldown.set(player.id, now);
    player.addTag(CFG.PVP_TAG);
    pvpActivePlayers.add(player.id);
    graceUntil.set(player.id, now + CFG.SAFE_TICKS);
    sfx(player, SFX.TOGGLE_ON);
    player.sendMessage(`§8[§aPvP§8]§a §cPvP AKTIF!\n§7Grace: §f5 detik\n§c[!] Bisa diserang setelah grace habis!`);
    return "on";
  }
}


async function showPvPMenu(player) {
  if (activeSessions.has(player.id)) return;
  activeSessions.add(player.id);

  try {
    while (true) {
      const isOn = isPvPOn(player);
      const stats = getStats(player.id);
      const coin = getCoin(player);
      const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : stats.kills.toFixed(0);
      const st = getPlayerStatus(player);
      const hudOn = isHudOn(player.id);
      const mult = getStreakMult(stats.streak);

      let nearbyEnemies = 0;
      try {
        for (const p of world.getPlayers()) {
          if (p.id === player.id || !isPvPOn(p)) continue;
          const d = player.location;
          const e = p.location;
          const distSq = (d.x - e.x) ** 2 + (d.y - e.y) ** 2 + (d.z - e.z) ** 2;
          if (distSq <= 400) nearbyEnemies++;
        }
      } catch { }

      let body = `${CFG.HR}\n`;
      body += `§c  ★ C O M B A T   P v P\n`;
      body += `${CFG.HR}\n\n`;

      body += `  §eStatus §8── ${isOn ? "§cAKTIF §l>>§r" : "§aNONAKTIF"}\n`;
      if (st.inCombat) body += `  §c  [!] DALAM PERTARUNGAN!\n`;
      body += `\n`;

      body += `  §6* §eStatus Player\n`;
      body += `${CFG.HR_THIN}\n`;
      body += `  §8\u251c §cHP     §8\u2500\u2500 ${progressBar(st.hp, st.maxHp, 8)} §f${Math.floor(st.hp)}§8/${Math.floor(st.maxHp)}\n`;
      body += `  §8\u251c §bArmor  §8\u2500\u2500 §f${st.armor} pts\n`;
      body += `  §8\u251c §fSenjata§8\u2500\u2500 §f${st.weapon}\n`;
      body += `  §8\u2514 §eKoin   §8\u2500\u2500 §e${fmt(coin)}\n\n`;

      body += `  §c>> §eStatistik\n`;
      body += `${CFG.HR_THIN}\n`;
      body += `  §8\u251c §7K/D    §8\u2500\u2500 §f${stats.kills}§7/§f${stats.deaths} §8(§e${kd}§8)\n`;
      body += `  §8\u251c §7Streak §8\u2500\u2500 §f${stats.streak} §8(Best: §e${stats.bestStreak}§8)\n`;
      body += `  §8\u251c §7Multi  §8\u2500\u2500 §e${mult}x\n`;
      body += `  §8\u251c §aDapat  §8\u2500\u2500 §a+${fmt(stats.earned)} Koin\n`;
      body += `  §8\u2514 §cHilang §8\u2500\u2500 §c-${fmt(stats.lost)} Koin\n\n`;

      body += `  §e> §eInfo\n`;
      body += `${CFG.HR_THIN}\n`;
      body += `  §8\u251c §7Musuh  §8\u2500\u2500 ${nearbyEnemies > 0 ? `§c${nearbyEnemies} nearby` : `§a0 aman`}\n`;
      body += `  §8\u251c §7HUD    §8\u2500\u2500 ${hudOn ? "§aON" : "§cOFF"}\n`;
      body += `  §8\u2514 §7Min K  §8\u2500\u2500 §e${fmt(CFG.MIN_COIN_TO_ENABLE)}\n`;
      body += `\n${CFG.HR}`;

      const btns = [];
      const form = new ActionFormData()
        .title("§8 >> §cCOMBAT PvP§r §8<< §r")
        .body(body);

      form.button("§c  Cara Kerja PvP\n§r  §8Info sistem otomatis", "textures/items/iron_sword");
      btns.push("info");
      form.button("§f  Kill Log\n§r  §8Riwayat pertarungan", "textures/items/book_writable");
      btns.push("log");
      form.button("§e  Leaderboard\n§r  §8Top killer", "textures/items/diamond");
      btns.push("lb");
      {
        const curFx = getKillFx(player.id);
        const _k = (id) => Array.isArray(id) ? JSON.stringify(id) : id;
        const curEffect = CFG.KILL_EFFECTS.find(e => _k(e.id) === _k(curFx.active));
        form.button(`§d  Kill Effect\n§r  §8${curEffect?.name ?? "Koin"}`, "textures/items/nether_star");
        btns.push("killfx");
      }
      form.button("§b  Pengaturan HUD\n§r  §8Toggle actionbar stats", "textures/items/compass_item");
      btns.push("settings");
      form.button("§c  Tutup", "textures/items/redstone_dust");
      btns.push("close");

      sfx(player, SFX.MENU);
      const res = await form.show(player);
      if (res.canceled) throw new UIClose();
      if (btns[res.selection] === "close") return;

      switch (btns[res.selection]) {
        case "info": await showPvPInfo(player); break;
        case "log": await showKillLog(player); break;
        case "lb": await showLeaderboard(player); break;
        case "killfx": await showKillFxMenu(player); break;
        case "settings": await showSettings(player); break;
      }
    }
  } catch (e) { if (!e?.isUIClose && !String(e).includes("FormReject")) throw e; }
  finally {
    activeSessions.delete(player.id);
  }
}

async function showPvPInfo(player) {
  let body = `${CFG.HR}\n`;
  body += `\u00a7c  CARA KERJA PvP\n`;
  body += `${CFG.HR}\n\n`;
  body += `  \u00a7eSistem PvP \u00a7fOTOMATIS:\n\n`;
  body += `  \u00a7c1. \u00a7fPukul player lain\n`;
  body += `  \u00a78   \u2192 PvP-mu \u00a7cotomatis aktif\n`;
  body += `  \u00a78   \u2192 Hit pertama \u00a77tidak melukai\n\n`;
  body += `  \u00a7c2. \u00a7fLawan pukul balik\n`;
  body += `  \u00a78   \u2192 PvP lawan \u00a7cotomatis aktif\n`;
  body += `  \u00a78   \u2192 Pertarungan dimulai!\n\n`;
  body += `  \u00a7c3. \u00a7fSetelah \u00a7e${Math.floor(CFG.PVP_AUTO_OFF_TICKS / 20)}s \u00a7ftanpa bertarung\n`;
  body += `  \u00a78   \u2192 PvP \u00a7aotomatis nonaktif\n\n`;
  body += `  \u00a7eSYARAT\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  \u00a78\u251c \u00a7fMinimal \u00a7e${fmt(CFG.MIN_COIN_TO_ENABLE)} Koin\n`;
  body += `  \u00a78\u251c \u00a7fTidak berlaku di area \u00a72Land\n`;
  body += `  \u00a78\u2514 \u00a7fKill = \u00a7adapat \u00a77${CFG.KILL_REWARD_PCT}%% koin korban\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("\u00a78 >> \u00a7cINFO PVP\u00a7r \u00a78<< \u00a7r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function showSettings(player) {
  const curOn = isHudOn(player.id);
  const coin = getCoin(player);

  let body = `${CFG.HR}\n`;
  body += `§b  P E N G A T U R A N\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §eHUD Combat Stats (Actionbar)\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8\u251c §7Status  §8\u2500\u2500 ${curOn ? "§aAKTIF" : "§cNONAKTIF"}\n`;
  body += `  §8\u251c §eKoin  §8\u2500\u2500 §e${fmt(coin)} §8(Min: §e${fmt(CFG.MIN_COIN_TO_ENABLE)}§8)\n\n`;
  body += `  §8\u2514 §8Stats tampil di bawah layar saat PvP aktif.\n`;
  body += `\n${CFG.HR}`;

  const form = new ActionFormData()
    .title("§8 >> §bSETTINGS §8<< §r")
    .body(body);

  form.button(curOn
    ? "§c  Matikan HUD Stats\n§r  §8Sembunyikan actionbar stats"
    : "§a  Aktifkan HUD Stats\n§r  §8Tampilkan stats di actionbar", "textures/items/compass_item");

  form.button("§6  Kembali", "textures/items/arrow");

  const res = await form.show(player);
  if (res.canceled || res.selection === 1) return;

  if (res.selection === 0) {
    const newVal = !curOn;
    setHudOn(player.id, newVal);
    sfx(player, newVal ? SFX.TOGGLE_ON : SFX.TOGGLE_OFF);
    player.sendMessage(`§b[HUD] Stats: ${newVal ? "§aAKTIF" : "§cNONAKTIF"}`);
  }
}

// Module-level helpers for KillFX ID comparison (avoid closure per call)
const _fxIdKey = (id) => Array.isArray(id) ? JSON.stringify(id) : id;
const _fxIdMatch = (a, b) => _fxIdKey(a) === _fxIdKey(b);

// ── Social Proof: KillFX owner count (DP-backed, real data) ──
function _getFxOwnerCount(fxId) {
  const key = `fxoc:${_fxIdKey(fxId)}`;
  return Number(world.getDynamicProperty(key) ?? 0);
}
function _incrementFxOwnerCount(fxId) {
  const key = `fxoc:${_fxIdKey(fxId)}`;
  const cur = Number(world.getDynamicProperty(key) ?? 0);
  try { world.setDynamicProperty(key, cur + 1); } catch { }
  return cur + 1;
}

// Build KillFX menu body text
function _buildFxMenuBody(fx, coin, gem, tokenBal, isAdmin = false) {
  const curEffect = CFG.KILL_EFFECTS.find(e => _fxIdMatch(e.id, fx.active));
  const isOwned = (id) => isAdmin || fx.owned.some(o => _fxIdKey(o) === _fxIdKey(id));

  let body = `${CFG.HR}\n§d  K I L L   E F F E C T\n${CFG.HR}\n\n`;
  if (isAdmin) body += `  §6★ §eMODE ADMIN §8— §aSemua efek terbuka\n\n`;
  body += `  §eEfek Aktif §8\u2500\u2500 §d${curEffect?.name ?? "Koin"}\n`;
  body += `  §eKoin §8\u2500\u2500 §e${fmt(coin)} ⛃  §8|  §bGem §8\u2500\u2500 §b${fmt(gem)} ✦\n`;
  body += `  §6Shard §8\u2500\u2500 §6${fmt(tokenBal)} ◆\n`;
  body += `  §7Efek bersifat §apermanen §7& bisa di-export!\n`;
  if (!isAdmin) body += `  §6◆ §7Beli efek wajib butuh §6Shard§7.\n`;
  body += `\n`;

  for (const eff of CFG.KILL_EFFECTS) {
    const owned = isOwned(eff.id);
    const active = _fxIdMatch(fx.active, eff.id);
    const tkReq = (eff.tokenCost ?? 0) > 0 ? ` §6+${eff.tokenCost}◆` : "";
    if (active) body += `  §d> §f${eff.name} §d[AKTIF]\n`;
    else if (owned) body += `  §a> §f${eff.name} §a[Dimiliki]\n`;
    else if (eff.currency === "gem") body += `  §8> §7${eff.name} §b${fmt(eff.cost)} ✦Gem${tkReq} §d[PREMIUM]\n`;
    else if (eff.cost > 0) body += `  §8> §7${eff.name} §e${fmt(eff.cost)} ⛃Koin${tkReq}\n`;
    else body += `  §8> §7${eff.name} §aGratis\n`;
  }

  // Collection progress bar — Achiever motivation (Bartle taxonomy)
  const totalFx = CFG.KILL_EFFECTS.length;
  const ownedFx = CFG.KILL_EFFECTS.filter(e => isOwned(e.id)).length;
  const pct = Math.floor((ownedFx / totalFx) * 100);
  const barW = 8;
  const filled = Math.floor((ownedFx / totalFx) * barW);
  const bar = "§a" + "█".repeat(filled) + "§7" + "░".repeat(barW - filled);
  body += `\n  §eKoleksi: §a${ownedFx}§8/§e${totalFx} §8(§e${pct}%%§8)\n`;
  body += `  §8[${bar}§8]\n`;
  if (ownedFx >= totalFx) body += `  §6★ §aSemua efek terkumpul! §6★\n`;

  body += `\n${CFG.HR}`;
  return body;
}

// Handle KillFX purchase flow (split from showKillFxMenu for §8.1 compliance)
async function _handleFxPurchase(player, sel) {
  const isGem = sel.eff.currency === "gem";
  const curBal = isGem ? getGem(player) : getCoin(player);
  const unit = isGem ? "✦Gem" : "⛃Koin";
  const color = isGem ? "§b" : "§e";
  const needToken = sel.eff.tokenCost ?? 0;
  const curToken = needToken > 0 ? getToken(player) : 0;

  if (curBal < sel.eff.cost) {
    player.sendMessage(`§d[KillFX] §c${isGem ? "Gem" : "Koin"} tidak cukup! §7Butuh ${color}${fmt(sel.eff.cost)} ${unit}§7, punya ${color}${fmt(curBal)} ${unit}`);
    sfx(player, SFX.BLOCKED); return false;
  }
  if (needToken > 0 && curToken < needToken) {
    player.sendMessage(`§d[KillFX] §c§6Shard §ctidak cukup! §7Butuh §6${needToken} ◆§7, punya §6${curToken} ◆\n§7Dapatkan shard dari quest event aktif.`);
    sfx(player, SFX.BLOCKED); return false;
  }

  let cb = `${CFG.HR}\n§e  Beli Kill Effect?\n${CFG.HR}\n\n`;
  cb += `  §fEfek:  §d${sel.eff.name}${isGem ? " §d\u2605PREMIUM" : ""}\n`;
  cb += `  §fHarga: ${color}${fmt(sel.eff.cost)} ${unit}\n`;
  if (needToken > 0) cb += `  §fShard: §6${needToken} ◆\n`;
  cb += `  §fSaldo: ${color}${fmt(curBal)} ${unit}\n`;
  cb += `  §fSisa:  ${color}${fmt(curBal - sel.eff.cost)} ${unit}\n`;
  if (needToken > 0) cb += `  §fShard sisa: §6${curToken - needToken} ◆\n`;
  cb += `  §7Efek bersifat §apermanen §7— tidak hilang!\n\n${CFG.HR}`;

  const cf = new ActionFormData().title("§8 >> §eKONFIRMASI§r §8<< §r").body(cb)
    .button("§a  Beli dan Pakai\n§r  §8Langsung aktifkan", sel.eff.icon)
    .button("§c  Batal", "textures/items/arrow");
  const cRes = await cf.show(player);
  if (cRes.canceled || cRes.selection === 1) return false;

  // Real-time balance re-check after await
  const freshBal = isGem ? getGem(player) : getCoin(player);
  if (freshBal < sel.eff.cost) { player.sendMessage(`§d[KillFX] §cSaldo berubah! Tidak cukup.`); sfx(player, SFX.BLOCKED); return false; }
  if (needToken > 0 && getToken(player) < needToken) {
    player.sendMessage(`§d[KillFX] §cShard berubah! Tidak cukup.`);
    sfx(player, SFX.BLOCKED); return false;
  }

  // Atomic: deduct token first
  if (needToken > 0) {
    if (!deductToken(player, needToken)) {
      player.sendMessage(`§d[KillFX] §cGagal memproses shard.`);
      return false;
    }
  }
  // Deduct currency
  let deductOk;
  if (isGem) {
    deductOk = deductGem(player, sel.eff.cost);
    if (deductOk) trackFlow("killfx_purchase_gem", -sel.eff.cost);
  } else {
    deductOk = setCoin(player, freshBal - sel.eff.cost);
    if (deductOk) trackFlow("killfx_purchase", -sel.eff.cost);
  }
  if (!deductOk) {
    // Safe refund token
    if (needToken > 0) try { addToken(player, needToken); } catch { }
    player.sendMessage(`§d[KillFX] §cGagal memproses pembelian.`); return false;
  }

  // Unlock + activate
  const latestFx = getKillFx(player.id);
  if (!latestFx.owned.some(o => _fxIdKey(o) === _fxIdKey(sel.eff.id))) latestFx.owned.push(sel.eff.id);
  latestFx.active = sel.eff.id;
  setKillFx(player.id, latestFx);

  broadcastKillFxSound(player);
  const afterBal = isGem ? getGem(player) : getCoin(player);
  let successMsg = `§d[KillFX] §aBerhasil membeli §d${sel.eff.name}§a!\n§7  Saldo: ${color}${fmt(afterBal)} ${unit}`;
  if (needToken > 0) successMsg += `\n§7  Shard: §6${getToken(player)} ◆`;
  player.sendMessage(successMsg);
  system.run(() => { spawnKillEffect(player); });

  // Social Proof broadcast — Cialdini principle (real DP-backed count)
  const ownerCount = _incrementFxOwnerCount(sel.eff.id);
  world.sendMessage(
    `\n§8[§dKillFX§8] §a${player.name} §7membeli §d${sel.eff.name}§7!` +
    (isGem ? ` §b(${fmt(sel.eff.cost)} ✦Gem)` : ` §e(${fmt(sel.eff.cost)} ⛃Koin)`) +
    (needToken > 0 ? ` §6+${needToken}◆` : "") +
    `\n§8  └ §7Total pemilik: §a${ownerCount} player §8│ ` +
    `${sel.eff.category === "Premium" ? "§b★ Premium" : "§eEffect"}\n`
  );
  return true;
}

// Kill Effect Selection UI
async function showKillFxMenu(player) {
  const fx = getKillFx(player.id);
  const coin = getCoin(player);
  const gem = getGem(player);
  const tokenBal = getToken(player);
  const isAdmin = player.hasTag(CFG.ADMIN_TAG);
  const isOwned = (id) => isAdmin || fx.owned.some(o => _fxIdKey(o) === _fxIdKey(id));

  const body = _buildFxMenuBody(fx, coin, gem, tokenBal, isAdmin);
  const form = new ActionFormData().title("§8 >> §dKILL EFFECT§r §8<< §r").body(body);
  const btns = [];
  for (const eff of CFG.KILL_EFFECTS) {
    const owned = isOwned(eff.id), active = _fxIdMatch(fx.active, eff.id);
    if (active) { form.button(`§d  ${eff.name}\n§r  §dAKTIF`, eff.icon); btns.push({ action: "active", eff }); }
    else if (owned) { form.button(`§a  ${eff.name}\n§r  §8Tap untuk pakai`, eff.icon); btns.push({ action: "equip", eff }); }
    else {
      const label = eff.currency === "gem"
        ? `§b  ${eff.name}\n§r  §b${fmt(eff.cost)} ✦Gem §d\u2605`
        : `§e  ${eff.name}\n§r  §e${fmt(eff.cost)} ⛃Koin`;
      form.button(label, eff.icon); btns.push({ action: "buy", eff });
    }
  }
  form.button("§6  Kembali", "textures/items/arrow"); btns.push({ action: "back" });

  const res = await form.show(player);
  if (res.canceled) return;
  const sel = btns[res.selection];
  if (!sel) return; // bounds check — §3 safety
  if (sel.action === "back") return;
  if (sel.action === "active") { player.sendMessage(`§d[KillFX] §f${sel.eff.name} §7sudah aktif.`); await showKillFxMenu(player); return; }
  if (sel.action === "equip") {
    fx.active = sel.eff.id;
    // Admin bypass: auto-unlock effect to owned list for persistence
    if (isAdmin && !fx.owned.some(o => _fxIdKey(o) === _fxIdKey(sel.eff.id))) {
      fx.owned.push(sel.eff.id);
    }
    setKillFx(player.id, fx);
    sfx(player, SFX.TOGGLE_ON);
    player.sendMessage(`§d[KillFX] §aDiganti ke §d${sel.eff.name}§a!${isAdmin ? " §6(Admin)" : ""}`);
    await showKillFxMenu(player);
    return;
  }

  if (sel.action === "buy") {
    // Admin bypass: langsung unlock tanpa bayar
    if (isAdmin) {
      if (!fx.owned.some(o => _fxIdKey(o) === _fxIdKey(sel.eff.id))) fx.owned.push(sel.eff.id);
      fx.active = sel.eff.id;
      setKillFx(player.id, fx);
      sfx(player, SFX.TOGGLE_ON);
      player.sendMessage(`§d[KillFX] §6[Admin] §aUnlocked §d${sel.eff.name}§a!`);
      system.run(() => { spawnKillEffect(player); });
      await showKillFxMenu(player);
      return;
    }
    await _handleFxPurchase(player, sel);
    await showKillFxMenu(player);
  }
}




async function showKillLog(player) {
  const log = getKillLog();
  let body = `${CFG.HR}\n§c  KILL LOG\n${CFG.HR}\n\n`;

  if (!log.length) {
    body += "§8 Belum ada pertarungan tercatat.\n";
  } else {
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      const ago = timeAgo(e.t);
      body += `  §8${i + 1}. §a${e.k} §c\u2694 §c${e.v}\n`;
      body += `  §8   §e+${fmt(e.c)} Koin §8| ${ago}\n`;
    }
  }

  body += `\n${CFG.HR}`;
  await new ActionFormData()
    .title("§8 >> §fKILL LOG §8<< §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

function updateLeaderboard(name, pid) {
  const s = getStats(pid);
  if (s.kills <= 0 && s.deaths <= 0) return;
  if (!lbCache) lbCache = dp.get("c:lb", []);
  const idx = lbCache.findIndex(e => e.pid === pid);
  const entry = {
    pid, name, kills: s.kills, deaths: s.deaths,
    earned: s.earned, kd: s.deaths > 0 ? +(s.kills / s.deaths).toFixed(2) : s.kills,
  };
  if (idx >= 0) lbCache[idx] = entry;
  else lbCache.push(entry);
  lbCache.sort((a, b) => b.kills - a.kills);
  if (lbCache.length > 10) lbCache.length = 10;
  lbDirty = true; // Flush in periodic interval, not immediately
}

async function showLeaderboard(player) {
  const entries = lbCache ?? dp.get("c:lb", []);
  const medals = ["\u00a76\u00a7l1.", "\u00a7f\u00a7l2.", "\u00a7e\u00a7l3."];

  let body = `${CFG.HR}\n§c  TOP KILLER\n${CFG.HR}\n\n`;
  if (!entries.length) {
    body += "§8 Belum ada data.\n";
  } else {
    entries.slice(0, 10).forEach((e, i) => {
      const rank = i < 3 ? medals[i] : `§8${i + 1}.`;
      body += `  ${rank} §a${e.name}\n`;
      body += `  §8   §c${e.kills}K §8/ §7${e.deaths}D §8| §e+${fmt(e.earned)} Koin\n`;
    });
  }

  body += `\n${CFG.HR}`;
  await new ActionFormData()
    .title("§8 \u2726 §eTOP KILLER §8\u2726 §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

function timeAgo(ts) {
  if (!ts) return "?";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)}mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}jam lalu`;
  return `${Math.floor(s / 86400)}hr lalu`;
}

// ── Track players protected from fire due to non-PvP / land / grace hits ──
// When a player is hit by Fire Aspect but PvP is off, the initial damage is
// healed back but fire tick damage has no damagingEntity, so it slips through.
// This map ensures fire tick damage is also healed back for protected players.
const _nonPvpFireProtected = new Map(); // victimId -> tick

world.afterEvents.entityHurt.subscribe(ev => {
  // Skip PvP logic during Purge — all combat is unrestricted
  if (isPurgeActive()) return;
  const victim = ev.hurtEntity;
  const attacker = ev.damageSource?.damagingEntity;

  // ── Handle fire/indirect tick damage (no direct attacker) ──
  // Fire Aspect / Flame fire ticks have no damagingEntity.
  // If victim was recently protected from a non-PvP hit, heal back fire damage too.
  if (victim?.typeId === "minecraft:player" && !attacker) {
    const protTick = _nonPvpFireProtected.get(victim.id);
    if (protTick && (system.currentTick - protTick) <= CFG.LAST_ATTACKER_TICKS) {
      try {
        const h = victim.getComponent("minecraft:health");
        if (h) h.setCurrentValue(Math.min(h.currentValue + ev.damage, h.effectiveMax));
      } catch { }
      // Extinguish fire — must be deferred (afterEvents is read-only)
      system.run(() => {
        try { victim.extinguishFire(false); } catch { }
        try { victim.runCommand("effect @s fire_resistance 3 255 true"); } catch { }
      });
    }
    return;
  }

  if (!victim || !attacker) return;
  if (victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player") return;

  const healBack = () => {
    try {
      const h = victim.getComponent("minecraft:health");
      if (h) h.setCurrentValue(Math.min(h.currentValue + ev.damage, h.effectiveMax));
    } catch { }
  };

  // Helper: protect victim from subsequent fire tick damage
  // extinguishFire and runCommand are state-mutating — must use system.run
  const protectFromFire = () => {
    _nonPvpFireProtected.set(victim.id, system.currentTick);
    system.run(() => {
      try { victim.extinguishFire(false); } catch { }
      try { victim.runCommand("effect @s fire_resistance 3 255 true"); } catch { }
    });
  };

  let atkPvP = isPvPOn(attacker);
  const vicPvP = isPvPOn(victim);

  // ── Auto-PvP: attacker PvP OFF menyerang player lain ──
  if (!atkPvP && !pvpActivePlayers.has(attacker.id)) {
    const coin = getCoin(attacker);
    if (coin >= CFG.MIN_COIN_TO_ENABLE
      && !isInProtectedLand(attacker)
      && !isInProtectedLand(victim)) {
      pvpActivePlayers.add(attacker.id);
      atkPvP = true;

      const now = system.currentTick;
      pvpActiveUntil.set(attacker.id, now + CFG.PVP_AUTO_OFF_TICKS);
      toggleCooldown.set(attacker.id, now);
      graceUntil.delete(attacker.id);

      const ctTick = now + CFG.COMBAT_TAG_TICKS;
      combatTagUntil.set(attacker.id, Math.max(combatTagUntil.get(attacker.id) ?? 0, ctTick));
      lastAttacker.set(victim.id, { id: attacker.id, name: attacker.name, tick: now });
      _nonPvpFireProtected.delete(victim.id);
      _pvpHitSpam.delete(attacker.id);

      if (vicPvP) {
        combatTagUntil.set(victim.id, Math.max(combatTagUntil.get(victim.id) ?? 0, ctTick));
        pvpActiveUntil.set(victim.id, now + CFG.PVP_AUTO_OFF_TICKS);
        system.run(() => {
          try { attacker.addTag(CFG.PVP_TAG); } catch { }
          sfx(attacker, SFX.TOGGLE_ON);
          try { attacker.sendMessage(`§8[§cPvP§8]§c §ePvP aktif! §7Pertarungan dimulai.`); } catch { }
          try { victim.sendMessage(`§8[§cPvP§8]§c §f${attacker.name} §emulai melawanmu!`); } catch { }
        });
        return;
      } else {
        healBack();
        protectFromFire();
        system.run(() => {
          try { attacker.addTag(CFG.PVP_TAG); } catch { }
          sfx(attacker, SFX.TOGGLE_ON);
          try { attacker.sendMessage(`§8[§cPvP§8]§c §ePvP aktif! §7Menunggu lawan membalas.\n§8  Auto-off dalam §f${Math.floor(CFG.PVP_AUTO_OFF_TICKS / 20)}s §8jika tidak ada respon.`); } catch { }
          try { victim.sendMessage(`§8[§cPvP§8]§c §f${attacker.name} §7menantangmu! §ePukul balik §7untuk melawan.`); } catch { }
        });
        return;
      }
    }
    // Koin tidak cukup — 10s cooldown
    if (coin < CFG.MIN_COIN_TO_ENABLE) {
      const wk = `coin:${attacker.id}`;
      const nowMs = Date.now();
      if (nowMs - (_warnCooldown.get(wk) ?? 0) >= 10000) {
        _warnCooldown.set(wk, nowMs);
        healBack();
        protectFromFire();
        system.run(() => {
          try { attacker.sendMessage(`§8[§cPvP§8]§c §7Koin kurang! Minimal §e${fmt(CFG.MIN_COIN_TO_ENABLE)} Koin`); } catch { }
        });
      }
      return;
    }
  }

  if (!atkPvP || !vicPvP) {
    healBack();
    protectFromFire();

    // ── Hit spam detection (skip for admins — KB testing exempt) ──
    if (attacker.hasTag(CFG.ADMIN_TAG)) return; // Admin exempt from spam detection
    const atkId = attacker.id;
    const nowMs = Date.now();
    const hs = _pvpHitSpam.get(atkId) ?? { count: 0, first: nowMs };
    if (nowMs - hs.first > CFG.ILLEGAL_HIT_WINDOW_MS) { hs.count = 0; hs.first = nowMs; }
    hs.count++;
    _pvpHitSpam.set(atkId, hs);

    // Kick jika melebihi batas
    if (hs.count >= CFG.ILLEGAL_HIT_KICK_COUNT) {
      _pvpHitSpam.delete(atkId);
      const kickName = attacker.name;
      const kickVictimName = victim.name;
      system.run(() => {
        try { world.sendMessage(`§8[§4PvP§8]§4 §f${kickName} §cdikick: spam attack §f${kickVictimName}`); } catch { }
        system.runTimeout(() => {
          kickPlayer(kickName, `§cDikick: spam attack player`);
        }, 10);
      });
      return;
    }

    // Peringatan eskalasi — HANYA di hit 5, 10, 13 (tidak spam)
    if (hs.count === 5 || hs.count === 10 || hs.count === 13) {
      const remain = CFG.ILLEGAL_HIT_KICK_COUNT - hs.count;
      system.run(() => {
        try { attacker.sendMessage(`§8[§4PvP§8]§4 §cStop! §7Hit: §f${hs.count}/${CFG.ILLEGAL_HIT_KICK_COUNT} §8— sisa ${remain} sebelum kick`); } catch { }
      });
    }
    // Warning biasa — HANYA SEKALI per 10 detik per pasangan
    else if (hs.count === 1) {
      const pairWarnKey = `${attacker.id}>${victim.id}`;
      if (nowMs - (_warnCooldown.get(pairWarnKey) ?? 0) >= 10000) {
        _warnCooldown.set(pairWarnKey, nowMs);
        system.run(() => {
          try {
            if (atkPvP) {
              victim.sendMessage(`§8[§cPvP§8]§c §f${attacker.name} §7menantangmu! §ePukul balik §7untuk melawan.`);
            }
          } catch { }
        });
      }
    }
    return;
  }

  if (isInProtectedLand(victim) || isInProtectedLand(attacker)) {
    healBack();
    protectFromFire();
    // 5s cooldown land warning
    const landWarnKey = `land:${attacker.id}`;
    const nowMs = Date.now();
    if (nowMs - (_warnCooldown.get(landWarnKey) ?? 0) >= 5000) {
      _warnCooldown.set(landWarnKey, nowMs);
      system.run(() => { try { attacker.sendMessage(`§8[§ePvP§8]§e §7Area land — PvP dinonaktifkan.`); } catch { } });
    }
    return;
  }

  const now = system.currentTick;
  if (now < (graceUntil.get(victim.id) ?? 0)) {
    healBack();
    protectFromFire();
    system.run(() => attacker.sendMessage(`§8[§ePvP§8]§e §f${victim.name} §7masih dalam grace period!`));
    return;
  }

  // ── Valid PvP hit — clear fire protection if any ──
  _nonPvpFireProtected.delete(victim.id);

  const ctTick = now + CFG.COMBAT_TAG_TICKS;
  combatTagUntil.set(victim.id, Math.max(combatTagUntil.get(victim.id) ?? 0, ctTick));
  combatTagUntil.set(attacker.id, Math.max(combatTagUntil.get(attacker.id) ?? 0, ctTick));

  // ── Extend auto-off timer on every valid PvP hit ──
  const offTick = now + CFG.PVP_AUTO_OFF_TICKS;
  pvpActiveUntil.set(victim.id, Math.max(pvpActiveUntil.get(victim.id) ?? 0, offTick));
  pvpActiveUntil.set(attacker.id, Math.max(pvpActiveUntil.get(attacker.id) ?? 0, offTick));



  // ── Track last attacker untuk atribusi fire/indirect kill ──
  lastAttacker.set(victim.id, {
    id: attacker.id,
    name: attacker.name,
    tick: now,
  });
});

world.afterEvents.entityDie.subscribe(ev => {
  const victim = ev.deadEntity;
  if (!victim || victim.typeId !== "minecraft:player") return;
  // During Purge: skip coin rewards/penalties, but still allow kill FX
  if (isPurgeActive()) {
    const killer = ev.damageSource?.damagingEntity;
    if (killer?.typeId === "minecraft:player" && killer.id !== victim.id) {
      try { spawnKillEffect(killer, victim.location); } catch {}
      try { playKillFxSound(killer, victim.location); } catch {}
    }
    return;
  }

  let attacker = ev.damageSource?.damagingEntity;

  // ── Fallback: fire tick / indirect damage — resolve dari lastAttacker ──
  if (!attacker || attacker.typeId !== "minecraft:player") {
    const tracked = lastAttacker.get(victim.id);
    if (tracked && (system.currentTick - tracked.tick) <= CFG.LAST_ATTACKER_TICKS) {
      attacker = getOnlinePlayer(tracked.id) ?? null;
    }
    lastAttacker.delete(victim.id);
    _nonPvpFireProtected.delete(victim.id);
    if (!attacker || attacker.typeId !== "minecraft:player") return;
  } else {
    lastAttacker.delete(victim.id);
    _nonPvpFireProtected.delete(victim.id);
  }

  if (victim.id === attacker.id) return;

  const atkPvP = isPvPOn(attacker) || pvpActivePlayers.has(attacker.id);
  const vicPvP = isPvPOn(victim) || pvpActivePlayers.has(victim.id);

  if (!atkPvP || !vicPvP) {
    const now = Date.now();
    const atkId = attacker.id;

    // ── Persistent offense tracking — stored in DP, decays over time ──
    const offData = dp.get(CFG.K_OFFENSE + atkId, { count: 0, lastTs: 0 });
    // Decay: kurangi 1 offense per OFFENSE_DECAY_MS sejak terakhir
    if (offData.lastTs > 0 && offData.count > 0) {
      const elapsed = now - offData.lastTs;
      const decay = Math.floor(elapsed / CFG.OFFENSE_DECAY_MS);
      if (decay > 0) offData.count = Math.max(0, offData.count - decay);
    }
    offData.count++;
    offData.lastTs = now;
    dp.set(CFG.K_OFFENSE + atkId, offData);

    const offenseCount = offData.count;
    const tierIdx = Math.min(offenseCount - 1, CFG.OFFENSE_TIERS.length - 1);
    const tier = CFG.OFFENSE_TIERS[tierIdx];
    const totalTiers = CFG.OFFENSE_TIERS.length;

    // ── Hitung denda — clamp agar saldo tidak negatif ──
    const atkCoin = getCoin(attacker);
    const penalty = tier.penalty > 0 ? Math.min(tier.penalty, Math.max(0, atkCoin)) : 0;
    // [§2] Track flow only if scoreboard write actually succeeded.
    if (penalty > 0) {
      if (!setCoin(attacker, atkCoin - penalty)) {
        console.warn(`[Combat] penalty failed: attacker=${attacker.name} penalty=${penalty}`);
        return;
      }
      trackFlow("pvp_penalty", -penalty);
    }

    // ── Kompensasi korban (atomic — di luar system.run) ──
    let refund = 0;
    if (tier.victimRefundPct > 0 && penalty > 0) {
      refund = Math.floor(penalty * tier.victimRefundPct / 100);
      if (refund > 0) {
        const vicCoin = getCoin(victim);
        if (!setCoin(victim, vicCoin + refund)) {
          // Rollback attacker penalty
          setCoin(attacker, getCoin(attacker) + penalty);
          console.warn(`[Combat] refund failed, penalty rolled back: victim=${victim.name}`);
          refund = 0;
        } else {
          trackFlow("pvp_refund", refund);
        }
      }
    }

    // ── Defer pesan ke korban via cdm: (victim mungkin dead) ──
    dp.set("cdm:" + victim.id, {
      killer: attacker.name, lost: 0, refund, illegal: true,
      penaltyAmount: tier.penalty, ts: now,
    });

    system.run(() => {
      sfx(attacker, SFX.DEATH);

      // ── Pesan ke pelaku ──
      attacker.sendMessage(
        `§8[§4PvP§8]§4 ${tier.label}\n` +
        `§cKamu membunuh §f${victim.name} §c${!atkPvP ? "tanpa PvP aktif" : "yang PvP-nya nonaktif"}!\n` +
        (penalty > 0 ? `§c  Denda: §e-${fmt(penalty)} Koin\n` : "") +
        `§c  Pelanggaran: §f${offenseCount} §8(Tier ${tierIdx + 1}/${totalTiers})\n` +
        (tier.debuff ? `${tier.debuff.msg}\n` : "") +
        (tier.dropInventory ? `§4  INVENTORY DIJATUHKAN!\n` : "") +
        (tier.tempbanMs > 0 ? `§4  TEMPBAN: §f${Math.floor(tier.tempbanMs / 60000)} menit!\n` : "") +
        `§7  Saldo: §e${fmt(getCoin(attacker))} Koin`
      );

      // ── Broadcast ──
      world.sendMessage(
        `§8[§4PvP§8]§4 §f${attacker.name} §cmembunuh §f${victim.name} §csecara ilegal!\n` +
        `§c  Denda: §e${fmt(penalty)} Koin §8| ${tier.label}`
      );

      // ── Debuff (tier 1-3) ──
      if (tier.debuff) {
        for (const eff of tier.debuff.effects) {
          try { attacker.runCommand(`effect @s ${eff}`); } catch { }
        }
      }

      // ── DROP INVENTORY (tier 3+) — buang semua item pelaku ──
      if (tier.dropInventory) {
        try {
          const inv = attacker.getComponent("minecraft:inventory")?.container;
          if (inv) {
            const loc = attacker.location;
            const dim = attacker.dimension;
            for (let i = 0; i < inv.size; i++) {
              try {
                const item = inv.getItem(i);
                if (!item) continue;
                // [§2] Anti-dupe: clear inventory FIRST, then spawn. If spawn
                // fails, item is gone but no duplicate exists.
                inv.setItem(i);
                try { dim.spawnItem(item, { x: loc.x, y: loc.y, z: loc.z }); }
                catch (e) { console.warn(`[Combat] drop spawn fail slot=${i}:`, e); }
              } catch { }
            }
          }
          // Drop armor juga
          const eq = attacker.getComponent("minecraft:equippable");
          if (eq) {
            const slots = ["Head", "Chest", "Legs", "Feet", "Offhand"];
            const loc = attacker.location;
            const dim = attacker.dimension;
            for (const slot of slots) {
              try {
                const item = eq.getEquipment(slot);
                if (!item) continue;
                eq.setEquipment(slot);
                try { dim.spawnItem(item, { x: loc.x, y: loc.y, z: loc.z }); }
                catch (e) { console.warn(`[Combat] drop spawn fail slot=${slot}:`, e); }
              } catch { }
            }
          }
        } catch { }
        try { attacker.sendMessage(`§4§l  ⚠ SEMUA ITEM DAN ARMOR DIJATUHKAN!`); } catch { }
      }

      // ── Tempban ──
      if (tier.tempbanMs > 0 && !tier.permaban) {
        const banUntil = now + tier.tempbanMs;
        dp.set(CFG.K_TEMPBAN + atkId, { until: banUntil, reason: `Membunuh player non-PvP (Tier ${tierIdx + 1})` });
        const mins = Math.floor(tier.tempbanMs / 60000);
        const kickName = attacker.name;
        attacker.sendMessage(`§8[§4PvP§8]§4 §cKamu di-TEMPBAN selama §f${mins} menit §ckarena pelanggaran berulang!`);
        system.runTimeout(() => {
          kickPlayer(kickName, `§cTempban ${mins} menit: membunuh player non-PvP berulang kali`);
        }, 20);
      }

      // ── PERMANENT BAN (tier 3+) ──
      if (tier.permaban) {
        // Set ban sampai tahun 2099 = permanent
        dp.set(CFG.K_TEMPBAN + atkId, { until: 4_102_444_800_000, reason: `PERMABAN: Membunuh player non-PvP ${offenseCount}x`, permanent: true });
        const kickName = attacker.name;
        attacker.sendMessage(`§8[§4§lPvP§8]§4§l KAMU DI-BAN PERMANENT DARI SERVER!\n§cAlasan: Membunuh player non-PvP ${offenseCount} kali.`);
        world.sendMessage(`§8[§4§lPERMABAN§8]§4§l §f${kickName} §cdi-ban permanent: membunuh player non-PvP ${offenseCount}x!`);
        system.runTimeout(() => {
          kickPlayer(kickName, `§4PERMANENT BAN: Membunuh player non-PvP berulang kali (${offenseCount}x)`);
        }, 20);
      }
    });
    return;
  }

  const now = Date.now();

  // ── Victim-side kill CD — prevent alt/multi-account farming ──
  if (now - (_victimKillCD.get(victim.id) ?? 0) < 30_000) {
    system.run(() => attacker.sendMessage(`§8[§ePvP§8]§e §f${victim.name} §7baru saja mati. Tunggu sebentar.`));
    return;
  }
  const pairKey = `${attacker.id}:${victim.id}`;
  if (now - (killCooldown.get(pairKey) ?? 0) < CFG.KILL_CD_MS) {
    system.run(() => attacker.sendMessage(`§8[§ePvP§8]§e Kill cooldown! §7Tunggu sebelum farm §f${victim.name}`));
    return;
  }
  if (now - (globalKillCD.get(attacker.id) ?? 0) < CFG.GLOBAL_KILL_CD_MS) {
    system.run(() => attacker.sendMessage(`§8[§ePvP§8]§e §7Global cooldown aktif!`));
    return;
  }
  killCooldown.set(pairKey, now);
  globalKillCD.set(attacker.id, now);
  _victimKillCD.set(victim.id, now);

  const atkStats = getStats(attacker.id);
  const prevStreak = (now - (atkStats.lastKillTs || 0) > CFG.STREAK_DECAY_MS) ? 0 : atkStats.streak;

  // ── Session earn cap — prevent whale farming (§5.2) ──
  const _earnCapped = atkStats.earned >= CFG.SESSION_EARN_CAP;

  // ── Anti-alt farming: victim harus online >= 5 menit ──
  const vicOnlineMs = Date.now() - (playerJoinTime.get(victim.id) ?? Date.now());
  if (vicOnlineMs < CFG.MIN_VICTIM_ONLINE_MS) {
    // Hukuman berat — denda maksimal + drop inventory
    const atkCoin = getCoin(attacker);
    const altPenalty = Math.min(CFG.ALT_FARM_PENALTY, Math.max(0, atkCoin));
    if (altPenalty > 0) {
      if (setCoin(attacker, atkCoin - altPenalty)) {
        trackFlow("pvp_alt_farm_penalty", -altPenalty);
      }
    }
    // Drop inventory
    system.run(() => {
      try {
        const inv = attacker.getComponent("minecraft:inventory")?.container;
        if (inv) {
          const loc = attacker.location;
          const dim = attacker.dimension;
          for (let i = 0; i < inv.size; i++) {
            try {
              const item = inv.getItem(i);
              if (!item) continue;
              inv.setItem(i);
              try { dim.spawnItem(item, { x: loc.x, y: loc.y, z: loc.z }); } catch { }
            } catch { }
          }
        }
        const eq = attacker.getComponent("minecraft:equippable");
        if (eq) {
          for (const slot of ["Head", "Chest", "Legs", "Feet", "Offhand"]) {
            try {
              const item = eq.getEquipment(slot);
              if (!item) continue;
              eq.setEquipment(slot);
              try { attacker.dimension.spawnItem(item, attacker.location); } catch { }
            } catch { }
          }
        }
      } catch { }
      attacker.sendMessage(
        `§8[§4PvP§8]§4 §c⚠ ALT FARMING TERDETEKSI!\n` +
        `§cKorban baru online §f${Math.floor(vicOnlineMs / 1000)}s §c(min ${Math.floor(CFG.MIN_VICTIM_ONLINE_MS / 60000)} menit)\n` +
        (altPenalty > 0 ? `§c  Denda: §e-${fmt(altPenalty)} Koin\n` : "") +
        `§4  INVENTORY DIJATUHKAN!\n` +
        `§7  Saldo: §e${fmt(getCoin(attacker))} Koin`
      );
      sfx(attacker, SFX.DEATH);
      world.sendMessage(`§8[§4PvP§8]§4 §f${attacker.name} §cterdeteksi alt farming! Denda §e${fmt(altPenalty)} Koin`);
    });
    // Refund victim — kembalikan koin yang hilang (0 karena belum dipotong)
    dp.set("cdm:" + victim.id, { killer: attacker.name, lost: 0, refund: 0, illegal: true, penaltyAmount: altPenalty, ts: Date.now() });
    // Tetap catat death untuk victim
    const vicStats = getStats(victim.id);
    vicStats.deaths++;
    setStats(victim.id, vicStats);
    return;
  }

  const victimCoins = getCoin(victim);
  const attackerCoins = getCoin(attacker);
  let actualGain = 0, actualLoss = 0;
  // Guard: no transfer if earn capped, victim has no coins, or victim coins negative
  if (victimCoins > 0 && !_earnCapped) {
    const mult = getStreakMult(prevStreak);
    let reward = Math.floor(victimCoins * CFG.KILL_REWARD_PCT / 100 * mult);
    reward = Math.min(CFG.MAX_REWARD, Math.max(CFG.MIN_REWARD, reward));
    actualLoss = Math.min(reward, victimCoins);
    actualGain = actualLoss;
    // [§2] Atomic 2-phase. Rollback victim if attacker credit fails — never destroy/create.
    if (setCoin(victim, victimCoins - actualLoss)) {
      if (!setCoin(attacker, attackerCoins + actualGain)) {
        // Rollback victim
        setCoin(victim, victimCoins);
        console.warn(`[Combat] PvP transfer aborted: attacker credit failed ${attacker.name}`);
        actualGain = 0; actualLoss = 0;
      } else {
        // Track net-zero internal transfer for audit (income to attacker, sink from victim).
        trackFlow("pvp_kill_transfer", actualGain);
      }
    } else {
      console.warn(`[Combat] PvP transfer aborted: victim deduct failed ${victim.name}`);
      actualGain = 0; actualLoss = 0;
    }
  }

  atkStats.streak = prevStreak;
  atkStats.kills++;
  atkStats.earned += actualGain;
  if (actualGain > 0) {
    atkStats.streak++;
    atkStats.lastKillTs = now;
  }
  if (atkStats.streak > atkStats.bestStreak) atkStats.bestStreak = atkStats.streak;
  setStats(attacker.id, atkStats);

  const vicStats = getStats(victim.id);
  vicStats.deaths++;
  vicStats.lost += actualLoss;
  vicStats.streak = 0;
  setStats(victim.id, vicStats);

  pushKillLog(attacker.name, victim.name, actualGain);
  updateLeaderboard(attacker.name, attacker.id);
  updateLeaderboard(victim.name, victim.id);
  const streakBonus = atkStats.streak >= 3 ? ` §6(${atkStats.streak}x STREAK!)` : "";
  // Resolve FX name for kill feed (social proof — players see FX names → curiosity → buy)
  const _atkFx = getKillFx(attacker.id);
  const _atkFxEff = CFG.KILL_EFFECTS.find(e => _fxIdMatch(e.id, _atkFx.active));
  const _atkFxName = _atkFxEff?.name ?? "Koin";

  system.run(() => {
    playKillFxSound(attacker);

    // ── Spawn kill effect particle (player-chosen) saat dapat koin dari PvP kill ──
    if (actualGain > 0) {
      spawnKillEffect(attacker);
    }

    let killMsg = `§8[§aPvP§8]§a §c>> §fKamu membunuh §c${victim.name}!\n§a  +${fmt(actualGain)} Koin${streakBonus}\n§7  Saldo: §e${fmt(getCoin(attacker))} Koin`;
    if (_earnCapped) killMsg += `\n§e  [Earning cap — tidak dapat koin]`;
    attacker.sendMessage(killMsg);
    // Kill feed with FX name — awareness trigger untuk KillFX
    const fxTag = (_atkFx.active && _atkFx.active !== "Games:coins" && _atkFx.active !== "none")
      ? ` §8│ §d${_atkFxName}` : "";
    if (atkStats.streak >= 3) {
      world.sendMessage(`  §c§f${attacker.name} §f${victim.name} §e+${fmt(actualGain)}${fxTag}${streakBonus}`);
    } else if (actualGain > 0) {
      world.sendMessage(`  §c§f${attacker.name} §f${victim.name} §e+${fmt(actualGain)}${fxTag}`);
    }
  });

  dp.set("cdm:" + victim.id, { killer: attacker.name, lost: actualLoss, ts: now });
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (isPvPOn(player)) pvpActivePlayers.add(player.id);
  if (!playerJoinTime.has(player.id)) playerJoinTime.set(player.id, Date.now());

  system.runTimeout(() => {
    // ── Tempban enforcement — kick jika masih dalam masa ban ──
    const ban = dp.get(CFG.K_TEMPBAN + player.id, null);
    if (ban && ban.until > Date.now()) {
      const remainMs = ban.until - Date.now();
      const mins = Math.ceil(remainMs / 60000);
      const kickName = player.name; // capture immediately
      player.sendMessage(`§8[§4PvP§8]§4 §cKamu masih di-TEMPBAN!\n§c  Sisa: §f${mins} menit\n§7  Alasan: ${ban.reason ?? "Pelanggaran PvP"}`);
      system.runTimeout(() => {
        kickPlayer(kickName, `§cTempban: sisa ${mins} menit. ${ban.reason ?? ""}`);
      }, 20);
      return;
    }
    // Hapus ban yang sudah expired
    if (ban) dp.del(CFG.K_TEMPBAN + player.id);

    const debt = dp.get(CFG.K_DEBT + player.id, 0);
    if (debt > 0) {
      const cur = getCoin(player);
      const loss = Math.min(debt, cur);
      if (loss > 0) {
        // [§2] Apply penalty FIRST, then update debt — atomic ordering.
        if (setCoin(player, cur - loss)) {
          const remaining = debt - loss;
          if (remaining > 0) dp.set(CFG.K_DEBT + player.id, remaining);
          else dp.del(CFG.K_DEBT + player.id);
          trackFlow("pvp_penalty", -loss);
        } else {
          console.warn(`[Combat] debt-apply failed: keep debt=${debt} for ${player.name}`);
        }
      } else {
        // Debt persist — jangan hapus, tunggu sampai punya koin
        player.sendMessage(`§8[§cPvP§8]§c §7Hutang §e${fmt(debt)} \u26c3 §7belum lunas (koin 0).`);
      }
      if (loss > 0) {
        player.sendMessage(`§8[§cPvP§8]§c §4Combat Log Penalty!\n§c  -${fmt(loss)} \u26c3 §7(disconnect saat combat)\n§7  Saldo: §e${fmt(getCoin(player))} \u26c3`);
        sfx(player, SFX.DEATH);
      }
    }
    const deathMsg = dp.get("cdm:" + player.id, null);
    if (deathMsg) {
      dp.del("cdm:" + player.id);
      sfx(player, SFX.DEATH);
      if (deathMsg.illegal) {
        let ilMsg = `§8[§ePvP§8]§e §f${deathMsg.killer} §cmembunuhmu secara ilegal!`;
        if (deathMsg.penaltyAmount > 0) ilMsg += `\n§a  Pelaku didenda §e${fmt(deathMsg.penaltyAmount)} Koin`;
        if (deathMsg.refund > 0) ilMsg += `\n§a  Kompensasi: §e+${fmt(deathMsg.refund)} Koin`;
        ilMsg += `\n§7  Saldo: §e${fmt(getCoin(player))} \u26c3`;
        player.sendMessage(ilMsg);
      } else {
        player.sendMessage(`§8[§cPvP§8]§c §fDibunuh oleh §c${deathMsg.killer}!\n§c  -${fmt(deathMsg.lost)} \u26c3\n§7  Saldo: §e${fmt(getCoin(player))} \u26c3`);
      }
    }
  }, 20);
});

system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    if (!isPvPOn(player)) continue;

    // ── Auto-OFF: PvP mati otomatis setelah idle ──
    const idleAt = pvpActiveUntil.get(player.id) ?? 0;
    if (idleAt > 0 && now > idleAt) {
      try { player.removeTag(CFG.PVP_TAG); } catch { }
      pvpActivePlayers.delete(player.id);
      pvpActiveUntil.delete(player.id);
      combatTagUntil.delete(player.id);
      graceUntil.delete(player.id);
      try {
        player.sendMessage(`§8[§aPvP§8]§a §7PvP otomatis nonaktif §8— tidak ada pertarungan.`);
        sfx(player, SFX.TOGGLE_OFF);
      } catch { }
      continue;
    }

    const idleRemain = Math.max(0, Math.ceil((idleAt - now) / 20));
    // Hapus actionbar jika timer sudah 0 (jangan tampilkan "PvP 0s")
    if (idleRemain === 0) {
      try { player.onScreenDisplay.setActionBar(""); } catch { }
    } else {
      try { player.onScreenDisplay.setActionBar(`§cPvP §4${idleRemain}s`); } catch { }
    }
  }
}, CFG.HUD_INT);

system.runInterval(() => {
  const now = Date.now();
  const tick = system.currentTick;
  for (const [k, v] of Array.from(killCooldown)) { if (now - v > CFG.KILL_CD_MS * 2) killCooldown.delete(k); }
  for (const [k, v] of Array.from(globalKillCD)) { if (now - v > CFG.GLOBAL_KILL_CD_MS * 2) globalKillCD.delete(k); }
  for (const [k, v] of Array.from(_warnCooldown)) { if (now - v > 30000) _warnCooldown.delete(k); }
  for (const [k, v] of Array.from(lastAttacker)) { if (tick - v.tick > CFG.LAST_ATTACKER_TICKS * 2) lastAttacker.delete(k); }
  for (const [k, v] of Array.from(_nonPvpFireProtected)) { if (tick - v > CFG.LAST_ATTACKER_TICKS * 2) _nonPvpFireProtected.delete(k); }
  for (const [k, v] of Array.from(_pvpHitSpam)) { if (now - v.first > CFG.ILLEGAL_HIT_WINDOW_MS * 2) _pvpHitSpam.delete(k); }
  for (const [k, v] of Array.from(_victimKillCD)) { if (now - v > 60000) _victimKillCD.delete(k); }
  for (const [k, v] of Array.from(playerJoinTime)) { if (!getOnlinePlayer(k)) playerJoinTime.delete(k); }
  // Cleanup stale toggleCooldown & pvpActiveUntil for offline players
  for (const [k, v] of Array.from(toggleCooldown)) { if (tick - v > CFG.TOGGLE_CD_TICKS * 4) toggleCooldown.delete(k); }
  for (const [k, v] of Array.from(pvpActiveUntil)) { if (tick > v) pvpActiveUntil.delete(k); }
}, 6000);

system.runInterval(() => {
  // [§5.3] Per-item try/catch — kalau 1 player gagal flush, jangan loose dirty state lain.
  for (const pid of [...combatStatsDirty]) {
    try {
      const s = combatStatsCache.get(pid);
      if (!s) { combatStatsDirty.delete(pid); continue; }
      const p = getOnlinePlayer(pid);
      if (p) pSet(p, CFG.K_STATS, s);
      else dp.set(CFG.K_STATS + pid, s);
      combatStatsDirty.delete(pid);
    } catch (e) {
      console.warn(`[Combat] flush stats fail pid=${pid}:`, e);
      // Stays in dirty — retry next interval.
    }
  }
  if (killLogDirty && killLogCache !== null) {
    try {
      dp.set(CFG.K_LOG, killLogCache);
      killLogDirty = false;
    } catch (e) { console.warn("[Combat] kill log flush:", e); }
  }
  if (lbDirty && lbCache !== null) {
    try {
      dp.set("c:lb", lbCache);
      lbDirty = false;
    } catch (e) { console.warn("[Combat] lb flush:", e); }
  }

  // ── Cache eviction: prevent unbounded growth ──
  if (combatStatsCache.size > 50) {
    for (const pid of combatStatsCache.keys()) {
      if (!getOnlinePlayer(pid) && !combatStatsDirty.has(pid)) combatStatsCache.delete(pid);
    }
  }
  if (hudOnCache.size > 50) {
    for (const pid of hudOnCache.keys()) {
      if (!getOnlinePlayer(pid)) hudOnCache.delete(pid);
    }
  }
  pruneKillFxCache();
}, 200);

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      { name: "lt:pvp", description: "Buka Combat PvP Menu", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => showPvPMenu(player));
        return { status: 0 };
      }
    );
    init.customCommandRegistry.registerCommand(
      { name: "lt:pvpon", description: "Info PvP", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => { player.sendMessage(`\u00a7e[PvP] \u00a77PvP sekarang otomatis! Pukul player untuk memulai pertarungan.`); });
        return { status: 0 };
      }
    );
    init.customCommandRegistry.registerCommand(
      { name: "lt:pvpoff", description: "Info PvP", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => { player.sendMessage(`\u00a7e[PvP] \u00a77PvP otomatis mati setelah ${Math.floor(CFG.PVP_AUTO_OFF_TICKS / 20)} detik tanpa bertarung.`); });
        return { status: 0 };
      }
    );


  } catch (e) { console.warn("[Combat] Command registration failed:", e); }
});


system.afterEvents.scriptEventReceive.subscribe(ev => {
  const src = ev.sourceEntity;
  // Console (no sourceEntity) = admin; in-game player needs admin tag
  const isAdmin = !src || src.hasTag?.(CFG.ADMIN_TAG);
  const reply = (msg) => {
    if (src) try { src.sendMessage(msg); } catch { }
    console.warn(msg.replace(/\u00a7./g, ""));
  };

  // ── Knockback settings handled via custom commands, not scriptevent ──

  if (ev.id === "combat:reset_stats") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    const target = ev.message?.trim();
    if (!target) { reply("\u00a7c[PvP] /scriptevent combat:reset_stats NamaPlayer"); return; }
    const p = world.getPlayers().find(pl => pl.name === target);
    if (p) { setStats(p.id, { kills: 0, deaths: 0, earned: 0, lost: 0, streak: 0, bestStreak: 0, lastKillTs: 0 }); updateLeaderboard(p.name, p.id); reply(`\u00a7a[PvP] Stats \u00a7f${target} \u00a7adireset.`); }
    else reply(`\u00a7c[PvP] \u00a7f${target} \u00a7ctidak ditemukan.`);
    return;
  }
  if (ev.id === "combat:force_pvp") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    const args = (ev.message ?? "").trim().split(" ");
    const p = world.getPlayers().find(pl => pl.name === args[0]);
    if (!p) { reply(`\u00a7c[PvP] \u00a7f${args[0]} \u00a7ctidak ditemukan.`); return; }
    const act = args[1] ?? "toggle";
    if (act === "on" && !isPvPOn(p)) { p.addTag(CFG.PVP_TAG); pvpActivePlayers.add(p.id); pvpActiveUntil.set(p.id, system.currentTick + CFG.PVP_AUTO_OFF_TICKS); }
    else if (act === "off" && isPvPOn(p)) { p.removeTag(CFG.PVP_TAG); pvpActivePlayers.delete(p.id); pvpActiveUntil.delete(p.id); graceUntil.delete(p.id); }
    else { isPvPOn(p) ? (p.removeTag(CFG.PVP_TAG), pvpActivePlayers.delete(p.id), pvpActiveUntil.delete(p.id), graceUntil.delete(p.id)) : (p.addTag(CFG.PVP_TAG), pvpActivePlayers.add(p.id), pvpActiveUntil.set(p.id, system.currentTick + CFG.PVP_AUTO_OFF_TICKS)); }
    reply(`\u00a7a[PvP] \u00a7f${p.name} PvP: ${isPvPOn(p) ? "\u00a7cAKTIF" : "\u00a7aNONAKTIF"}`);
    return;
  }
  if (ev.id === "combat:clear_log") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    killLogCache = [];
    killLogDirty = false;
    dp.set(CFG.K_LOG, []);
    reply("\u00a7a[PvP] Kill log dihapus.");
  }
  if (ev.id === "combat:unban") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    const target = ev.message?.trim();
    if (!target) { reply("\u00a7c[PvP] /scriptevent combat:unban NamaPlayer"); return; }
    const p = world.getPlayers().find(pl => pl.name === target);
    if (p) {
      dp.del(CFG.K_TEMPBAN + p.id);
      dp.del(CFG.K_OFFENSE + p.id);
      reply(`\u00a7a[PvP] Tempban & offense \u00a7f${target} \u00a7adihapus.`);
    } else {
      reply(`\u00a7c[PvP] \u00a7f${target} \u00a7ctidak online. Gunakan saat player online.`);
    }
    return;
  }
  if (ev.id === "combat:check_offense") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    const target = ev.message?.trim();
    if (!target) { reply("\u00a7c[PvP] /scriptevent combat:check_offense NamaPlayer"); return; }
    const p = world.getPlayers().find(pl => pl.name === target);
    if (!p) { reply(`\u00a7c[PvP] \u00a7f${target} \u00a7ctidak ditemukan.`); return; }
    const off = dp.get(CFG.K_OFFENSE + p.id, { count: 0, lastTs: 0 });
    // Apply decay for accurate display
    if (off.lastTs > 0 && off.count > 0) {
      const decay = Math.floor((Date.now() - off.lastTs) / CFG.OFFENSE_DECAY_MS);
      if (decay > 0) off.count = Math.max(0, off.count - decay);
    }
    const ban = dp.get(CFG.K_TEMPBAN + p.id, null);
    let msg = `\u00a7a[PvP] \u00a7f${target}\u00a7a: Offense: \u00a7f${off.count}`;
    if (off.lastTs > 0) msg += ` \u00a78(last: ${Math.floor((Date.now() - off.lastTs) / 60000)}m ago)`;
    if (ban && ban.until > Date.now()) msg += `\n\u00a7c  TEMPBAN: sisa \u00a7f${Math.ceil((ban.until - Date.now()) / 60000)} menit`;
    else msg += `\n\u00a7a  Tidak di-ban`;
    reply(msg);
    return;
  }
  // \u2500\u2500 Reset KillFX per-player \u2500\u2500
  if (ev.id === "combat:reset_killfx") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[KillFX] Akses ditolak."); return; }
    const target = ev.message?.trim();
    if (!target) { reply("\u00a7c[KillFX] /scriptevent combat:reset_killfx NamaPlayer"); return; }
    const p = world.getPlayers().find(pl => pl.name === target);
    const defaultFx = { active: "Games:coins", owned: ["Games:coins", "none"] };
    if (p) {
      setKillFx(p.id, defaultFx);
      evictKillFxCache(p.id);
      // Also clear legacy world DP if exists
      try { world.setDynamicProperty("ckfx:" + p.id, undefined); } catch { }
      reply(`\u00a7a[KillFX] \u00a7fKillFX \u00a7f${target} \u00a7adireset ke default.`);
    } else {
      // Try offline: scan world DP for matching ckfx: key by name lookup via p_reg
      let found = false;
      try {
        for (const dpId of world.getDynamicPropertyIds()) {
          if (dpId.startsWith("ckfx:")) {
            const pid = dpId.slice(5);
            // Check if this pid matches the target name via p_reg or just clear by pid
            world.setDynamicProperty(dpId, JSON.stringify(defaultFx));
            // We can't verify name for offline, so inform admin
          }
        }
      } catch { }
      reply(`\u00a7e[KillFX] \u00a7f${target} \u00a7etidak online. Untuk offline player gunakan \u00a7fcombat:reset_killfx_all\u00a7e.`);
    }
    return;
  }
  // \u2500\u2500 Reset KillFX ALL players (online + offline) \u2500\u2500
  if (ev.id === "combat:reset_killfx_all") {
    if (!isAdmin) { src?.sendMessage?.("\u00a7c[KillFX] Akses ditolak."); return; }
    const defaultFx = { active: "Games:coins", owned: ["Games:coins", "none"] };
    let countOnline = 0, countOffline = 0;
    // 1) Reset all online players (player DP + cache)
    for (const p of world.getPlayers()) {
      setKillFx(p.id, defaultFx);
      evictKillFxCache(p.id);
      // Also clear legacy world DP
      try { world.setDynamicProperty("ckfx:" + p.id, undefined); } catch { }
      countOnline++;
    }
    // 2) Clear all offline ckfx: world DP keys
    try {
      for (const dpId of world.getDynamicPropertyIds()) {
        if (dpId.startsWith("ckfx:")) {
          world.setDynamicProperty(dpId, undefined);
          countOffline++;
        }
      }
    } catch (e) { console.warn("[KillFX] reset_all offline scan error:", e); }
    reply(`\u00a7a[KillFX] \u00a7fReset selesai! \u00a7aOnline: \u00a7f${countOnline}\u00a7a, Offline DP cleared: \u00a7f${countOffline}`);
    return;
  }
});


world.afterEvents.playerLeave.subscribe(({ playerId, playerName }) => {
  if ((combatTagUntil.get(playerId) ?? 0) > system.currentTick) {
    try {
      const obj = ensureCoinObj();
      for (const p of obj.getParticipants()) {
        if (p.displayName === playerName) {
          const cur = obj.getScore(p) ?? 0;
          const penalty = Math.floor(cur * CFG.COMBAT_LOG_PCT / 100);
          if (penalty > 0) {
            // [§2] Track only if scoreboard write succeeded — else debt is fake.
            try {
              obj.setScore(p, cur - penalty);
              const existingDebt = dp.get(CFG.K_DEBT + playerId, 0);
              dp.set(CFG.K_DEBT + playerId, existingDebt + penalty);
              trackFlow("pvp_penalty", -penalty);
            } catch (e) {
              console.warn(`[Combat] log penalty setScore failed: ${playerName}`, e);
            }
          }
          break;
        }
      }
    } catch { }
  }
  if (combatStatsDirty.has(playerId)) {
    const s = combatStatsCache.get(playerId);
    if (s) dp.set(CFG.K_STATS + playerId, s);
    combatStatsDirty.delete(playerId);
  }
  combatStatsCache.delete(playerId);
  hudOnCache.delete(playerId);
  evictKillFxCache(playerId);

  toggleCooldown.delete(playerId);
  graceUntil.delete(playerId);
  combatTagUntil.delete(playerId);
  pvpActiveUntil.delete(playerId);
  pvpActivePlayers.delete(playerId);
  activeSessions.delete(playerId);
  globalKillCD.delete(playerId);
  for (const key of Array.from(killCooldown.keys())) {
    if (key.includes(playerId)) killCooldown.delete(key);
  }
  for (const key of Array.from(_warnCooldown.keys())) {
    if (key.includes(playerId)) _warnCooldown.delete(key);
  }

  lastAttacker.delete(playerId);
  _nonPvpFireProtected.delete(playerId);
  _pvpHitSpam.delete(playerId);
  _victimKillCD.delete(playerId);
  playerJoinTime.delete(playerId);

  // Juga hapus entries dimana player ini adalah attacker orang lain
  for (const [victimId, data] of Array.from(lastAttacker)) {
    if (data.id === playerId) lastAttacker.delete(victimId);
  }
});

