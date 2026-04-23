import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { CFG } from "./config.js";
import { getTPS, getTPSColor } from "../MobuXP/monitor/tps_tracker.js";


const dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try { world.setDynamicProperty(k, JSON.stringify(v)); }
    catch {}
  },
  del: (k) => { try { world.setDynamicProperty(k, undefined); } catch {} },
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
  try { ensureCoinObj()?.setScore(player.scoreboardIdentity ?? player, Math.max(0, Math.floor(n))); }
  catch {}
}

const fmt = (n) => Math.floor(n).toLocaleString("id-ID");

const SFX = {
  TOGGLE_ON:  { id: "random.anvil_use", pitch: 1.2, vol: 0.8 },
  TOGGLE_OFF: { id: "random.click",     pitch: 0.8, vol: 0.7 },
  KILL:       { id: "random.levelup",    pitch: 1.5, vol: 1.0 },
  DEATH:      { id: "note.bass",         pitch: 0.5, vol: 1.0 },
  BLOCKED:    { id: "note.bass",         pitch: 0.7, vol: 0.5 },
  MENU:       { id: "random.click",      pitch: 1.3, vol: 0.7 },
};
const sfx = (p, s) => { try { p.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch {} };

const toggleCooldown   = new Map();
const killCooldown     = new Map();
const globalKillCD     = new Map();
const combatTagUntil   = new Map();
const graceUntil       = new Map();
const activeSessions   = new Set();
const pvpActivePlayers = new Set();
const _warnCooldown    = new Map();

// ─── In-memory caches — avoid DP reads every HUD tick ───────
const combatStatsCache = new Map();  // pid → stats object (mutable ref)
const combatStatsDirty = new Set();  // pids with unsaved stat changes
const hudModeCache     = new Map();  // pid → "actionbar" | "sidebar"
const hudOnCache       = new Map();  // pid → boolean
const sidebarCmdTick   = new Map();  // pid → last tick setdisplay was called
const sidebarPrevLines = new Map();  // pid → Map<name, score> for smart diff
// Kill log — lazy-loaded, batch-written
let killLogCache = null;             // null = not yet loaded from DP
let killLogDirty = false;

// ─── TPS Display — uses shared tps_tracker.js (no duplicate interval) ──
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
  } catch {}
  return false;
}

function getStats(pid) {
  if (combatStatsCache.has(pid)) return combatStatsCache.get(pid);
  const v = dp.get(CFG.K_STATS + pid, {
    kills: 0, deaths: 0, earned: 0, lost: 0, streak: 0, bestStreak: 0, lastKillTs: 0,
  });
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

// ═══════════════════════════════════════════════════════════
// HUD HELPERS — per-player display preference
// ═══════════════════════════════════════════════════════════
function getHudMode(pid) {
  if (hudModeCache.has(pid)) return hudModeCache.get(pid);
  const v = dp.get(CFG.K_HUD_MODE + pid, CFG.DEFAULT_HUD_MODE);
  hudModeCache.set(pid, v);
  return v;
}
function setHudMode(pid, m) { hudModeCache.set(pid, m); dp.set(CFG.K_HUD_MODE + pid, m); }
function isHudOn(pid) {
  if (hudOnCache.has(pid)) return hudOnCache.get(pid);
  const v = dp.get(CFG.K_HUD_ENABLED + pid, true);
  hudOnCache.set(pid, v);
  return v;
}
function setHudOn(pid, v) { hudOnCache.set(pid, v); dp.set(CFG.K_HUD_ENABLED + pid, v); }

// ═══════════════════════════════════════════════════════════
// PLAYER STATUS — live info untuk UI
// ═══════════════════════════════════════════════════════════
function getPlayerStatus(player) {
  let hp = 20, maxHp = 20, armor = 0, weapon = "Tangan Kosong";
  try {
    const hc = player.getComponent("minecraft:health");
    if (hc) { hp = hc.currentValue; maxHp = hc.effectiveMax; }
  } catch {}
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) {
      const held = inv.getItem(player.selectedSlotIndex);
      if (held) weapon = held.typeId.replace("minecraft:", "").replace(/_/g, " ");
      // Armor score
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
          } catch {}
        }
      }
    }
  } catch {}
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
    player.sendMessage(`§c[PvP] Tunggu §f${remain} detik §csebelum toggle lagi.`);
    sfx(player, SFX.BLOCKED);
    return "cooldown";
  }
  if (isPvPOn(player)) {
    if ((combatTagUntil.get(player.id) ?? 0) > now) {
      const remain = Math.ceil(((combatTagUntil.get(player.id) ?? 0) - now) / 20);
      player.sendMessage(`§c[PvP] Dalam pertarungan! Tunggu §f${remain}s`);
      sfx(player, SFX.BLOCKED);
      return "combat_tag";
    }
    toggleCooldown.set(player.id, now);
    player.removeTag(CFG.PVP_TAG);
    pvpActivePlayers.delete(player.id);
    graceUntil.delete(player.id);
    sfx(player, SFX.TOGGLE_OFF);
    player.sendMessage(`§a[PvP] §cPvP NONAKTIF\n§7Kamu sekarang aman dari serangan player lain.`);
    return "off";
  } else {
    const coin = getCoin(player);
    if (coin < CFG.MIN_COIN_TO_ENABLE) {
      player.sendMessage(`§c[PvP] Koin tidak cukup!\n§7Minimal §e${fmt(CFG.MIN_COIN_TO_ENABLE)} ⛃ §7untuk aktifkan PvP.\n§7Saldo: §c${fmt(coin)} ⛃`);
      sfx(player, SFX.BLOCKED);
      return "no_coin";
    }
    toggleCooldown.set(player.id, now);
    player.addTag(CFG.PVP_TAG);
    pvpActivePlayers.add(player.id);
    graceUntil.set(player.id, now + CFG.SAFE_TICKS);
    sfx(player, SFX.TOGGLE_ON);
    player.sendMessage(`§a[PvP] §c§lPvP AKTIF!\n§7Grace: §f5 detik\n§c⚠ Bisa diserang setelah grace habis!`);
    return "on";
  }
}


