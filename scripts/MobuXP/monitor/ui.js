// monitor/ui.js — Monitor UI v3.0
// Premium UI + Mob Cap, Lag Analyzer, Spawn Fairness
// All data in-memory only — ZERO Dynamic Property usage

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { getTPS, getTPSMin, getTPSMax, getTPSColor, buildTPSBar, getUptime, resetTPSStats, getTPSTrend } from "./tps_tracker.js";
import { getEntityCounts } from "./entity_counter.js";
import {
  isThrottleEnabled, setThrottleEnabled, getThrottleLevel_,
  getTotalCleaned, resetTotalCleaned, manualCleanHostile, manualCleanItems,
  isSpawnPaused, isThrottleChatMuted, toggleThrottleChatMute,
} from "./auto_throttle.js";
import { getDPStats, formatBytes, cleanupInactive } from "../../dp_manager.js";

const ADMIN_TAG = "mimi";
const LINE      = "§8═══════════════════";
const LINE_THIN = "§8───────────────────";
const SP        = "";
const fmt = (n) => Math.floor(n).toLocaleString("id-ID");
const activeSessions = new Set();

// Bedrock mob cap reference (per dimension):
//   Global cap: 200 naturally spawned mobs (hostile+passive combined)
//   NOT per-player — shared across all players
//   Items/XP orbs do NOT count toward mob cap
//   Spawner/command mobs bypass cap but still cause lag
// Thresholds below = practical lag indicators across ALL 3 dimensions
const CAP = {
  H_SAFE: 70,  H_WARN: 120, H_MAX: 200,   // hostile across all dims
  P_SAFE: 20,  P_MAX: 50,                   // passive across all dims
  V_SAFE: 15,  V_WARN: 30,  V_MAX: 60,     // villagers — heaviest AI (pathfinding+gossip)
  I_SAFE: 50,  I_WARN: 100, I_CRIT: 200,   // items (no cap, but cause lag)
  E_SAFE: 200, E_WARN: 350, E_CRIT: 500,   // total entity (all types)
  DIM_CAP: 200,                              // Bedrock's actual per-dimension cap
};

function buildCapBar(cur, max, w = 10) {
  const pct = Math.min(1, Math.max(0, cur / max));
  const f = Math.round(pct * w);
  const col = pct >= 0.85 ? "§c" : pct >= 0.6 ? "§e" : "§a";
  return col + "█".repeat(f) + "§8" + "░".repeat(w - f);
}

function profilePlayers() {
  const results = [];
  try {
    const players = world.getPlayers();
    for (const p of players) {
      let score = 0, details = [], rd = 0;
      try {
        const nearby = p.dimension.getEntities({ location: p.location, maxDistance: 32 });
        const ents = nearby.length;
        score += ents * 2;
        const items = nearby.filter(e => e.typeId === "minecraft:item" || e.typeId === "minecraft:xp_orb").length;
        score += items * 3;
        details.push(`${ents}ent`);
        if (items > 0) details.push(`${items}itm`);
      } catch {}
      try {
        const inv = p.getComponent("minecraft:inventory")?.container;
        if (inv) {
          let slots = 0;
          for (let i = 0; i < inv.size; i++) { if (inv.getItem(i)) slots++; }
          if (slots > 30) { score += (slots - 30) * 1; details.push(`${slots}inv`); }
        }
      } catch {}
      try {
        const fx = p.getEffects();
        if (fx && fx.length > 3) { score += fx.length * 2; details.push(`${fx.length}fx`); }
      } catch {}
      try {
        if (p.dimension.id === "minecraft:nether") { score += 5; details.push("neth"); }
        if (p.dimension.id === "minecraft:the_end") { score += 3; details.push("end"); }
      } catch {}
      try {
        rd = p.clientSystemInfo?.maxRenderDistance ?? 0;
        if (rd > 0) {
          const chunks = (rd * 2 + 1) ** 2;
          if (rd > 16) score += Math.floor((rd - 16) * 3);
          details.push(`${rd}ch`);
        }
      } catch {}
      results.push({ name: p.name, score, details: details.join(","), rd });
    }
  } catch {}
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 10);
}


function tpsStatusLabel(tps) {
  if (tps >= 18) return "§a■ STABIL";
  if (tps >= 15) return "§e■ WARNING";
  if (tps >= 10) return "§6■ DANGER";
  return "§c■ CRITICAL";
}

function tpsStatusIcon(tps) {
  if (tps >= 18) return "§a✔";
  if (tps >= 15) return "§e⚠";
  if (tps >= 10) return "§6⚠";
  return "§c✘";
}

// ═══════════════════════════════════════════════════════════
// MAIN MENU — Server Health Dashboard
// ═══════════════════════════════════════════════════════════
async function openMonitor(player) {
  if (activeSessions.has(player.id)) return;
  activeSessions.add(player.id);
  try { await _menuLoop(player); }
  finally { activeSessions.delete(player.id); }
}

