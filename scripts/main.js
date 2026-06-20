// ============================================================
// EconomyAddon — scripts/main.js
// ============================================================

import { world, system } from "@minecraft/server";
import { trackPlayer, startMonitoring } from "./dp_manager.js";
import { migratePlayer } from "./player_dp.js";

import "./MobuXP/main.js";
import "./gacha/main.js";
import "./Bank/main.js";
import "./auction/main.js";
import "./daily/main.js";
import "./Combat/main.js";
import "./leaderboard/main.js";
import "./leaderboard/sync_chat.js"; // [Live Chat] Game ↔ Website chat bridge
import "./Tax/wealth.js";    // [REC-5] Wealth Tax — pajak kekayaan harian
import "./welfare/ubi.js";   // [PhD-v2] UBI — Universal Basic Income player baru
import "./welfare/demurrage.js"; // [PhD-v2] Demurrage — carrying cost hoarded coin
import "./welfare/stagflation.js"; // Stagflation Detector — auto-stimulus
import "./store/main.js";    // Store — toko bahan build dengan tier progresif
import "./insights/baseline.js"; // /lt:baseline — read-only snapshot ekonomi gem (admin)
import "./eid_quest.js";          // Eid Adha — quest qurban token system
import "./hologram/main.js";      // Hologram — advanced floating text system
import "./npc/market.js";          // NPC Market — Store, Auction, Gacha via NPC

import { handleWelcome } from "./welcome.js";

startMonitoring();

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try { trackPlayer(player.id); } catch { }
    // Auto-migrate world DP → player DP
    try { migratePlayer(player); } catch (e) { console.warn("[Main] Migration:", e); }
  }, 10);

  // Welcome guide — delay lebih lama agar muncul setelah daily login & notif lain
  system.runTimeout(() => {
    try {
      const live = world.getPlayers().find(p => p.id === player.id);
      if (live) handleWelcome(live);
    } catch { }
  }, 160);
});

// ═══════════════════════════════════════════════════════════
// AUTO-CLEAR LOG — Hapus riwayat > 7 hari agar DP tidak penuh
// Berjalan setiap ~6 jam (432000 ticks)
// ═══════════════════════════════════════════════════════════
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
const LOG_PRUNE_INTERVAL = 432_000;               // ~6 jam (20 tps × 3600 × 6)

const dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try { world.setDynamicProperty(k, JSON.stringify(v)); }
    catch (e) { console.warn("[LogPrune] dp.set:", k, e); }
  },
};

function pruneArray(arr, now) {
  return arr.filter(e => {
    const ts = e.ts ?? e.t ?? 0;
    if (typeof ts !== "number" || ts <= 0) return true; // keep entries tanpa timestamp
    return (now - ts) < LOG_MAX_AGE_MS;
  });
}