async function showPvPMenu(player) {
  if (activeSessions.has(player.id)) return;
  activeSessions.add(player.id);

  try {
    while (true) {
      const isOn  = isPvPOn(player);
      const stats = getStats(player.id);
      const coin  = getCoin(player);
      const kd    = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : stats.kills.toFixed(0);
      const st    = getPlayerStatus(player);
      const hudOn = isHudOn(player.id);
      const hudM  = getHudMode(player.id);
      const mult  = getStreakMult(stats.streak);

      // Nearby enemies count
      let nearbyEnemies = 0;
      try {
        for (const p of world.getPlayers()) {
          if (p.id === player.id || !isPvPOn(p)) continue;
          const d = player.location;
          const e = p.location;
          const distSq = (d.x-e.x)**2 + (d.y-e.y)**2 + (d.z-e.z)**2;
          if (distSq <= 400) nearbyEnemies++;
        }
      } catch {}

      let body = `${CFG.HR}\n`;
      body += `§c§l  C O M B A T   P v P\n`;
      body += `${CFG.HR}\n\n`;

      // Status badge
      body += `  §eStatus §8── ${isOn ? "§c§lAKTIF \u2694" : "§a§lNONAKTIF \u2714"}\n`;
      if (st.inCombat) body += `  §c§l  \u26a0 DALAM PERTARUNGAN!\n`;
      if (st.isGrace)  body += `  §e§l  \u26a1 GRACE PERIOD\n`;
      body += `\n`;

      // Player Status
      body += `  §6\u2726 §eStatus Player\n`;
      body += `${CFG.HR_THIN}\n`;
      body += `  §8\u251c §cHP     §8\u2500\u2500 ${progressBar(st.hp, st.maxHp, 8)} §f${Math.floor(st.hp)}§8/${Math.floor(st.maxHp)}\n`;
      body += `  §8\u251c §bArmor  §8\u2500\u2500 §f${st.armor} pts\n`;
      body += `  §8\u251c §fSenjata§8\u2500\u2500 §f${st.weapon}\n`;
      body += `  §8\u2514 §e\u26c3 Koin  §8\u2500\u2500 §e${fmt(coin)}\n\n`;

      // Combat Stats
      body += `  §c\u2694 §eStatistik\n`;
      body += `${CFG.HR_THIN}\n`;
      body += `  §8\u251c §7K/D    §8\u2500\u2500 §f${stats.kills}§7/§f${stats.deaths} §8(§e${kd}§8)\n`;
      body += `  §8\u251c §7Streak §8\u2500\u2500 §f${stats.streak} §8(Best: §e${stats.bestStreak}§8)\n`;
      body += `  §8\u251c §7Multi  §8\u2500\u2500 §e${mult}x\n`;
      body += `  §8\u251c §aDapat  §8\u2500\u2500 §a+${fmt(stats.earned)} \u26c3\n`;
      body += `  §8\u2514 §cHilang §8\u2500\u2500 §c-${fmt(stats.lost)} \u26c3\n\n`;

      // Combat Info
      body += `  §e\u26a1 §eInfo\n`;
      body += `${CFG.HR_THIN}\n`;
      body += `  §8\u251c §7Musuh  §8\u2500\u2500 ${nearbyEnemies > 0 ? `§c${nearbyEnemies} nearby` : `§a0 aman`}\n`;
      body += `  §8\u251c §7HUD    §8\u2500\u2500 ${hudOn ? `§a${hudM === "sidebar" ? "Sidebar" : "Actionbar"}` : "§cOFF"}\n`;
      body += `  §8\u2514 §7Min \u26c3  §8\u2500\u2500 §e${fmt(CFG.MIN_COIN_TO_ENABLE)}\n`;
      body += `\n${CFG.HR}`;

      const btns = [];
      const form = new ActionFormData()
        .title("§l§8 \u2694 §cCOMBAT PvP§r§l §8\u2694 §r")
        .body(body);

      // Toggle button
      if (isOn) {
        const canOff = !st.inCombat;
        form.button(canOff
          ? "§c§l  \u2694 Nonaktifkan PvP\n§r  §8Matikan mode bertarung"
          : "§4§l  \u2694 PvP (Dalam Pertarungan)\n§r  §8Tunggu combat tag habis");
      } else {
        const canOn = coin >= CFG.MIN_COIN_TO_ENABLE;
        form.button(canOn
          ? "§a§l  \u2694 Aktifkan PvP\n§r  §8Siap bertarung!"
          : `§8§l  \u2694 Koin Kurang (${fmt(CFG.MIN_COIN_TO_ENABLE)} \u26c3)\n§r  §8Tidak bisa aktifkan`);
      }
      btns.push("toggle");

      form.button("§f§l  \u25c6 Kill Log\n§r  §8Riwayat pertarungan");
      btns.push("log");
      form.button("§e§l  \u2726 Leaderboard\n§r  §8Top killer");
      btns.push("lb");
      form.button("§b§l  \u2699 Pengaturan HUD\n§r  §8Tampilan stats & mode");
      btns.push("settings");
      form.button("§8§l  Tutup");
      btns.push("close");

      sfx(player, SFX.MENU);
      const res = await form.show(player);
      if (res.canceled || btns[res.selection] === "close") return;

      switch (btns[res.selection]) {
        case "toggle": await confirmToggle(player); break;
        case "log":    await showKillLog(player); break;
        case "lb":     await showLeaderboard(player); break;
        case "settings": await showSettings(player); break;
      }
    }
  } finally {
    activeSessions.delete(player.id);
  }
}