async function _menuLoop(player) {
  while (true) {
    const tps       = getTPS();
    const tpsMin    = getTPSMin();
    const tpsMax    = getTPSMax();
    const ec        = getEntityCounts();
    const uptime    = getUptime();
    const throttle  = isThrottleEnabled();
    const level     = getThrottleLevel_();
    const cleaned   = getTotalCleaned();
    const col       = getTPSColor(tps);
    const bar       = buildTPSBar(tps);
    const players   = world.getPlayers();
    const pCount    = players.length;

    let body = `${LINE}\n`;
    body += `§6  ★ S E R V E R   H E A L T H\n`;
    body += `${LINE}\n\n`;

    // TPS Section
    const trend = getTPSTrend();
    const trendCol = trend.trend === "down" ? "§c" : trend.trend === "up" ? "§a" : "§8";
    body += `  §6◆ §eTPS\n`;
    body += `  §8├ ${col}${tps} §8[${bar}§8]\n`;
    body += `  §8├ ${tpsStatusIcon(tps)} ${tpsStatusLabel(tps)} ${trendCol}${trend.label}\n`;
    body += `  §8└ §8Range: §f${tpsMin} §8~ §f${tpsMax}\n`;
    body += `\n`;

    // Mob Cap Summary
    const hBar = buildCapBar(ec.hostile, CAP.H_MAX, 8);
    const pBar = buildCapBar(ec.passive, CAP.P_MAX, 8);
    body += `  §c⚔ §eMob Cap\n`;
    body += `  §8├ §cHostile §f${fmt(ec.hostile)}§8/${CAP.H_MAX} §8[${hBar}§8]\n`;
    body += `  §8├ §aPassive §f${fmt(ec.passive)}§8/${CAP.P_MAX} §8[${pBar}§8]\n`;
    body += `  §8├ §2Villager §f${fmt(ec.villagers)}§8/${CAP.V_MAX}\n`;
    body += `  §8└ §eItems: §f${fmt(ec.items)} §8| §fTotal: §e${fmt(ec.total)}\n`;
    body += `\n`;

    // Server Info
    body += `  §a⚙ §eServer\n`;
    body += `  §8├ §bPlayers: §f${pCount} §8online\n`;
    body += `  §8└ §bUptime: §f${uptime}\n`;
    body += `\n${LINE_THIN}\n`;

    // Throttle Status
    const throttleColor = throttle ? "§a" : "§c";
    const throttleLabel = throttle ? "ON" : "OFF";
    const levelBadge = level > 0 ? ` §8[§cLevel ${level}§8]§c` : "";
    const spawnBadge = isSpawnPaused() ? " §8[§cSpawn Paused§8]§c" : "";
    body += `  §e⛃ §eAuto-Throttle: ${throttleColor}${throttleLabel}${levelBadge}${spawnBadge}\n`;
    const chatMuted = isThrottleChatMuted(player);
    const chatColor = chatMuted ? "§c" : "§a";
    const chatLabel = chatMuted ? "MUTED" : "ON";
    body += `  §8├ §eChat Alert: ${chatColor}${chatLabel}\n`;
    body += `  §8└ §eCleaned: §f${fmt(cleaned)} §8entity total\n`;

    body += `\n${LINE}`;

    const form = new ActionFormData()
      .title("§8 ♦ §6MONITOR§r §8♦ §r")
      .body(body);
    const btns = [];

    form.button(`§c  Emergency Clean\n§r  §eHapus hostile mob jauh`, "textures/items/diamond_sword");
    btns.push("clean_hostile");

    form.button(`§e  Clean Items\n§r  §eHapus item & orb di ground`, "textures/items/iron_shovel");
    btns.push("clean_items");

    form.button(`${throttle ? "§c" : "§a"}  Auto-Throttle: ${throttleLabel}\n§r  §eToggle auto-response`, "textures/items/compass_item");
    btns.push("toggle_throttle");

    const hudActive = player.hasTag("monitor");
    form.button(`§b  Toggle HUD\n§r  §e${hudActive ? "HUD aktif" : "HUD mati"}`, "textures/items/spyglass");
    btns.push("toggle_hud");

    const chatMutedBtn = isThrottleChatMuted(player);
    form.button(`${chatMutedBtn ? "§a" : "§c"}  Throttle Chat: ${chatMutedBtn ? "MUTED" : "ON"}\n§r  §eToggle pesan throttle di chat`, "textures/items/book_writable");
    btns.push("toggle_chat_mute");

    form.button(`§c  Top Lag Player\n§r  §ePlayer berpotensi lag`, "textures/items/redstone_dust");
    btns.push("lag_profile");

    form.button(`§6  Mob Cap\n§r  §eKapasitas mob per kategori`, "textures/items/egg");
    btns.push("mob_cap");

    form.button(`§f  Entity Top\n§r  §eMob terbanyak per tipe`, "textures/items/bone");
    btns.push("entity_top");

    form.button(`§e  Lag Analyzer\n§r  §eDeteksi penyebab TPS drop`, "textures/items/blaze_powder");
    btns.push("lag_analyze");

    form.button(`§c  Lag Contributors\n§r  §eRanking penyumbang lag`, "textures/items/blaze_rod");
    btns.push("lag_contrib");

    form.button(`§b  Spawn Fairness\n§r  §eDistribusi mob per player`, "textures/items/ender_eye");
    btns.push("spawn_fair");

    form.button(`§d  DP Dashboard\n§r  §eDynamic Property usage`, "textures/items/paper");
    btns.push("dp_dash");

    form.button(`§f  Reset Stats\n§r  §eReset min/max TPS & counter`, "textures/items/clock_item");
    btns.push("reset");

    form.button(`§6  Refresh\n§r  §eUpdate data terbaru`, "textures/items/arrow");
    btns.push("refresh");

    form.button("§6  Tutup", "textures/items/redstone_dust");
    btns.push("close");

    try { player.playSound("random.click", { pitch: 1.3, volume: 0.7 }); } catch {}
    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "close") return;

    const action = btns[res.selection];

    if (action === "clean_hostile") {
      const confirm = await new MessageFormData()
        .title("§8 ♦ §cEMERGENCY§r §8♦ §r")
        .body(
          `${LINE}\n` +
          `§c  EMERGENCY CLEAN\n` +
          `${LINE}\n${SP}\n` +
          `  §c⚠ §eHapus semua hostile mob\n` +
          `  §8  yang jauh dari player?\n${SP}\n` +
          `  §8├ §aMob dengan nametag §8— §aDilindungi\n` +
          `  §8├ §aVillager, Boss §8— §aDilindungi\n` +
          `  §8└ §cHostile tanpa nama §8— §cDihapus\n` +
          `${SP}\n${LINE}`
        )
        .button1("§f Batal").button2("§c Hapus Sekarang").show(player);
      if (confirm.selection === 1) {
        const removed = manualCleanHostile();
        try { player.playSound("random.levelup", { pitch: 1.0, volume: 1.0 }); } catch {}
        player.sendMessage(`§8[§aMonitor§8] §f${removed} §ehostile mob dihapus.`);
      }
      continue;
    }

    if (action === "clean_items") {
      const confirm = await new MessageFormData()
        .title("§8 ♦ §eCLEAN ITEMS§r §8♦ §r")
        .body(
          `${LINE}\n` +
          `§e  CLEAN ITEMS\n` +
          `${LINE}\n${SP}\n` +
          `  §e⚠ §eHapus semua item & XP orb\n` +
          `  §8  di ground semua dimensi?\n${SP}\n` +
          `  §8├ §cItem di ground §8— §cDihapus\n` +
          `  §8└ §cXP Orb §8— §cDihapus\n` +
          `${SP}\n${LINE}`
        )
        .button1("§f Batal").button2("§e Hapus").show(player);
      if (confirm.selection === 1) {
        const removed = manualCleanItems();
        try { player.playSound("random.levelup", { pitch: 1.5, volume: 1.0 }); } catch {}
        player.sendMessage(`§8[§aMonitor§8] §f${removed} §eitem/orb dihapus.`);
      }
      continue;
    }

    if (action === "toggle_throttle") {
      setThrottleEnabled(!isThrottleEnabled());
      player.sendMessage(`§8[§aMonitor§8] Auto-Throttle: ${isThrottleEnabled() ? "§aON" : "§cOFF"}`);
      continue;
    }

    if (action === "toggle_hud") {
      if (player.hasTag("monitor")) {
        player.removeTag("monitor");
        player.sendMessage("§8[§aMonitor§8] §fHUD §cdimatikan");
      } else {
        player.addTag("monitor");
        player.sendMessage("§8[§aMonitor§8] §fHUD §adiaktifkan §8- live TPS di actionbar");
      }
      continue;
    }

    if (action === "toggle_chat_mute") {
      const muted = toggleThrottleChatMute(player);
      player.sendMessage(`§8[§aMonitor§8] Throttle Chat: ${muted ? "§cMUTED §8- tidak terima pesan throttle" : "§aON §8- pesan throttle aktif"}`);
      continue;
    }

    if (action === "reset") {
      resetTPSStats();
      resetTotalCleaned();
      player.sendMessage("§8[§aMonitor§8] §eStats direset.");
      continue;
    }

    if (action === "lag_profile") {
      await showLagProfile(player);
      continue;
    }

    if (action === "mob_cap") {
      await showMobCap(player);
      continue;
    }

    if (action === "entity_top") {
      await showEntityTop(player);
      continue;
    }

    if (action === "lag_analyze") {
      await showLagAnalyzer(player);
      continue;
    }

    if (action === "lag_contrib") {
      await showLagContributors(player);
      continue;
    }

    if (action === "spawn_fair") {
      await showSpawnFairness(player);
      continue;
    }

    if (action === "dp_dash") {
      await showDPDashboard(player);
      continue;
    }
  }
}

