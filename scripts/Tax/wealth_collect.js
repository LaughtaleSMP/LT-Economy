// ============================================================
// Tax/wealth_collect.js — Koleksi pajak kekayaan harian
//
// Berjalan SEKALI per hari (period gate via DP).
// Iterasi scoreboard O(N), batch ke treasury, kirim notif ke
// player online & buffer notif untuk yang offline.
//
// Demurrage piggyback: setelah wealth tax, jalankan demurrage batch
// agar koin masuk ke treasury yang sama → redistribusi konsisten.
// ============================================================

import { world, system } from "@minecraft/server";
import { trackFlow } from "../eco_flow.js";
import { runDemurrageBatch } from "../welfare/demurrage.js";
import {
  K_PERIOD, fmt, getCurrentPeriod, getCoinObj,
  getTaxTier, getTreasury, setTreasury,
  pushOfflineNotif, refreshTreasuryCache, dpGet, dpSet,
  ADMIN_TAG, TAX_TIERS,
} from "./wealth_state.js";
import { autoDistributeTreasury } from "./wealth_distribute.js";

export function collectWealthTax() {
  const period     = getCurrentPeriod();
  const lastPeriod = dpGet(K_PERIOD, -1);
  if (lastPeriod === period) return; // sudah dikumpulkan hari ini

  const obj = getCoinObj();
  if (!obj) {
    console.warn("[WealthTax] Scoreboard 'coin' tidak ditemukan, skip.");
    return;
  }

  // JANGAN mark period dulu — mark SETELAH treasury berhasil ditulis.

  const onlineMap = _buildOnlineMap();
  const stats = _collectFromScoreboard(obj, onlineMap);

  _logCollectionStats(stats);

  // Mark periode SEKARANG — setelah semua skor sudah dipotong
  dpSet(K_PERIOD, period);

  // Track wealth tax flow SEBELUM demurrage — supaya flow key terpisah
  if (stats.totalCollected > 0) trackFlow("wealth_tax", -stats.totalCollected);

  // Demurrage piggyback — runs once/day
  // runDemurrageBatch sudah panggil trackFlow("demurrage",...) internal
  let demResult = { totalCollected: 0, affectedCount: 0 };
  try { demResult = runDemurrageBatch(); }
  catch (e) { console.warn("[WealthTax] demurrage:", e); }

  const combinedTreasury = stats.treasuryBatch + demResult.totalCollected;
  if (combinedTreasury > 0) _writeTreasuryWithVerify(combinedTreasury);

  _broadcastCollectionResult(stats, demResult);

  // Refresh cache jika treasury berubah
  if (stats.taxedCount > 0 || demResult.affectedCount > 0) {
    refreshTreasuryCache();
  }

  // Auto-distribute treasury setelah koleksi (delay 2s untuk cache refresh)
  if (combinedTreasury > 0) {
    system.runTimeout(() => {
      try { autoDistributeTreasury(); }
      catch (e) { console.warn("[WealthTax] auto-dist post-collect:", e); }
    }, 40);
  }
}

// ── Private helpers ──────────────────────────────────────────

function _buildOnlineMap() {
  const map = new Map();
  for (const p of world.getPlayers()) map.set(p.name, p);
  return map;
}

function _collectFromScoreboard(obj, onlineMap) {
  const stats = {
    treasuryBatch: 0, totalCollected: 0, taxedCount: 0,
    scannedCount: 0, skippedBadName: 0, skippedZero: 0, skippedTier: 0,
    // Diagnostic: distribusi saldo (§6.1 — median+percentile untuk heavy-tailed)
    totalSupply: 0, balances: [],
  };

  for (const ident of obj.getParticipants()) {
    try {
      stats.scannedCount++;
      const name = ident.displayName;

      if (name && (name.startsWith("command.") || name.includes(".scoreboard."))) {
        stats.skippedBadName++;
        continue;
      }

      const balance = obj.getScore(ident) ?? 0;
      if (!Number.isFinite(balance) || balance <= 0) {
        stats.skippedZero++;
        continue;
      }

      // Track semua saldo positif untuk distribusi statistik
      stats.totalSupply += balance;
      stats.balances.push(balance);

      const tier = getTaxTier(balance);
      if (!tier) { stats.skippedTier++; continue; }

      const tax = Math.max(1, Math.floor(balance * tier.rate));
      const newBalance = Math.max(0, balance - tax);
      const actualTax  = balance - newBalance;

      obj.setScore(ident, newBalance);
      stats.treasuryBatch  += actualTax;
      stats.totalCollected += actualTax;
      stats.taxedCount++;

      _notifyTaxed(name, balance, newBalance, actualTax, tier, onlineMap);
    } catch (e) {
      console.warn("[WealthTax] Error participant:", e);
    }
  }

  return stats;
}