async function confirmToggle(player) {
  const isOn = isPvPOn(player);

  if (isOn) {
    togglePvP(player);
    return;
  }

  // Coin check
  const coin = getCoin(player);
  if (coin < CFG.MIN_COIN_TO_ENABLE) {
    player.sendMessage(
      `§c[PvP] Koin tidak cukup!\n` +
      `§7Minimal §e${fmt(CFG.MIN_COIN_TO_ENABLE)} \u26c3 §7untuk aktifkan PvP.\n` +
      `§7Saldo: §c${fmt(coin)} \u26c3`
    );
    sfx(player, SFX.BLOCKED);
    return;
  }

  const confirm = await new MessageFormData()
    .title("§l§c  \u26a0 Aktifkan PvP?  §r")
    .body(
      `${CFG.HR}\n` +
      `§c§l\u26a0 PERINGATAN\n\n` +
      `§fDengan mengaktifkan PvP:\n\n` +
      `§7\u2022 Player PvP lain §cbisa membunuhmu\n` +
      `§7\u2022 Mati = §ckehilangan koin §7(${CFG.KILL_REWARD_PCT}% saldo)\n` +
      `§7\u2022 Kill = §amendapat koin §7dari korban\n` +
      `§7\u2022 Grace period: §f5 detik §7setelah aktivasi\n` +
      `§7\u2022 Minimal koin: §e${fmt(CFG.MIN_COIN_TO_ENABLE)} \u26c3\n\n` +
      `§eSaldo kamu: §f${fmt(coin)} \u26c3\n` +
      `§eApakah kamu yakin?\n` +
      `${CFG.HR}`
    )
    .button1("§f Batal")
    .button2("§c \u2694 Ya, Aktifkan!")
    .show(player);

  if (confirm.canceled || confirm.selection !== 1) return;
  togglePvP(player);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS UI — HUD mode & toggle
// ═══════════════════════════════════════════════════════════
async function showSettings(player) {
  const curMode = getHudMode(player.id);
  const curOn   = isHudOn(player.id);
  const coin    = getCoin(player);

  let body = `${CFG.HR}\n`;
  body += `§b§l  \u2699 P E N G A T U R A N\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §e\u2726 §eHUD Combat Stats\n`;
  body += `${CFG.HR_THIN}\n`;
  body += `  §8\u251c §7Status  §8\u2500\u2500 ${curOn ? "§aAKTIF" : "§cNONAKTIF"}\n`;
  body += `  §8\u251c §7Mode    §8\u2500\u2500 §f${curMode === "sidebar" ? "Sidebar (Kanan)" : "Actionbar (Bawah)"}\n`;
  body += `  §8\u251c §e\u26c3 Koin  §8\u2500\u2500 §e${fmt(coin)} §8(Min: §e${fmt(CFG.MIN_COIN_TO_ENABLE)}§8)\n\n`;
  body += `  §8\u2514 §8Info:\n`;
  body += `    §8Actionbar §8= stats di bawah layar\n`;
  body += `    §8Sidebar   §8= papan skor di kanan\n`;
  body += `\n${CFG.HR}`;

  const form = new ActionFormData()
    .title("§l§8 \u2699 §bSETTINGS §8\u2699 §r")
    .body(body);

  const btns = [];
  form.button(curOn
    ? "§c§l  Matikan HUD Stats\n§r  §8Sembunyikan stats"
    : "§a§l  Aktifkan HUD Stats\n§r  §8Tampilkan stats saat PvP");
  btns.push("toggle_hud");

  form.button(curMode === "actionbar"
    ? "§e§l  Mode: Sidebar\n§r  §8Pindah ke papan skor kanan"
    : "§e§l  Mode: Actionbar\n§r  §8Pindah ke teks bawah layar");
  btns.push("switch_mode");

  form.button("§6§l  \u25c0 Kembali");
  btns.push("back");

  const res = await form.show(player);
  if (res.canceled || btns[res.selection] === "back") return;

  if (btns[res.selection] === "toggle_hud") {
    const newVal = !curOn;
    setHudOn(player.id, newVal);
    sfx(player, newVal ? SFX.TOGGLE_ON : SFX.TOGGLE_OFF);
    player.sendMessage(`§b[\u2699] HUD Stats: ${newVal ? "§aAKTIF" : "§cNONAKTIF"}`);
    if (!newVal) {
      // Clear sidebar scoreboard when HUD is turned off
      try {
        const objId = getSidebarObjId(player);
        const obj = world.scoreboard.getObjective(objId);
        if (obj) world.scoreboard.removeObjective(obj);
      } catch {}
      sidebarCmdTick.delete(player.id);
      sidebarPrevLines.delete(player.id);
    }
  } else if (btns[res.selection] === "switch_mode") {
    const newMode = curMode === "actionbar" ? "sidebar" : "actionbar";
    setHudMode(player.id, newMode);
    sfx(player, SFX.MENU);
    player.sendMessage(`§b[\u2699] Mode HUD: §f${newMode === "sidebar" ? "Sidebar (Kanan)" : "Actionbar (Bawah)"}`);
    // Clean up sidebar scoreboard when switching away from sidebar mode
    if (newMode === "actionbar") {
      try {
        const objId = getSidebarObjId(player);
        const obj = world.scoreboard.getObjective(objId);
        if (obj) world.scoreboard.removeObjective(obj);
      } catch {}
      sidebarCmdTick.delete(player.id);
      sidebarPrevLines.delete(player.id);
    }
  }
}

async function showKillLog(player) {
  const log = getKillLog();
  let body = `${CFG.HR}\n§c§l  KILL LOG\n${CFG.HR}\n\n`;

  if (!log.length) {
    body += "§8 Belum ada pertarungan tercatat.\n";
  } else {
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      const ago = timeAgo(e.t);
      body += `  §8${i + 1}. §a${e.k} §c\u2694 §c${e.v}\n`;
      body += `  §8   §e+${fmt(e.c)} \u26c3 §8| ${ago}\n`;
    }
  }

  body += `\n${CFG.HR}`;
  await new ActionFormData()
    .title("§l§8 \u2694 §fKILL LOG §8\u2694 §r")
    .body(body)
    .button("§6§l  \u25c0 Kembali")
    .show(player);
}