function pruneLogEntries() {
  const now = Date.now();
  let pruned = 0;

  // 1) Bank — Global history
  try {
    const bankGlobal = dp.get("bank:global_hist", []);
    if (bankGlobal.length > 0) {
      const cleaned = pruneArray(bankGlobal, now);
      if (cleaned.length !== bankGlobal.length) {
        dp.set("bank:global_hist", cleaned);
        pruned += bankGlobal.length - cleaned.length;
      }
    }
  } catch (e) { console.warn("[LogPrune] bank:global_hist:", e); }

  // 2) Combat — Kill log
  try {
    const killLog = dp.get("c:log", []);
    if (killLog.length > 0) {
      const cleaned = pruneArray(killLog, now);
      if (cleaned.length !== killLog.length) {
        dp.set("c:log", cleaned);
        pruned += killLog.length - cleaned.length;
      }
    }
  } catch (e) { console.warn("[LogPrune] c:log:", e); }

  // 3) Auction — History
  try {
    const aucHist = dp.get("auc:hist", []);
    if (aucHist.length > 0) {
      const cleaned = pruneArray(aucHist, now);
      if (cleaned.length !== aucHist.length) {
        dp.set("auc:hist", cleaned);
        pruned += aucHist.length - cleaned.length;
      }
    }
  } catch (e) { console.warn("[LogPrune] auc:hist:", e); }

  // 4) Gacha — Global history
  try {
    const gachaHist = dp.get("g_hist", []);
    if (gachaHist.length > 0) {
      const cleaned = pruneArray(gachaHist, now);
      if (cleaned.length !== gachaHist.length) {
        dp.set("g_hist", cleaned);
        pruned += gachaHist.length - cleaned.length;
      }
    }
  } catch (e) { console.warn("[LogPrune] g_hist:", e); }

  // 5) Bank — Personal history (per online player only)
  try {
    for (const player of world.getPlayers()) {
      try {
        const hist = dp.get("bank:hist:" + player.id, null);
        if (hist && hist.length > 0) {
          const cleaned = pruneArray(hist, now);
          if (cleaned.length !== hist.length) {
            dp.set("bank:hist:" + player.id, cleaned);
            pruned += hist.length - cleaned.length;
          }
        }
      } catch { }
    }
  } catch (e) { console.warn("[LogPrune] bank:hist:", e); }

  // 6) Gacha — Per-player history (online players only)
  try {
    for (const player of world.getPlayers()) {
      try {
        const hist = dp.get("hist:" + player.id, null);
        if (hist && hist.length > 0) {
          const cleaned = pruneArray(hist, now);
          if (cleaned.length !== hist.length) {
            dp.set("hist:" + player.id, cleaned);
            pruned += hist.length - cleaned.length;
          }
        }
      } catch { }
    }
  } catch (e) { console.warn("[LogPrune] hist:", e); }

  if (pruned > 0) console.log(`[LogPrune] Cleared ${pruned} entries older than 7 days.`);
}

// Delay awal 5 menit, lalu tiap ~6 jam
system.runTimeout(() => {
  pruneLogEntries();
  system.runInterval(pruneLogEntries, LOG_PRUNE_INTERVAL);
}, 6000);

// ═══════════════════════════════════════════════════════════
// STARTUP BANNER — Unified 3D Graffiti
// ═══════════════════════════════════════════════════════════
system.run(() => {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const p = world.getPlayers().length;

  // Build 3D art line by line to avoid backslash hell
  const B = "\\"; // single backslash
  const L = [];
  L.push("");
  L.push("  _                       _     _        _");
  L.push(" | |     __ _ _   _  __ _| |__ | |_ __ _| | ___");
  L.push(" | |    / _` | | | |/ _` | '_ " + B + "| __/ _` | |/ _ " + B);
  L.push(" | |___| (_| | |_| | (_| | | | | || (_| | |  __/");
  L.push(" |______" + B + "__,_|" + B + "__,_|" + B + "__, |_| |_|" + B + "__" + B + "__,_|_|" + B + "___|");
  L.push("                     |___/");
  L.push("          S . M . P  |  v4.3");
  L.push("");
  L.push("  +-----------------------------------+");
  L.push("  | PACK          | MOD |    STATUS   |");
  L.push("  |-----------------------------------+");
  L.push("  | LT-Economy    |  16 |     OK      |");
  L.push("  | LT-Dragon     |   7 |     OK      |");
  L.push("  | LT-Purge      |   4 |     OK      |");
  L.push("  | Mimi Inka     |   5 |     OK      |");
  L.push("  | Mimi Land     |   4 |     OK      |");
  L.push("  | LaughtaleG    |   3 |     OK      |");
  L.push("  | Treecap       |   1 |     OK      |");
  L.push("  |-----------------------------------+");
  L.push("  | 7 packs | 40 modules | ALL GO    |");
  L.push("  +-----------------------------------+");
  L.push("  Boot: " + ts + " | P:" + p);
  L.push("");

  console.warn(L.join("\n"));
});