function _notifyTaxed(name, balance, newBalance, actualTax, tier, onlineMap) {
  if (!name) return; // identity tanpa nama → skip notif

  const msg =
    `§8[§ePajak Kekayaan§8]§e §fSaldo §e${fmt(balance)} §fkoin ` +
    `(tier §c${tier.label}§f) -> §c-${fmt(actualTax)} Koin §7dipotong otomatis.\n` +
    `§8Sisa saldo: §e${fmt(newBalance)} Koin`;

  const online = onlineMap.get(name);
  if (online) {
    online.sendMessage(msg);
    try { online.playSound("note.bass", { pitch: 0.7, volume: 0.8 }); } catch {}
  } else {
    pushOfflineNotif(name, msg);
  }
}

function _writeTreasuryWithVerify(amount) {
  const curTreasury = getTreasury();
  const newTreasury = curTreasury + amount;
  setTreasury(newTreasury);

  // Verifikasi tulis berhasil — retry sekali jika mismatch
  const verify = getTreasury();
  if (verify !== newTreasury) {
    console.warn(`[WealthTax] DP write mismatch! Expected ${newTreasury}, got ${verify}. Retry...`);
    setTreasury(newTreasury);
  }
}

function _logCollectionStats(stats) {
  // Basic scan summary
  console.log(
    `[WealthTax] Scan: total=${stats.scannedCount}, taxed=${stats.taxedCount}, ` +
    `skip(name)=${stats.skippedBadName}, skip(zero)=${stats.skippedZero}, ` +
    `skip(tier)=${stats.skippedTier}, collected=${fmt(stats.totalCollected)}`
  );

  // §6.1 — Distribusi saldo: median + p25/p75 untuk heavy-tailed distribution
  const b = stats.balances;
  if (b.length > 0) {
    b.sort((a, c) => a - c);
    const p25    = b[Math.floor(b.length * 0.25)] ?? 0;
    const median = b[Math.floor(b.length * 0.50)] ?? 0;
    const p75    = b[Math.floor(b.length * 0.75)] ?? 0;
    const taxRate = stats.totalSupply > 0
      ? ((stats.totalCollected / stats.totalSupply) * 100).toFixed(2) : "0.00";
    console.log(
      `[WealthTax] Distribution: n=${b.length}, supply=${fmt(stats.totalSupply)}, ` +
      `p25=${fmt(p25)}, median=${fmt(median)}, p75=${fmt(p75)}, ` +
      `effectiveRate=${taxRate}%, belowThreshold=${stats.skippedTier}`
    );
  }

  // §7.3 SRE — Low-yield alert saat tax base terlalu kecil
  if (b.length > 0 && stats.taxedCount === 0) {
    console.warn(
      `[WealthTax] [WARN] ZERO tax collected! All ${b.length} players below threshold. ` +
      `Consider lowering TAX_TIERS min values.`
    );
  } else if (b.length > 5 && stats.taxedCount < b.length * 0.10) {
    console.warn(
      `[WealthTax] [WARN] Low yield: only ${stats.taxedCount}/${b.length} ` +
      `(${((stats.taxedCount / b.length) * 100).toFixed(0)}%) players taxed. ` +
      `Review threshold config.`
    );
  }

  // Cleanup — jangan simpan array (§1.3 anti-leak)
  stats.balances = [];
}

function _broadcastCollectionResult(stats, demResult) {
  if (stats.taxedCount > 0) {
    const treasury = getTreasury();
    console.log(
      `[WealthTax] Koleksi selesai: ${fmt(stats.totalCollected)} koin dari ` +
      `${stats.taxedCount} player. Treasury: ${fmt(treasury)}`
    );
    const demLine = demResult.affectedCount > 0
      ? ` §7+ Demurrage §d${demResult.affectedCount} hoarder §c-${fmt(demResult.totalCollected)}§7.`
      : "";
    world.sendMessage(
      `§8[§ePajak Kekayaan§8]§e §fDipotong dari §e${stats.taxedCount} §fplayer kaya. ` +
      `Treasury: §6${fmt(treasury)} Koin.` + demLine
    );
  } else if (demResult.affectedCount > 0) {
    const treasury = getTreasury();
    console.log(`[WealthTax] Demurrage only: ${fmt(demResult.totalCollected)} koin. Treasury: ${fmt(treasury)}`);
    world.sendMessage(
      `§8[§dDemurrage§8]§d §fDipotong dari §d${demResult.affectedCount} §fhoarder pasif. ` +
      `Treasury: §6${fmt(treasury)} Koin.`
    );
  }
}