function updateLeaderboard(name, pid) {
  const s = getStats(pid);
  if (s.kills <= 0 && s.deaths <= 0) return;
  const lb = dp.get("c:lb", []);
  const idx = lb.findIndex(e => e.pid === pid);
  const entry = {
    pid, name, kills: s.kills, deaths: s.deaths,
    earned: s.earned, kd: s.deaths > 0 ? +(s.kills / s.deaths).toFixed(2) : s.kills,
  };
  if (idx >= 0) lb[idx] = entry;
  else lb.push(entry);
  lb.sort((a, b) => b.kills - a.kills);
  if (lb.length > 10) lb.length = 10;
  dp.set("c:lb", lb);
}

async function showLeaderboard(player) {
  const entries = dp.get("c:lb", []);
  const medals = ["\u00a76\u00a7l1.", "\u00a7f\u00a7l2.", "\u00a7e\u00a7l3."];

  let body = `${CFG.HR}\n§c§l  TOP KILLER\n${CFG.HR}\n\n`;
  if (!entries.length) {
    body += "§8 Belum ada data.\n";
  } else {
    entries.slice(0, 10).forEach((e, i) => {
      const rank = i < 3 ? medals[i] : `§8${i + 1}.`;
      body += `  ${rank} §a${e.name}\n`;
      body += `  §8   §c${e.kills}K §8/ §7${e.deaths}D §8| §e+${fmt(e.earned)}\u26c3\n`;
    });
  }

  body += `\n${CFG.HR}`;
  await new ActionFormData()
    .title("§l§8 \u2726 §eTOP KILLER §8\u2726 §r")
    .body(body)
    .button("§6§l  \u25c0 Kembali")
    .show(player);
}

