// monitor/ui.js — Monitor UI v2.0
// Premium UI Design matching Daily System style
// No §7 on buttons — uses §e for descriptions

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { getTPS, getTPSMin, getTPSMax, getTPSColor, buildTPSBar, getUptime, resetTPSStats } from "./tps_tracker.js";
import { getEntityCounts } from "./entity_counter.js";
import {
  isThrottleEnabled, setThrottleEnabled, getThrottleLevel_,
  getTotalCleaned, resetTotalCleaned, manualCleanHostile, manualCleanItems,
} from "./auto_throttle.js";
import { getDPStats, formatBytes, cleanupInactive } from "../../dp_manager.js";

const ADMIN_TAG = "mimi";
const LINE      = "§8═══════════════════";
const LINE_THIN = "§8───────────────────";
const SP        = "";
const fmt = (n) => Math.floor(n).toLocaleString("id-ID");
const activeSessions = new Set();

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
    body += `§6  S E R V E R   H E A L T H\n`;
    body += `${LINE}\n\n`;

    // TPS Section
    body += `  §6◆ §eTPS\n`;
    body += `  §8├ ${col}${tps} §8[${bar}§8]\n`;
    body += `  §8├ ${tpsStatusIcon(tps)} ${tpsStatusLabel(tps)}\n`;
    body += `  §8└ §8Range: §f${tpsMin} §8~ §f${tpsMax}\n`;
    body += `\n`;

    // Entity Section
    body += `  §b✦ §eEntity\n`;
    body += `  §8├ §fTotal: §e${fmt(ec.total)}\n`;
    body += `  §8├ §8OW:§f${fmt(ec.perDim.OW)} §8| N:§f${fmt(ec.perDim.N)} §8| E:§f${fmt(ec.perDim.E)}\n`;
    body += `  §8└ §cHostile:§f${fmt(ec.hostile)} §8| §eItems:§f${fmt(ec.items)}\n`;
    body += `\n`;

    // Server Info
    body += `  §a⚙ §eServer\n`;
    body += `  §8├ §bPlayers: §f${pCount} §8online\n`;
    body += `  §8└ §bUptime: §f${uptime}\n`;
    body += `\n${LINE_THIN}\n`;

    // Throttle Status
    const throttleColor = throttle ? "§a" : "§c";
    const throttleLabel = throttle ? "ON" : "OFF";
    const levelBadge = level > 0 ? ` §c[Level ${level}]` : "";
    body += `  §e⛃ §eAuto-Throttle: ${throttleColor}${throttleLabel}${levelBadge}\n`;
    body += `  §8└ §eCleaned: §f${fmt(cleaned)} §8entity total\n`;

    body += `\n${LINE}`;

    const form = new ActionFormData()
      .title("§8 ♦ §6MONITOR§r §8♦ §r")
      .body(body);
    const btns = [];

    // Emergency Clean
    form.button(`§c  Emergency Clean\n§r  §eHapus hostile mob jauh`, "textures/items/diamond_sword");
    btns.push("clean_hostile");

    // Clean Items
    form.button(`§e  Clean Items\n§r  §eHapus item & orb di ground`, "textures/items/iron_shovel");
    btns.push("clean_items");

    // Toggle Throttle
    form.button(`${throttle ? "§c" : "§a"}  Auto-Throttle: ${throttleLabel}\n§r  §eToggle auto-response`, "textures/items/compass_item");
    btns.push("toggle_throttle");

    const hudActive = player.hasTag("monitor");
    form.button(`§b  Toggle HUD\n§r  §e${hudActive ? "HUD aktif" : "HUD mati"}`, "textures/items/spyglass");
    btns.push("toggle_hud");

    form.button(`§c  Top Lag Player\n§r  §ePlayer berpotensi lag`, "textures/items/redstone_dust");
    btns.push("lag_profile");

    form.button(`§d  DP Dashboard\n§r  §eDynamic Property usage`, "textures/items/paper");
    btns.push("dp_dash");

    form.button(`§f  Reset Stats\n§r  §eReset min/max TPS & counter`, "textures/items/clock_item");
    btns.push("reset");

    // Refresh
    form.button(`§6  Refresh\n§r  §eUpdate data terbaru`, "textures/items/arrow");
    btns.push("refresh");

    // Close
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

    if (action === "dp_dash") {
      await showDPDashboard(player);
      continue;
    }
  }
}

async function showLagProfile(player) {
  const profiles = profilePlayers();
  let body = `${LINE}\n§c  TOP LAG PLAYERS\n${LINE}\n\n`;
  if (!profiles.length) {
    body += "§8 Tidak ada data.\n";
  } else {
    const medals = ["§c1.", "§62.", "§e3."];
    profiles.forEach((p, i) => {
      const rank = i < 3 ? medals[i] : `§8${i + 1}.`;
      const bar = p.score >= 100 ? "§c" : p.score >= 50 ? "§6" : "§a";
      const rdLabel = p.rd > 0 ? ` §8RD:§f${p.rd}` : "";
      const rdWarn = p.rd > 16 ? " §c!" : "";
      body += `  ${rank} ${bar}§f${p.name}${rdWarn}\n`;
      body += `  §8   Score: §f${p.score}${rdLabel} §8| §7${p.details}\n`;
    });
  }
  body += `\n§e SKOR FORMULA\n${LINE_THIN}\n`;
  body += `§8  Entity nearby ×2 + Items ×3\n`;
  body += `§8  Effects (>3) ×2 + Dimension\n`;
  body += `§8  RenderDist (>16) ×3\n`;
  body += `\n§e RENDER DISTANCE\n${LINE_THIN}\n`;
  if (profiles.length > 0) {
    for (const p of profiles) {
      if (p.rd > 0) {
        const chunks = (p.rd * 2 + 1) ** 2;
        const rdColor = p.rd > 16 ? "§c" : p.rd > 10 ? "§e" : "§a";
        body += `  §f${p.name} §8── ${rdColor}${p.rd} chunks §8(${chunks} total)\n`;
      }
    }
    if (!profiles.some(p => p.rd > 0)) body += "  §8Data tidak tersedia.\n";
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
  body += `  §8├ §fPersen  §8── §f${pct}% §8dari 1MB\n`;
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

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      { name: "lt:monitor", description: "Buka Server Monitor", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) { system.run(() => player.sendMessage("§c[Monitor] Akses ditolak.")); return; }
        system.run(() => openMonitor(player).catch(() => {}));
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[Monitor] Cmd reg failed:", e); }
});