// ── Command: /lt:taxpreview — Dry-run preview pajak (admin only) ──
// Read-only scan scoreboard, hitung estimasi tax tanpa potong saldo.
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  try {
    customCommandRegistry.registerCommand(
      {
        name:            "lt:taxpreview",
        description:     "Preview estimasi wealth tax (tidak memotong saldo)",
        permissionLevel: 0,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) {
          system.run(() => player.sendMessage("§8[§cTax§8]§c Akses ditolak."));
          return;
        }
        system.run(() => _runTaxPreview(msg => player.sendMessage(msg)));
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[WealthTax] taxpreview cmd reg:", e); }
});

// ── ScriptEvent: scriptevent lt:taxpreview — trigger dari BDS console ──
// Filter: hanya dari server console (Entity source = in-game player, bisa abuse)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "lt:taxpreview") return;

  // Jika dari player in-game, cek admin tag
  if (ev.sourceEntity) {
    const ent = ev.sourceEntity;
    if (!ent.hasTag(ADMIN_TAG)) return;
    system.run(() => _runTaxPreview(msg => {
      if (ent.isValid()) ent.sendMessage(msg);
    }));
    return;
  }

  // Dari console -> strip § color codes
  const strip = s => s.replace(/§./g, "");
  _runTaxPreview(msg => console.log(strip(msg)));
});

function _runTaxPreview(send) {
  const obj = getCoinObj();
  if (!obj) {
    send("[TaxPreview] Scoreboard 'coin' tidak ditemukan.");
    return;
  }

  // Per-tier counters
  const tierStats = TAX_TIERS.map(t => ({
    label: t.label, min: t.min, count: 0, totalTax: 0,
  }));
  let belowThreshold = 0, belowThresholdBal = 0;
  let totalPlayers = 0, totalSupply = 0, totalTax = 0;
  const balances = [];

  for (const ident of obj.getParticipants()) {
    try {
      const name = ident.displayName;
      if (name && (name.startsWith("command.") || name.includes(".scoreboard."))) continue;

      const balance = obj.getScore(ident) ?? 0;
      if (!Number.isFinite(balance) || balance <= 0) continue;

      totalPlayers++;
      totalSupply += balance;
      balances.push(balance);

      const tier = getTaxTier(balance);
      if (!tier) {
        belowThreshold++;
        belowThresholdBal += balance;
        continue;
      }

      const tax = Math.max(1, Math.floor(balance * tier.rate));
      totalTax += tax;

      // Match tier ke tierStats
      const idx = TAX_TIERS.indexOf(tier);
      if (idx >= 0) {
        tierStats[idx].count++;
        tierStats[idx].totalTax += tax;
      }
    } catch (e) { console.warn("[TaxPreview] participant:", e); }
  }

  // Distribusi saldo
  balances.sort((a, c) => a - c);
  const p25    = balances[Math.floor(balances.length * 0.25)] ?? 0;
  const median = balances[Math.floor(balances.length * 0.50)] ?? 0;
  const p75    = balances[Math.floor(balances.length * 0.75)] ?? 0;
  const effRate = totalSupply > 0
    ? ((totalTax / totalSupply) * 100).toFixed(2) : "0.00";

  // Build message
  const lines = [
    `§8=== §eTax Preview §8(dry-run, tidak memotong) ===`,
    ``,
    `§fTotal player: §e${totalPlayers} §8| §fTotal supply: §6${fmt(totalSupply)} Koin`,
    `§fDistribusi: §7p25=§e${fmt(p25)}§7, median=§e${fmt(median)}§7, p75=§e${fmt(p75)}`,
    ``,
  ];

  for (const ts of tierStats) {
    lines.push(
      `§fTier §c${ts.label} §7(>=${fmt(ts.min)}): §e${ts.count} §fplayer §8-> §c-${fmt(ts.totalTax)} Koin`
    );
  }

  lines.push(
    `§fDi bawah threshold: §7${belowThreshold} §fplayer §8(§7${fmt(belowThresholdBal)} Koin§8)`,
    ``,
    `§fEstimasi total tax: §c-${fmt(totalTax)} Koin §7(effective ${effRate}%%)`,
    `§fTreasury saat ini: §6${fmt(getTreasury())} Koin`,
    `§fTreasury setelah: §a~${fmt(getTreasury() + totalTax)} Koin`,
  );

  send(lines.join("\n"));
}