function timeAgo(ts) {
  if (!ts) return "?";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return `${s}dtk lalu`;
  if (s < 3600)  return `${Math.floor(s / 60)}mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}jam lalu`;
  return `${Math.floor(s / 86400)}hr lalu`;
}

world.afterEvents.entityHurt.subscribe(ev => {
  const victim   = ev.hurtEntity;
  const attacker = ev.damageSource?.damagingEntity;
  if (!victim || !attacker) return;
  if (victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player") return;

  const healBack = () => {
    try {
      const h = victim.getComponent("minecraft:health");
      if (h) h.setCurrentValue(Math.min(h.currentValue + ev.damage, h.effectiveMax));
    } catch {}
  };

  const atkPvP = isPvPOn(attacker);
  const vicPvP = isPvPOn(victim);
  if (!atkPvP || !vicPvP) {
    healBack();
    const pairWarnKey = `${attacker.id}>${victim.id}`;
    const now = Date.now();
    if (now - (_warnCooldown.get(pairWarnKey) ?? 0) < 3000) return;
    _warnCooldown.set(pairWarnKey, now);
    system.run(() => {
      if (!atkPvP) {
        attacker.sendMessage(`§c[PvP] §7PvP-mu belum aktif!`);
        victim.sendMessage(`§e[PvP] §f${attacker.name} §7mencoba menyerangmu.`);
      } else {
        attacker.sendMessage(`§c[PvP] §f${victim.name} §7belum aktif PvP.`);
        victim.sendMessage(`§c[PvP] §f${attacker.name} §7menyerangmu! §f/lt:pvp §7untuk melawan.`);
        sfx(victim, SFX.BLOCKED);
      }
    });
    return;
  }

  if (isInProtectedLand(victim) || isInProtectedLand(attacker)) {
    healBack();
    system.run(() => attacker.sendMessage(`§e[PvP] §7PvP dinonaktifkan di area land!`));
    return;
  }

  const now = system.currentTick;
  if (now < (graceUntil.get(victim.id) ?? 0)) {
    healBack();
    system.run(() => attacker.sendMessage(`§e[PvP] §f${victim.name} §7masih dalam grace period!`));
    return;
  }

  const ctTick = now + CFG.COMBAT_TAG_TICKS;
  combatTagUntil.set(victim.id, Math.max(combatTagUntil.get(victim.id) ?? 0, ctTick));
  combatTagUntil.set(attacker.id, Math.max(combatTagUntil.get(attacker.id) ?? 0, ctTick));
});

world.afterEvents.entityDie.subscribe(ev => {
  const victim   = ev.deadEntity;
  const attacker = ev.damageSource?.damagingEntity;
  if (!victim || !attacker) return;
  if (victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player") return;
  if (!isPvPOn(attacker) && !pvpActivePlayers.has(attacker.id)) return;
  if (!pvpActivePlayers.has(victim.id)) return;

  const now = Date.now();
  const pairKey = `${attacker.id}:${victim.id}`;
  if (now - (killCooldown.get(pairKey) ?? 0) < CFG.KILL_CD_MS) {
    system.run(() => attacker.sendMessage(`§e[PvP] Kill cooldown! §7Tunggu sebelum farm §f${victim.name}`));
    return;
  }
  if (now - (globalKillCD.get(attacker.id) ?? 0) < CFG.GLOBAL_KILL_CD_MS) {
    system.run(() => attacker.sendMessage(`§e[PvP] §7Global cooldown aktif!`));
    return;
  }
  killCooldown.set(pairKey, now);
  globalKillCD.set(attacker.id, now);

  // Single cache lookup — also serves as reward multiplier source
  const atkStats = getStats(attacker.id);
  const prevStreak = (now - (atkStats.lastKillTs || 0) > CFG.STREAK_DECAY_MS) ? 0 : atkStats.streak;

  const victimCoins = getCoin(victim);
  let actualGain = 0, actualLoss = 0;
  if (victimCoins > 0) {
    const mult = getStreakMult(prevStreak);
    let reward = Math.floor(victimCoins * CFG.KILL_REWARD_PCT / 100 * mult);
    reward = Math.min(CFG.MAX_REWARD, Math.max(CFG.MIN_REWARD, reward));
    actualLoss = Math.min(reward, victimCoins);
    actualGain = actualLoss;
    setCoin(victim, victimCoins - actualLoss);
    setCoin(attacker, getCoin(attacker) + actualGain);
  }

  atkStats.streak = prevStreak;  // apply decay before incrementing
  atkStats.kills++;
  atkStats.earned += actualGain;
  atkStats.streak++;
  atkStats.lastKillTs = now;
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
  const streakBonus = atkStats.streak >= 3 ? ` §6§l(${atkStats.streak}x STREAK!)` : "";

  system.run(() => {
    sfx(attacker, SFX.KILL);
    attacker.sendMessage(`§a[PvP] §c\u2694 §fKamu membunuh §c${victim.name}!\n§a  +${fmt(actualGain)} \u26c3${streakBonus}\n§7  Saldo: §e${fmt(getCoin(attacker))} \u26c3`);
    if (atkStats.streak >= 3) {
      world.sendMessage(`§c[PvP] §f${attacker.name} §c\u2694 §f${victim.name} §e(${fmt(actualGain)}\u26c3)${streakBonus}`);
    }
  });

  dp.set("cdm:" + victim.id, { killer: attacker.name, lost: actualLoss, ts: now });
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (isPvPOn(player)) pvpActivePlayers.add(player.id);

  system.runTimeout(() => {
    const debt = dp.get(CFG.K_DEBT + player.id, 0);
    if (debt > 0) {
      dp.del(CFG.K_DEBT + player.id);
      const cur = getCoin(player);
      const loss = Math.min(debt, cur);
      if (loss > 0) setCoin(player, cur - loss);
      player.sendMessage(`§c[PvP] §4Combat Log Penalty!\n§c  -${fmt(loss)} \u26c3 §7(disconnect saat combat)\n§7  Saldo: §e${fmt(getCoin(player))} \u26c3`);
      sfx(player, SFX.DEATH);
    }
    const deathMsg = dp.get("cdm:" + player.id, null);
    if (deathMsg) {
      dp.del("cdm:" + player.id);
      sfx(player, SFX.DEATH);
      player.sendMessage(`§c[PvP] §fDibunuh oleh §c${deathMsg.killer}!\n§c  -${fmt(deathMsg.lost)} \u26c3\n§7  Saldo: §e${fmt(getCoin(player))} \u26c3`);
    }
  }, 20);
});

// ═══════════════════════════════════════════════════════════
// SIDEBAR HELPERS — collision-safe ID, smart diff update
// ═══════════════════════════════════════════════════════════
function getSidebarObjId(player) {
  // Use player ID hash to avoid name collision
  // player.id is unique (e.g. "-12345678901"), take last 12 chars
  const idStr = String(player.id).replace(/[^a-zA-Z0-9]/g, "");
  return "pvp" + idStr.substring(0, 14);
}

/**
 * Smart-diff sidebar update: only add/remove changed lines.
 * Prevents flicker from full clear+rebuild every tick.
 */
function updateSidebarSmart(player, obj, newLines) {
  const pid = player.id;
  const prev = sidebarPrevLines.get(pid) ?? new Map();
  const next = new Map(Object.entries(newLines));

  // Remove lines no longer present
  for (const [name] of prev) {
    if (!next.has(name)) {
      try { obj.removeParticipant(name); } catch {}
    }
  }

  // Add/update lines with changed scores
  for (const [name, score] of next) {
    if (prev.get(name) !== score) {
      try { obj.setScore(name, score); } catch {}
    }
  }

  sidebarPrevLines.set(pid, next);
}

// ═══════════════════════════════════════════════════════════
// HUD LOOP — premium sidebar + actionbar
// [PERF] Only loops online players, skips non-PvP early
// [FIX] Smart diff sidebar — no flicker
// ═══════════════════════════════════════════════════════════
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (!isPvPOn(player)) continue;
    if (!isHudOn(player.id)) continue;
    const now   = system.currentTick;
    const grace = (graceUntil.get(player.id) ?? 0) > now;
    const combat = (combatTagUntil.get(player.id) ?? 0) > now;
    const stats = getStats(player.id);
    const mode  = getHudMode(player.id);
    const mult  = getStreakMult(stats.streak);
    const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(1) : stats.kills.toString();
    const coin = getCoin(player);

    if (mode === "sidebar") {
      try {
        const objId = getSidebarObjId(player);
        let obj = world.scoreboard.getObjective(objId);
        if (!obj) {
          obj = world.scoreboard.addObjective(objId, "§c§l ⚔ COMBAT PvP");
        }

        // Build premium sidebar lines (score = display order, higher = top)
        const lines = {};
        let row = 15;

        // ── Status Badge ──
        if (combat) {
          const ctRemain = Math.ceil(((combatTagUntil.get(player.id) ?? 0) - now) / 20);
          lines[`§c§l⚠ COMBAT §f${ctRemain}s`] = row--;
        } else if (grace) {
          const grRemain = Math.ceil(((graceUntil.get(player.id) ?? 0) - now) / 20);
          lines[`§e§l⚡ GRACE §f${grRemain}s`] = row--;
        } else {
          lines["§a§l✔ READY"] = row--;
        }

        lines["§8─────────"] = row--;  // separator

        // ── Stats Section ──
        lines[`§c⚔ §fKills: §e${stats.kills}`] = row--;
        lines[`§7☠ §fDeaths: §7${stats.deaths}`] = row--;
        lines[`§6◆ §fK/D: §e${kd}`] = row--;

        lines["§8── ── ──"] = row--;  // separator

        // ── Streak & Multiplier ──
        if (stats.streak >= 3) {
          lines[`§6§l🔥 §e${stats.streak}x STREAK`] = row--;
        } else {
          lines[`§7⟐ §fStreak: §f${stats.streak}`] = row--;
        }
        lines[`§e✦ §fMulti: §6${mult}x`] = row--;

        lines["§8─ ─ ─ ─ ─"] = row--;  // separator

        // ── Economy ──
        lines[`§e⛃ §f${fmt(coin)}`] = row--;

        // ── Server ──
        lines[`§8TPS: ${getTpsDisplay()}`] = row--;

        // Smart diff update — no flicker!
        updateSidebarSmart(player, obj, lines);

        // setdisplay command is persistent — only call every ~200 ticks (~10s)
        const lastCmd = sidebarCmdTick.get(player.id) ?? 0;
        if (now - lastCmd >= 200) {
          try { player.runCommand(`scoreboard objectives setdisplay sidebar ${objId}`); } catch {}
          sidebarCmdTick.set(player.id, now);
        }
      } catch {}
    } else {
      let bar;
      if (grace) {
        const r = Math.ceil(((graceUntil.get(player.id) ?? 0) - now) / 20);
        bar = `§e⚔ PvP §8│ §6⚡Grace:${r}s §8│ §fK:§e${stats.kills} §fD:§7${stats.deaths} §8│ §e⛃§f${fmt(coin)} §8│ §8TPS:${getTpsDisplay()}`;
      } else if (combat) {
        const r = Math.ceil(((combatTagUntil.get(player.id) ?? 0) - now) / 20);
        bar = `§c⚔ COMBAT §4${r}s §8│ §fK:§e${stats.kills} §fD:§7${stats.deaths} §8│ §e⛃§f${fmt(coin)} §8│ §8TPS:${getTpsDisplay()}`;
      } else {
        const sk = stats.streak >= 3 ? ` §6🔥${stats.streak}x` : "";
        bar = `§a⚔ PvP §8│ §fK:§e${stats.kills} §fD:§7${stats.deaths}${sk} §8│ §e⛃§f${fmt(coin)} §8│ §8TPS:${getTpsDisplay()}`;
      }
      try { player.onScreenDisplay.setActionBar(bar); } catch {}
    }
  }
}, CFG.HUD_INT);