async function showLagProfile(player) {
  const profiles = profilePlayers();
  let body = `${LINE}\n§c  ★ T O P   L A G\n${LINE}\n\n`;
  if (!profiles.length) {
    body += "  §8Tidak ada data.\n";
  } else {
    const medals = ["§c❶", "§6❷", "§e❸"];
    profiles.forEach((p, i) => {
      const rank = i < 3 ? medals[i] : `§8${i + 1}.`;
      const bar = p.score >= 100 ? "§c" : p.score >= 50 ? "§6" : "§a";
      const rdLabel = p.rd > 0 ? ` §8RD:§f${p.rd}` : "";
      const rdWarn = p.rd > 16 ? " §c!" : "";
      body += `  ${rank} ${bar}${p.name}${rdWarn}\n`;
      body += `  §8   ⚡ Score: §f${p.score}${rdLabel} §8| §7${p.details}\n`;
    });
  }
  body += `\n  §e◆ §eSkor Formula\n${LINE_THIN}\n`;
  body += `  §8├ §fEntity nearby §8×2 + §fItems §8×3\n`;
  body += `  §8├ §fEffects §8(>3) §8×2 + §fDimension\n`;
  body += `  §8└ §fRenderDist §8(>16) §8×3\n`;
  body += `\n  §b✦ §eRender Distance\n${LINE_THIN}\n`;
  if (profiles.length > 0) {
    for (const p of profiles) {
      if (p.rd > 0) {
        const chunks = (p.rd * 2 + 1) ** 2;
        const rdColor = p.rd > 16 ? "§c" : p.rd > 10 ? "§e" : "§a";
        body += `  §8├ §f${p.name} §8── ${rdColor}${p.rd} chunks §8(${chunks} total)\n`;
      }
    }
    if (!profiles.some(p => p.rd > 0)) body += "  §8└ §8Data tidak tersedia.\n";
  }
  body += `\n${LINE}`;
  await new ActionFormData()
    .title("§8 ◆ §cLAG PROFILE§r §8◆ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function showDPDashboard(player) {
  const stats = getDPStats();
  const pct = ((stats.totalBytes / 1_000_000) * 100).toFixed(1);
  const barW = 12;
  const filled = Math.min(barW, Math.round((stats.totalBytes / 1_000_000) * barW));
  const dpBar = (filled >= barW * 0.8 ? "§c" : filled >= barW * 0.5 ? "§e" : "§a")
    + "█".repeat(filled) + "§8" + "░".repeat(barW - filled);

  let body = `${LINE}\n§d  DP DASHBOARD\n${LINE}\n\n`;
  body += `  §e◆ §eKapasitas\n`;
  body += `${LINE_THIN}\n`;
  body += `  §8├ §fUsage   §8── ${dpBar} §f${formatBytes(stats.totalBytes)}\n`;
  body += `  §8├ §fPersen  §8── §f${pct}%% §8dari 1MB\n`;
  body += `  §8├ §fTotal Key §8─ §f${fmt(stats.keyCount)}\n`;
  body += `  §8├ §fPlayer Key§8─ §f${fmt(stats.playerKeyCount)}\n`;
  body += `  §8├ §fGlobal Key§8─ §f${fmt(stats.globalKeyCount)}\n`;
  body += `  §8└ §fTracked   §8─ §f${fmt(stats.trackedPlayers)} player\n\n`;
  body += `${LINE}`;

  const form = new ActionFormData()
    .title("§8 ◆ §dDP USAGE§r §8◆ §r")
    .body(body);
  form.button("§c  Cleanup Inaktif (30d)\n§r  §eHapus data player lama", "textures/items/iron_shovel");
  form.button("§6  Kembali", "textures/items/arrow");
  const res = await form.show(player);
  if (!res.canceled && res.selection === 0) {
    const r = cleanupInactive(30, true);
    player.sendMessage(`§8[§aDP§8] Cleanup: §f${r.players} §eplayer, §f${r.keys} §ekeys dihapus.`);
  }
}

// ═══════════════════════════════════════════════════════════
// MOB CAP DASHBOARD — uses cached entity data, zero cost
// ═══════════════════════════════════════════════════════════
async function showMobCap(player) {
  const ec = getEntityCounts();
  const hPct = Math.round(ec.hostile / CAP.H_MAX * 100);
  const pPct = Math.round(ec.passive / CAP.P_MAX * 100);
  const vPct = Math.round(ec.villagers / CAP.V_MAX * 100);
  const hStatus = ec.hostile >= CAP.H_MAX ? "§c✘ PENUH" : ec.hostile >= CAP.H_WARN ? "§e⚠ TINGGI" : "§a✔ Normal";
  const pStatus = ec.passive >= CAP.P_MAX ? "§c✘ PENUH" : ec.passive >= CAP.P_SAFE ? "§e⚠ TINGGI" : "§a✔ Normal";
  const vStatus = ec.villagers >= CAP.V_MAX ? "§c✘ KRITIS" : ec.villagers >= CAP.V_WARN ? "§e⚠ TINGGI" : "§a✔ Normal";
  const iStatus = ec.items >= CAP.I_CRIT ? "§c✘ KRITIS" : ec.items >= CAP.I_WARN ? "§e⚠ TINGGI" : "§a✔ Normal";

  let body = `${LINE}\n§6  ★ M O B   C A P\n${LINE}\n\n`;

  body += `  §c⚔ §eHostile\n`;
  body += `  §8├ §fCount  §8── §f${fmt(ec.hostile)} §8/ §f${CAP.H_MAX}\n`;
  body += `  §8├ §8[${buildCapBar(ec.hostile, CAP.H_MAX)}§8] §f${hPct}%%\n`;
  body += `  §8├ ${hStatus}\n`;
  body += `  §8└ §8OW:§f${fmt(ec.hostilePerDim.OW)} §8| N:§f${fmt(ec.hostilePerDim.N)} §8| E:§f${fmt(ec.hostilePerDim.E)}\n\n`;

  body += `  §a♦ §ePassive\n`;
  body += `  §8├ §fCount  §8── §f${fmt(ec.passive)} §8/ §f${CAP.P_MAX}\n`;
  body += `  §8├ §8[${buildCapBar(ec.passive, CAP.P_MAX)}§8] §f${pPct}%%\n`;
  body += `  §8├ ${pStatus}\n`;
  body += `  §8└ §8OW:§f${fmt(ec.passivePerDim.OW)} §8| N:§f${fmt(ec.passivePerDim.N)} §8| E:§f${fmt(ec.passivePerDim.E)}\n\n`;

  body += `  §2♦ §eVillager §8(heaviest AI)\n`;
  body += `  §8├ §fCount  §8── §f${fmt(ec.villagers)} §8/ §f${CAP.V_MAX}\n`;
  body += `  §8├ §8[${buildCapBar(ec.villagers, CAP.V_MAX)}§8] §f${vPct}%%\n`;
  body += `  §8└ ${vStatus}\n\n`;

  body += `  §e⛃ §eItems / Orb\n`;
  body += `  §8├ §fCount  §8── §f${fmt(ec.items)}\n`;
  body += `  §8└ ${iStatus}\n\n`;

  body += `  §b✦ §eTotal Entity\n`;
  body += `  §8├ §fTotal  §8── §e${fmt(ec.total)}\n`;
  body += `  §8├ §8[${buildCapBar(ec.total, CAP.E_CRIT)}§8]\n`;
  body += `  §8└ §8OW:§f${fmt(ec.perDim.OW)} §8| N:§f${fmt(ec.perDim.N)} §8| E:§f${fmt(ec.perDim.E)}\n\n`;

  // Per-dimension cap (Bedrock = 200 natural mobs per dim)
  const owMob = ec.hostilePerDim.OW + ec.passivePerDim.OW;
  const nMob  = ec.hostilePerDim.N  + ec.passivePerDim.N;
  const eMob  = ec.hostilePerDim.E  + ec.passivePerDim.E;
  body += `  §6★ §ePer-Dimension Cap §8(Bedrock: 200/dim)\n`;
  body += `  §8├ §fOW §8[${buildCapBar(owMob, CAP.DIM_CAP, 6)}§8] §f${owMob}§8/${CAP.DIM_CAP}\n`;
  body += `  §8├ §fN  §8[${buildCapBar(nMob, CAP.DIM_CAP, 6)}§8] §f${nMob}§8/${CAP.DIM_CAP}\n`;
  body += `  §8└ §fE  §8[${buildCapBar(eMob, CAP.DIM_CAP, 6)}§8] §f${eMob}§8/${CAP.DIM_CAP}\n`;
  body += `  §8  §7Cap shared, tidak scale per player\n`;

  if (owMob >= 180 || nMob >= 180 || eMob >= 180) {
    body += `\n${LINE_THIN}\n`;
    body += `  §c⚠ §eDim cap hampir penuh!\n`;
    body += `  §8└ §fSpawn bisa berhenti di dimensi tersebut\n`;
  }

  body += `\n${LINE}`;
  await new ActionFormData()
    .title("§8 ◆ §6MOB CAP§r §8◆ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// LAG ANALYZER — automated cause detection from cached data
// ═══════════════════════════════════════════════════════════
function detectLagCauses() {
  const causes = [];
  const ec = getEntityCounts();
  const tps = getTPS();
  const trend = getTPSTrend();

  if (ec.total > CAP.E_WARN) {
    const sev = ec.total > CAP.E_CRIT ? 90 : 60;
    causes.push({ score: sev, color: sev > 70 ? "§c" : "§6", label: "Entity Overload",
      detail: `§fTotal: §e${fmt(ec.total)} §8entity`, sub: `§f${Math.round(ec.total / CAP.E_SAFE * 100)}%% §8dari safe limit`,
      fix: "Clean hostile & items" });
  }
  if (ec.hostile > CAP.H_WARN) {
    const sev = ec.hostile > CAP.H_MAX ? 85 : 55;
    causes.push({ score: sev, color: sev > 70 ? "§c" : "§6", label: "Hostile Mob Cap",
      detail: `§fHostile: §c${fmt(ec.hostile)}§8/${CAP.H_MAX}`, sub: "§fMob cap hampir/sudah penuh",
      fix: "Emergency clean hostile" });
  }
  if (ec.items > CAP.I_WARN) {
    const sev = ec.items > CAP.I_CRIT ? 70 : 40;
    causes.push({ score: sev, color: sev > 50 ? "§c" : "§e", label: "Item/Orb Spam",
      detail: `§f${fmt(ec.items)} §8item di ground`, sub: sev > 50 ? "§cSangat banyak!" : "§ePerlu dibersihkan",
      fix: "Clean items & orbs" });
  }
  if (ec.hostilePerDim.N > 50) {
    causes.push({ score: 35, color: "§6", label: "Nether Entity Load",
      detail: `§fNether hostile: §c${fmt(ec.hostilePerDim.N)}`, sub: "§fNether berat — banyak mob",
      fix: "Clean hostile di nether" });
  }
  // Villager overload — heaviest AI mob due to pathfinding, gossip, workstation linking
  if (ec.villagers > CAP.V_WARN) {
    const sev = ec.villagers > CAP.V_MAX ? 80 : 50;
    causes.push({ score: sev, color: sev > 60 ? "§c" : "§6", label: "Villager Overload",
      detail: `§fVillager: §2${fmt(ec.villagers)}§8/${CAP.V_MAX}`,
      sub: "§fPathfinding + gossip = heavy CPU",
      fix: "Kurangi villager breeding farm" });
  }
  try {
    for (const p of world.getPlayers()) {
      try {
        const rd = p.clientSystemInfo?.maxRenderDistance ?? 0;
        if (rd > 16) {
          const ch = (rd * 2 + 1) ** 2;
          causes.push({ score: Math.min(50, (rd - 16) * 5), color: "§e", label: `RD Tinggi: ${p.name}`,
            detail: `§fRD §e${rd} §8(${ch} chunks)`, sub: "§fChunk loading berlebihan",
            fix: `Minta ${p.name} turunkan RD` });
        }
      } catch {}
    }
  } catch {}
  if (trend.trend === "down" && trend.delta < -2) {
    causes.push({ score: 45, color: "§c", label: "TPS Menurun",
      detail: `§fTrend: ${trend.label} §8(${trend.delta})`, sub: "§fTPS terus menurun",
      fix: "Pantau & clean jika perlu" });
  }
  // Hint: TPS low but entities normal → likely redstone/command block
  if (tps < 15 && ec.total < CAP.E_SAFE) {
    causes.push({ score: 30, color: "§d", label: "Non-Entity Lag",
      detail: `§fEntity normal §8(${fmt(ec.total)}) §ftapi TPS rendah`,
      sub: "§fKemungkinan: redstone, command block, plugin",
      fix: "Cek redstone clock atau command block" });
  }
  causes.sort((a, b) => b.score - a.score);
  return causes;
}

async function showLagAnalyzer(player) {
  const tps = getTPS();
  const trend = getTPSTrend();
  const col = getTPSColor(tps);
  const ec = getEntityCounts();
  const causes = detectLagCauses();

  let body = `${LINE}\n§e  ★ L A G   A N A L Y S I S\n${LINE}\n\n`;
  const trendCol = trend.trend === "down" ? "§c" : trend.trend === "up" ? "§a" : "§8";
  body += `  §6◆ §eTPS: ${col}${tps} §8— ${tpsStatusLabel(tps)}\n`;
  body += `  §8└ §eTrend: ${trendCol}${trend.label}${trend.delta !== 0 ? ` §8(${trend.delta > 0 ? "+" : ""}${trend.delta})` : ""}\n\n`;

  if (!causes.length) {
    body += `  §a✔ §fTidak ada masalah terdeteksi\n`;
    body += `  §8└ §fServer berjalan normal\n`;
  } else {
    body += `  §c⚠ §ePenyebab Terdeteksi §8(${causes.length})\n`;
    body += `${LINE_THIN}\n`;
    for (let i = 0; i < Math.min(causes.length, 6); i++) {
      const c = causes[i];
      body += `\n  ${c.color}■ §e${c.label}\n`;
      body += `  §8  ├ ${c.detail}\n`;
      body += `  §8  └ ${c.sub}\n`;
    }
    body += `\n  §a◆ §eRekomendasi\n${LINE_THIN}\n`;
    const seen = new Set();
    let recNum = 1;
    for (const c of causes) {
      if (seen.has(c.fix)) continue;
      seen.add(c.fix);
      body += `  §8${recNum}. §f${c.fix}\n`;
      recNum++;
      if (recNum > 4) break;
    }
  }
  body += `\n${LINE}`;

  const form = new ActionFormData().title("§8 ◆ §eLAG ANALYSIS§r §8◆ §r").body(body);
  const btns = [];

  if (ec.hostile > CAP.H_WARN) {
    form.button(`§c  Clean Hostile Jauh\n§r  §eHapus hostile >32blok`, "textures/items/diamond_sword");
    btns.push("clean_hostile");
  }
  if (ec.items > CAP.I_WARN) {
    form.button(`§e  Clean Items\n§r  §eHapus items & orb`, "textures/items/iron_shovel");
    btns.push("clean_items");
  }
  try {
    for (const p of world.getPlayers()) {
      try {
        const rd = p.clientSystemInfo?.maxRenderDistance ?? 0;
        if (rd > 16 && p.id !== player.id) {
          form.button(`§e  Warning: ${p.name}\n§r  §8RD ${rd} — kirim peringatan`, "textures/items/paper");
          btns.push("warn:" + p.id);
        }
      } catch {}
    }
  } catch {}

  form.button("§6  Kembali", "textures/items/arrow");
  btns.push("back");

  const res = await form.show(player);
  if (res.canceled || btns[res.selection] === "back") return;

  const action = btns[res.selection];
  if (action === "clean_hostile") {
    const removed = manualCleanHostile();
    try { player.playSound("random.levelup", { pitch: 1.0, volume: 1.0 }); } catch {}
    player.sendMessage(`§8[§aMonitor§8] §f${removed} §ehostile mob dihapus.`);
  } else if (action === "clean_items") {
    const removed = manualCleanItems();
    try { player.playSound("random.levelup", { pitch: 1.5, volume: 1.0 }); } catch {}
    player.sendMessage(`§8[§aMonitor§8] §f${removed} §eitem/orb dihapus.`);
  } else if (action.startsWith("warn:")) {
    const targetId = action.slice(5);
    const target = world.getPlayers().find(p => p.id === targetId);
    if (target) {
      const rd = target.clientSystemInfo?.maxRenderDistance ?? 0;
      target.sendMessage(`§8[§eServer§8]§e §c⚠ §fRD kamu §c${rd} §fterlalu tinggi, turunkan ke §a12 §fagar server lancar.`);
      try { target.playSound("note.bass", { pitch: 0.5, volume: 1.0 }); } catch {}
      player.sendMessage(`§8[§aMonitor§8] §eWarning RD dikirim ke §f${target.name}`);
    } else {
      player.sendMessage(`§8[§cMonitor§8]§c Player sudah offline.`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// SPAWN FAIRNESS — on-demand per-player scan (only when opened)
// ═══════════════════════════════════════════════════════════
function analyzeSpawnFairness() {
  const results = [];
  try {
    const players = world.getPlayers();
    let totalNearby = 0;
    for (const p of players) {
      let hostile = 0, passive = 0, total = 0;
      let dimId = "";
      try {
        const loc = p.location;
        const dim = p.dimension;
        dimId = dim.id;
        total = dim.getEntities({ location: loc, maxDistance: 32 }).length;
        try { hostile = dim.getEntities({ location: loc, maxDistance: 32, families: ["monster"] }).length; } catch {}
        try { passive = dim.getEntities({ location: loc, maxDistance: 32, families: ["animal"] }).length; } catch {}
      } catch {}
      const other = Math.max(0, total - hostile - passive - 1);
      results.push({ name: p.name, total, hostile, passive, other, dimId });
      totalNearby += total;
    }
    for (const r of results) {
      r.share = totalNearby > 0 ? Math.round((r.total / totalNearby) * 100) : 0;
    }
    results.sort((a, b) => b.total - a.total);
  } catch {}
  return results;
}

async function showSpawnFairness(player) {
  const data = analyzeSpawnFairness();
  const playerCount = data.length;

  let body = `${LINE}\n§b  ★ S P A W N   F A I R N E S S\n${LINE}\n\n`;

  const fairShare = playerCount > 0 ? Math.round(100 / playerCount) : 100;
  const monopolizers = [];

  if (!data.length) {
    body += "  §8Tidak ada data.\n";
  } else {
    body += `  §b◆ §eEntity dalam 32 blok per player\n`;
    body += `  §8  Fair share: §f~${fairShare}%% §8per player\n${LINE_THIN}\n`;

    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const shareCol = r.share > fairShare * 2 ? "§c" : r.share > fairShare * 1.3 ? "§e" : "§a";
      const barLen = Math.min(8, Math.max(1, Math.round(r.share / 12.5)));
      const shareBar = shareCol + "■".repeat(barLen);
      const dimLabel = r.dimId === "minecraft:nether" ? " §cN" : r.dimId === "minecraft:the_end" ? " §dE" : "";
      body += `\n  §f${r.name}${dimLabel}\n`;
      body += `  §8  ├ §fTotal: §e${r.total} §8(${shareCol}${r.share}%%§8) ${shareBar}\n`;
      body += `  §8  └ §cH:§f${r.hostile} §aP:§f${r.passive} §8Other:§f${r.other}\n`;
    }

    monopolizers.push(...data.filter(r => r.share > fairShare * 2 && r.total > 20));
    if (monopolizers.length > 0) {
      body += `\n${LINE_THIN}\n`;
      body += `  §c⚠ §eMonopoli Spawn Terdeteksi\n`;
      for (const m of monopolizers) {
        body += `  §8└ §c${m.name} §f= ${m.total} entity §8(${m.share}%%)\n`;
      }
      body += `\n  §e◆ §eSaran\n`;
      body += `  §8├ §fAFK farm bisa monopoli mob cap\n`;
      body += `  §8├ §fSpread player lebih merata\n`;
      body += `  §8└ §fGunakan tombol di bawah untuk clean\n`;
    } else {
      body += `\n${LINE_THIN}\n`;
      body += `  §a✔ §fDistribusi spawn merata\n`;
    }
  }

  body += `\n${LINE}`;

  const form = new ActionFormData().title("§8 ◆ §bSPAWN FAIR§r §8◆ §r").body(body);
  const btns = [];

  for (const m of monopolizers) {
    if (m.hostile > 5) {
      form.button(`§c  Clean Area: ${m.name}\n§r  §eHapus hostile 16-48 blok`, "textures/items/diamond_sword");
      btns.push("clean:" + m.name);
    }
  }

  form.button("§6  Kembali", "textures/items/arrow");
  btns.push("back");

  const res = await form.show(player);
  if (res.canceled || btns[res.selection] === "back") return;

  const action = btns[res.selection];
  if (action.startsWith("clean:")) {
    const targetName = action.slice(6);
    const target = world.getPlayers().find(p => p.name === targetName);
    if (!target) { player.sendMessage(`§8[§cMonitor§8]§c ${targetName} sudah offline.`); return; }
    const removed = smartCleanArea(target);
    try { player.playSound("random.levelup", { pitch: 1.0, volume: 1.0 }); } catch {}
    player.sendMessage(`§8[§aMonitor§8] §f${removed} §ehostile mob dihapus di area §f${targetName}§e.`);
  }
}

// Smart clean: remove hostile mobs 16-48 blocks from target (spare nearby mobs they're fighting)
function smartCleanArea(target) {
  let removed = 0;
  try {
    const dim = target.dimension;
    const loc = target.location;
    // Get hostiles in 48 block radius
    const far = dim.getEntities({ location: loc, maxDistance: 48, families: ["monster"] });
    for (const e of far) {
      try {
        if (e.nameTag && e.nameTag.trim()) continue;
        const dx = e.location.x - loc.x, dy = e.location.y - loc.y, dz = e.location.z - loc.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        // Only remove mobs between 16-48 blocks (spare close ones player is fighting)
        if (distSq >= 256) { // 16^2
          e.remove();
          removed++;
        }
      } catch {}
    }
  } catch {}
  return removed;
}

// ═══════════════════════════════════════════════════════════
// ENTITY TOP — on-demand type breakdown (only when opened)
// ═══════════════════════════════════════════════════════════
function scanEntityBreakdown() {
  const typeMap = new Map();
  const dimBreak = {};
  try {
    for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
      try {
        const dim = world.getDimension(dimId);
        const entities = dim.getEntities();
        for (const e of entities) {
          try {
            const tid = e.typeId;
            if (!tid || tid === "minecraft:player") continue;
            typeMap.set(tid, (typeMap.get(tid) || 0) + 1);
            if (!dimBreak[tid]) dimBreak[tid] = { OW: 0, N: 0, E: 0 };
            if (dimId === "minecraft:overworld") dimBreak[tid].OW++;
            else if (dimId === "minecraft:nether") dimBreak[tid].N++;
            else dimBreak[tid].E++;
          } catch {}
        }
      } catch {}
    }
  } catch {}
  const sorted = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
  return { sorted, dimBreak };
}

function shortTypeName(typeId) {
  return typeId.replace("minecraft:", "").replace(/_v2$/, "");
}

async function showEntityTop(player) {
  const { sorted, dimBreak } = scanEntityBreakdown();
  const totalEntity = sorted.reduce((s, e) => s + e[1], 0);

  let body = `${LINE}\n§f  ★ E N T I T Y   T O P\n${LINE}\n\n`;
  body += `  §b◆ §eTotal Entity: §f${fmt(totalEntity)}\n${LINE_THIN}\n`;

  if (!sorted.length) {
    body += "  §8Tidak ada data.\n";
  } else {
    const top = sorted.slice(0, 15);
    const maxCount = top[0][1];
    for (let i = 0; i < top.length; i++) {
      const [tid, count] = top[i];
      const name = shortTypeName(tid);
      const pct = Math.round(count / totalEntity * 100);
      const barLen = Math.max(1, Math.round(count / maxCount * 6));
      const col = count > 40 ? "§c" : count > 20 ? "§e" : "§a";
      const bar = col + "■".repeat(barLen);
      const db = dimBreak[tid] || { OW: 0, N: 0, E: 0 };
      const dimInfo = db.N > 0 || db.E > 0 ? ` §8[${db.OW}/${db.N}/${db.E}]` : "";
      const pad = name.length < 16 ? " ".repeat(16 - name.length) : " ";
      body += `  §8${String(i + 1).padStart(2, " ")}. §f${name}${pad}${col}${count} §8(${pct}%%) ${bar}${dimInfo}\n`;
    }

    // Warnings for concerning counts
    const warnings = sorted.filter(([, c]) => c > 30);
    if (warnings.length > 0) {
      body += `\n${LINE_THIN}\n`;
      body += `  §c⚠ §eTerlalu Banyak\n`;
      for (const [tid, count] of warnings.slice(0, 5)) {
        body += `  §8└ §c${shortTypeName(tid)} §f= ${count}\n`;
      }
    }
  }

  body += `\n${LINE}`;
  await new ActionFormData()
    .title("§8 ◆ §fENTITY TOP§r §8◆ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

// ═══════════════════════════════════════════════════════════
// LAG CONTRIBUTORS — Unified ranking from 3 sources:
//   1. Entity Types (by count & lag weight)
//   2. Chunk Hotspots (entity density per 16x16 area)
//   3. Player Proximity (entities near each player)
// All data gathered on-demand (only when menu is opened)
// ═══════════════════════════════════════════════════════════

const CONTRIB_CAT = {
  MOB:    { badge: "§c⚔", color: "§c", label: "Mob" },
  ITEM:   { badge: "§e⛃", color: "§e", label: "Item" },
  CHUNK:  { badge: "§6◆", color: "§6", label: "Chunk" },
  PLAYER: { badge: "§b☻", color: "§b", label: "Player" },
};

// Lag weight per entity family — mobs with AI pathfinding cost more
const LAG_WEIGHT = {
  "minecraft:zombie": 1.5,
  "minecraft:zombie_villager": 2.0,  // heavier AI (trade + zombie merge)
  "minecraft:drowned": 1.5,
  "minecraft:husk": 1.5,
  "minecraft:skeleton": 1.8,         // ranged AI = heavier
  "minecraft:stray": 1.8,
  "minecraft:creeper": 1.5,
  "minecraft:spider": 1.3,
  "minecraft:cave_spider": 1.3,
  "minecraft:enderman": 2.0,         // teleport + block pickup
  "minecraft:witch": 2.0,            // potion AI
  "minecraft:slime": 1.0,
  "minecraft:magma_cube": 1.0,
  "minecraft:blaze": 2.0,            // ranged + fire
  "minecraft:ghast": 2.5,            // large hitbox + projectile
  "minecraft:wither_skeleton": 1.8,
  "minecraft:piglin": 1.5,
  "minecraft:piglin_brute": 1.5,
  "minecraft:hoglin": 1.5,
  "minecraft:pillager": 2.0,         // ranged AI
  "minecraft:vindicator": 1.8,
  "minecraft:evoker": 2.5,           // spell AI
  "minecraft:ravager": 2.0,
  "minecraft:phantom": 2.0,          // flight AI
  "minecraft:warden": 3.0,           // heaviest mob AI
  "minecraft:villager_v2": 3.0,      // trade + pathfinding + schedule
  "minecraft:iron_golem": 1.5,
  "minecraft:item": 0.3,
  "minecraft:xp_orb": 0.2,
  "minecraft:arrow": 0.1,
};

function buildLagContributors() {
  const contrib = [];  // { score, cat, name, count, pct, detail, dim }
  const ec = getEntityCounts();
  const totalEntity = Math.max(1, ec.total);

  // ── Source 1: Entity Types ──
  // On-demand scan — only runs when menu is opened
  const typeMap = new Map();
  const typeDim = {};  // typeId -> { OW, N, E }
  const chunkMap = new Map();  // "d:cx,cz" -> count

  try {
    const dims = [
      { id: "minecraft:overworld", key: "OW", short: "o" },
      { id: "minecraft:nether",    key: "N",  short: "n" },
      { id: "minecraft:the_end",   key: "E",  short: "e" },
    ];

    for (const d of dims) {
      try {
        const dim = world.getDimension(d.id);
        for (const e of dim.getEntities()) {
          try {
            const tid = e.typeId;
            if (!tid || tid === "minecraft:player") continue;

            // Type count
            typeMap.set(tid, (typeMap.get(tid) || 0) + 1);
            if (!typeDim[tid]) typeDim[tid] = { OW: 0, N: 0, E: 0 };
            typeDim[tid][d.key]++;

            // Chunk density
            try {
              const loc = e.location;
              const cx = Math.floor(loc.x) >> 4;
              const cz = Math.floor(loc.z) >> 4;
              const ck = d.short + ":" + cx + "," + cz;
              chunkMap.set(ck, (chunkMap.get(ck) || 0) + 1);
            } catch {}
          } catch {}
        }
      } catch {}
    }

    // Build entity type contributors
    for (const [tid, count] of typeMap) {
      if (count < 3) continue;  // ignore trivial counts
      const weight = LAG_WEIGHT[tid] ?? 1.0;
      const lagScore = Math.round(count * weight);
      const pct = Math.round(count / totalEntity * 100);
      const name = shortTypeName(tid);
      const dd = typeDim[tid] || { OW: 0, N: 0, E: 0 };
      const isItem = tid === "minecraft:item" || tid === "minecraft:xp_orb";
      const cat = isItem ? CONTRIB_CAT.ITEM : CONTRIB_CAT.MOB;
      let dimStr = "";
      if (dd.N > 0 || dd.E > 0) dimStr = ` §8[${dd.OW}/${dd.N}/${dd.E}]`;

      contrib.push({
        score: lagScore,
        cat,
        name,
        count,
        pct,
        detail: `§f${count} §8entity §7(${pct}%%) §8×${weight}`,
        dim: dimStr,
        actionType: isItem ? "clean_items" : "clean_hostile",
      });
    }

    // ── Source 2: Chunk Hotspots ──
    const sortedChunks = [...chunkMap.entries()]
      .filter(([, c]) => c >= 8)  // only significant density
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [ck, count] of sortedChunks) {
      const parts = ck.split(":");
      const [cx, cz] = parts[1].split(",").map(Number);
      const dimChar = parts[0];
      const dimLabel = dimChar === "n" ? "§cNether" : dimChar === "e" ? "§dEnd" : "§aOW";
      const worldX = cx * 16 + 8;
      const worldZ = cz * 16 + 8;
      const densityScore = Math.round(count * 1.5);  // chunk density weight

      contrib.push({
        score: densityScore,
        cat: CONTRIB_CAT.CHUNK,
        name: `${worldX}, ${worldZ}`,
        count,
        pct: Math.round(count / totalEntity * 100),
        detail: `§f${count} §8entity di chunk §7[${cx}, ${cz}]`,
        dim: ` ${dimLabel}`,
        actionType: null,
      });
    }

    // ── Source 3: Player Proximity ──
    // Uses already-collected chunkMap from Source 1 — ZERO extra getEntities calls
    const players = world.getPlayers();
    for (const p of players) {
      try {
        const loc = p.location;
        const dimId = p.dimension?.id || "minecraft:overworld";
        const dimShortKey = dimId === "minecraft:nether" ? "n" : dimId === "minecraft:the_end" ? "e" : "o";
        const dimShort = dimId === "minecraft:nether" ? "§cN" : dimId === "minecraft:the_end" ? "§dE" : "§aOW";

        // Find all entities within ~32 blocks using chunkMap (2-chunk radius)
        const pcx = Math.floor(loc.x) >> 4;
        const pcz = Math.floor(loc.z) >> 4;
        let nearTotal = 0;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const ck = dimShortKey + ":" + (pcx + dx) + "," + (pcz + dz);
            nearTotal += chunkMap.get(ck) || 0;
          }
        }

        if (nearTotal < 5) continue;  // ignore players in empty areas

        const playerScore = Math.round(nearTotal * 1.2);

        contrib.push({
          score: playerScore,
          cat: CONTRIB_CAT.PLAYER,
          name: p.name,
          count: nearTotal,
          pct: Math.round(nearTotal / totalEntity * 100),
          detail: `§f${nearTotal} §8entity nearby §7(2 chunk radius)`,
          dim: ` ${dimShort}`,
          actionType: "clean_player:" + p.name,
        });
      } catch {}
    }
  } catch {}

  // Sort by lag score (highest first)
  contrib.sort((a, b) => b.score - a.score);
  return contrib;
}

async function showLagContributors(player) {
  const tps = getTPS();
  const col = getTPSColor(tps);
  const ec = getEntityCounts();
  const contrib = buildLagContributors();

  // ── Health Index (0-100, higher = worse) ──
  let healthIdx = 0;
  healthIdx += Math.max(0, 20 - tps) * 5;           // TPS drop penalty
  healthIdx += Math.min(30, ec.hostile / 5);          // hostile count
  healthIdx += Math.min(20, ec.items / 10);           // item count
  healthIdx += Math.min(10, Math.max(0, ec.total - 200) / 30); // total entity
  healthIdx = Math.min(100, Math.round(healthIdx));

  const hCol = healthIdx >= 70 ? "§c" : healthIdx >= 40 ? "§e" : "§a";
  const hLabel = healthIdx >= 70 ? "KRITIS" : healthIdx >= 40 ? "WASPADA" : "SEHAT";
  const hBarLen = 10;
  const hFilled = Math.round(healthIdx / 100 * hBarLen);
  const hBar = hCol + "█".repeat(hFilled) + "§8" + "░".repeat(hBarLen - hFilled);

  let body = `${LINE}\n`;
  body += `§c  ★ L A G   C O N T R I B U T O R S\n`;
  body += `${LINE}\n\n`;

  // Health summary
  body += `  §6◆ §eServer Health Index\n`;
  body += `  §8├ ${hCol}${healthIdx}/100 §f${hLabel} §8[${hBar}§8]\n`;
  body += `  §8├ ${col}TPS: ${tps} §8| §fEntity: §e${fmt(ec.total)}\n`;
  body += `  §8└ §cH:${fmt(ec.hostile)} §aP:${fmt(ec.passive)} §eI:${fmt(ec.items)}\n\n`;

  if (!contrib.length) {
    body += `  §a✔ §fTidak ada kontributor lag signifikan\n`;
    body += `  §8└ §fServer berjalan optimal\n`;
  } else {
    body += `  §c⚠ §eRanking Kontributor §8(${Math.min(contrib.length, 12)} teratas)\n`;
    body += `${LINE_THIN}\n`;

    const topN = contrib.slice(0, 12);
    const maxScore = topN[0]?.score || 1;

    for (let i = 0; i < topN.length; i++) {
      const c = topN[i];
      // Visual severity bar (relative to highest)
      const relPct = Math.round(c.score / maxScore * 100);
      const barLen = Math.max(1, Math.round(relPct / 16.67));
      const barCol = relPct >= 70 ? "§c" : relPct >= 40 ? "§e" : "§a";
      const bar = barCol + "■".repeat(barLen);

      // Rank number with category badge
      const rank = String(i + 1).padStart(2, " ");

      body += `\n  §8${rank}. ${c.cat.badge} ${c.cat.color}${c.name}${c.dim}\n`;
      body += `  §8     ${c.detail}\n`;
      body += `  §8     §fLag: §e${c.score} ${bar}\n`;
    }

    // ── Category summary ──
    const mobContrib = contrib.filter(c => c.cat === CONTRIB_CAT.MOB);
    const itemContrib = contrib.filter(c => c.cat === CONTRIB_CAT.ITEM);
    const chunkContrib = contrib.filter(c => c.cat === CONTRIB_CAT.CHUNK);
    const playerContrib = contrib.filter(c => c.cat === CONTRIB_CAT.PLAYER);

    body += `\n${LINE_THIN}\n`;
    body += `  §6◆ §eRingkasan Kategori\n`;
    body += `  §8├ ${CONTRIB_CAT.MOB.badge} §fMob Types    §8── §e${mobContrib.length} §8tipe`;
    if (mobContrib.length > 0) body += ` §8(tertinggi: §c${mobContrib[0].name} §f${mobContrib[0].count}§8)`;
    body += `\n`;
    body += `  §8├ ${CONTRIB_CAT.ITEM.badge} §fItem/Orb    §8── §e${itemContrib.reduce((s, c) => s + c.count, 0)} §8total\n`;
    body += `  §8├ ${CONTRIB_CAT.CHUNK.badge} §fHotspot     §8── §e${chunkContrib.length} §8chunk padat\n`;
    body += `  §8└ ${CONTRIB_CAT.PLAYER.badge} §fPlayer Area §8── §e${playerContrib.length} §8player aktif\n`;
  }

  body += `\n${LINE}`;

  // Build action buttons
  const form = new ActionFormData()
    .title("§8 ◆ §cLAG RANK§r §8◆ §r")
    .body(body);
  const btns = [];

  // Quick action: clean based on top contributor
  if (ec.hostile > 30) {
    form.button(`§c  Clean Hostile Mob\n§r  §e${fmt(ec.hostile)} hostile → hapus jauh`, "textures/items/diamond_sword");
    btns.push("clean_hostile");
  }
  if (ec.items > 50) {
    form.button(`§e  Clean Items/Orb\n§r  §e${fmt(ec.items)} items → hapus`, "textures/items/iron_shovel");
    btns.push("clean_items");
  }

  // Player-specific clean buttons for top lag players
  const topPlayers = contrib
    .filter(c => c.cat === CONTRIB_CAT.PLAYER && c.score >= 20)
    .slice(0, 3);
  for (const tp of topPlayers) {
    form.button(`§b  Clean Area: ${tp.name}\n§r  §8${tp.count} entity nearby`, "textures/items/ender_pearl");
    btns.push("clean_player:" + tp.name);
  }

  form.button("§6  Refresh", "textures/items/arrow");
  btns.push("refresh");
  form.button("§6  Kembali", "textures/items/arrow");
  btns.push("back");

  const res = await form.show(player);
  if (res.canceled || btns[res.selection] === "back") return;

  const action = btns[res.selection];

  if (action === "refresh") {
    await showLagContributors(player);
    return;
  }

  if (action === "clean_hostile") {
    const removed = manualCleanHostile();
    try { player.playSound("random.levelup", { pitch: 1.0, volume: 1.0 }); } catch {}
    player.sendMessage(`§8[§aMonitor§8] §f${removed} §ehostile mob dihapus.`);
    await showLagContributors(player);
    return;
  }

  if (action === "clean_items") {
    const removed = manualCleanItems();
    try { player.playSound("random.levelup", { pitch: 1.5, volume: 1.0 }); } catch {}
    player.sendMessage(`§8[§aMonitor§8] §f${removed} §eitem/orb dihapus.`);
    await showLagContributors(player);
    return;
  }

  if (action.startsWith("clean_player:")) {
    const targetName = action.slice(13);
    const target = world.getPlayers().find(p => p.name === targetName);
    if (!target) {
      player.sendMessage(`§8[§cMonitor§8]§c ${targetName} sudah offline.`);
      return;
    }
    const removed = smartCleanArea(target);
    try { player.playSound("random.levelup", { pitch: 1.0, volume: 1.0 }); } catch {}
    player.sendMessage(`§8[§aMonitor§8] §f${removed} §ehostile dihapus di area §f${targetName}§e.`);
    await showLagContributors(player);
    return;
  }
}

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      { name: "lt:monitor", description: "Buka Server Monitor", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) { system.run(() => player.sendMessage("§8[§cMonitor§8]§c Akses ditolak.")); return; }
        system.run(() => openMonitor(player).catch(() => {}));
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[Monitor] Cmd reg failed:", e); }
});