system.runInterval(() => {
  const now = Date.now();
  for (const [k, v] of killCooldown) { if (now - v > CFG.KILL_CD_MS * 2) killCooldown.delete(k); }
  for (const [k, v] of globalKillCD) { if (now - v > CFG.GLOBAL_KILL_CD_MS * 2) globalKillCD.delete(k); }
  for (const [k, v] of _warnCooldown) { if (now - v > 10000) _warnCooldown.delete(k); }
}, 6000);

// Flush combat stats + kill log to DP every ~10 seconds
system.runInterval(() => {
  for (const pid of combatStatsDirty) {
    const s = combatStatsCache.get(pid);
    if (s) dp.set(CFG.K_STATS + pid, s);
  }
  combatStatsDirty.clear();
  if (killLogDirty && killLogCache !== null) {
    dp.set(CFG.K_LOG, killLogCache);
    killLogDirty = false;
  }
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
      { name: "lt:pvpon", description: "Aktifkan PvP", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => { if (!isPvPOn(player)) togglePvP(player); else player.sendMessage("\u00a7e[PvP] Sudah aktif!"); });
        return { status: 0 };
      }
    );
    init.customCommandRegistry.registerCommand(
      { name: "lt:pvpoff", description: "Nonaktifkan PvP", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => { if (isPvPOn(player)) togglePvP(player); else player.sendMessage("\u00a7e[PvP] Sudah nonaktif."); });
        return { status: 0 };
      }
    );
    console.log("[Combat] /pvp /pvpon /pvpoff registered.");
  } catch (e) { console.warn("[Combat] Command registration failed:", e); }
});

system.afterEvents.scriptEventReceive.subscribe(ev => {
  const src = ev.sourceEntity;
  if (ev.id === "combat:reset_stats") {
    if (!src?.hasTag?.(CFG.ADMIN_TAG)) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    const target = ev.message?.trim();
    if (!target) { src?.sendMessage?.("\u00a7c[PvP] /scriptevent combat:reset_stats NamaPlayer"); return; }
    const p = world.getPlayers().find(pl => pl.name === target);
    if (p) { setStats(p.id, { kills:0, deaths:0, earned:0, lost:0, streak:0, bestStreak:0, lastKillTs:0 }); src?.sendMessage?.(`\u00a7a[PvP] Stats \u00a7f${target} \u00a7adireset.`); }
    else src?.sendMessage?.(`\u00a7c[PvP] \u00a7f${target} \u00a7ctidak ditemukan.`);
    return;
  }
  if (ev.id === "combat:force_pvp") {
    if (!src?.hasTag?.(CFG.ADMIN_TAG)) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    const args = (ev.message ?? "").trim().split(" ");
    const p = world.getPlayers().find(pl => pl.name === args[0]);
    if (!p) { src?.sendMessage?.(`\u00a7c[PvP] \u00a7f${args[0]} \u00a7ctidak ditemukan.`); return; }
    const act = args[1] ?? "toggle";
    if (act === "on" && !isPvPOn(p)) { p.addTag(CFG.PVP_TAG); pvpActivePlayers.add(p.id); }
    else if (act === "off" && isPvPOn(p)) { p.removeTag(CFG.PVP_TAG); pvpActivePlayers.delete(p.id); graceUntil.delete(p.id); }
    else { isPvPOn(p) ? (p.removeTag(CFG.PVP_TAG), pvpActivePlayers.delete(p.id), graceUntil.delete(p.id)) : (p.addTag(CFG.PVP_TAG), pvpActivePlayers.add(p.id)); }
    src?.sendMessage?.(`\u00a7a[PvP] \u00a7f${p.name} PvP: ${isPvPOn(p) ? "\u00a7cAKTIF" : "\u00a7aNONAKTIF"}`);
    return;
  }
  if (ev.id === "combat:clear_log") {
    if (!src?.hasTag?.(CFG.ADMIN_TAG)) { src?.sendMessage?.("\u00a7c[PvP] Akses ditolak."); return; }
    dp.set(CFG.K_LOG, []);
    src?.sendMessage?.("\u00a7a[PvP] Kill log dihapus.");
  }
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  if ((combatTagUntil.get(playerId) ?? 0) > system.currentTick) {
    try {
      const obj = ensureCoinObj();
      for (const p of obj.getParticipants()) {
        if (p.id === playerId || p.displayName === playerId) {
          const cur = obj.getScore(p) ?? 0;
          const penalty = Math.floor(cur * CFG.COMBAT_LOG_PCT / 100);
          if (penalty > 0) {
            obj.setScore(p, cur - penalty);
            dp.set(CFG.K_DEBT + playerId, penalty);
          }
          break;
        }
      }
    } catch {}
  }
  // Flush dirty stats before evicting from cache
  if (combatStatsDirty.has(playerId)) {
    const s = combatStatsCache.get(playerId);
    if (s) dp.set(CFG.K_STATS + playerId, s);
    combatStatsDirty.delete(playerId);
  }
  combatStatsCache.delete(playerId);
  hudModeCache.delete(playerId);
  hudOnCache.delete(playerId);
  sidebarCmdTick.delete(playerId);
  sidebarPrevLines.delete(playerId);

  toggleCooldown.delete(playerId);
  graceUntil.delete(playerId);
  combatTagUntil.delete(playerId);
  pvpActivePlayers.delete(playerId);
  activeSessions.delete(playerId);
  globalKillCD.delete(playerId);
  for (const key of killCooldown.keys()) {
    if (key.includes(playerId)) killCooldown.delete(key);
  }
  for (const key of _warnCooldown.keys()) {
    if (key.includes(playerId)) _warnCooldown.delete(key);
  }
  // Clean sidebar scoreboard — use hashed ID matching getSidebarObjId
  try {
    const idStr = String(playerId).replace(/[^a-zA-Z0-9]/g, "");
    const objId = "pvp" + idStr.substring(0, 14);
    const obj = world.scoreboard.getObjective(objId);
    if (obj) world.scoreboard.removeObjective(obj);
  } catch {}
});

console.log("[Combat] PvP system loaded");
