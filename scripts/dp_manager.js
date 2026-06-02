// dp_manager.js — Central Dynamic Property monitoring & cleanup
// Mencegah DP membengkak akibat akumulasi data player inaktif.
// [PERF] Dioptimasi untuk minim dampak TPS.

import { world, system } from "@minecraft/server";

// ═══════════════════════════════════════════════════════════
// KONFIGURASI
// ═══════════════════════════════════════════════════════════
const DP_CFG = {
  // Semua prefix key per-player dari seluruh module
  PLAYER_KEY_PREFIXES: [
    // Auction
    "auc:notif:", "auc:pend:", "auc:pend_coin:", "auc:tx:",
    // Bank
    "bank:hist:", "bank:req_in:", "bank:daily:", "bank:notif_pend:",
    // Gacha (utils)
    "pg_s:", "eq_s:", "eq_py:", "eq_p:", "hist:", "ud:", "imp_p:",
    // Gacha (main.js)
    "gacha:pend_gem:", "gacha:pend_coin:", "gacha:sess_ref:",
    // MobuXP
    "xp:daily_coin:",
    // Daily (Login + Quest + Achievement)
    "daily:login:", "daily:quest:", "daily:weekly:", "daily:monthly:", "daily:stats:",
    // Welcome
    "welcome:seen:",
    // Combat
    "cs:", "ch:", "cho:", "cd:", "cdm:",
  ],
  K_LAST_SEEN:        "_ls:",
  CLEANUP_DAYS:       14,
  WARN_BYTES:         450_000,
  CRITICAL_BYTES:     700_000,
  MONITOR_INTERVAL:   6000,   // ~5 min (was 3000/2.5min — less frequent check)
  CLEANUP_BATCH:      2,      // [PERF] reduced from 5 — fewer deletes per tick
};

// ═══════════════════════════════════════════════════════════
// BYTE LENGTH — hitung bytes UTF-8 sesungguhnya
// ═══════════════════════════════════════════════════════════
export function getByteLength(str) {
  if (typeof str !== "string") return 0;
  // [PERF] Fast path: pure ASCII (mayoritas JSON data)
  // JSON keys, angka, boolean, null semuanya ASCII.
  // Cek dulu apakah ada non-ASCII sebelum loop berat.
  let isAscii = true;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7F) { isAscii = false; break; }
  }
  if (isAscii) return str.length;

  // Slow path: hitung per-char untuk string dengan Unicode
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c <= 0x7F) bytes += 1;
    else if (c <= 0x7FF) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

// ═══════════════════════════════════════════════════════════
// TRACKING — catat kapan player terakhir login
// ═══════════════════════════════════════════════════════════
export function trackPlayer(playerId) {
  try { world.setDynamicProperty(DP_CFG.K_LAST_SEEN + playerId, Date.now()); }
  catch {}
}

// ═══════════════════════════════════════════════════════════
// STATS — informasi penggunaan DP (hanya untuk admin UI)
// ═══════════════════════════════════════════════════════════
export function getDPStats() {
  try {
    const totalBytes = world.getDynamicPropertyTotalByteCount();
    const allIds     = world.getDynamicPropertyIds();

    let playerKeyCount = 0;
    const uniquePlayers = new Set();

    for (const id of allIds) {
      if (id.startsWith(DP_CFG.K_LAST_SEEN)) {
        uniquePlayers.add(id.slice(DP_CFG.K_LAST_SEEN.length));
        continue;
      }
      for (const prefix of DP_CFG.PLAYER_KEY_PREFIXES) {
        if (id.startsWith(prefix)) {
          playerKeyCount++;
          uniquePlayers.add(id.slice(prefix.length));
          break;
        }
      }
    }

    return {
      totalBytes,
      keyCount:       allIds.length,
      playerKeyCount,
      globalKeyCount: allIds.length - playerKeyCount - uniquePlayers.size,
      trackedPlayers: uniquePlayers.size,
    };
  } catch (e) {
    console.error("[DP Monitor] getDPStats error:", e);
    return { totalBytes: 0, keyCount: 0, playerKeyCount: 0, globalKeyCount: 0, trackedPlayers: 0 };
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ═══════════════════════════════════════════════════════════
// CLEANUP — hapus data player inaktif
// [PERF] getDynamicPropertyIds() dipanggil SEKALI, di-reuse.
// [PERF] Batch processing: maks 2 player per batch, 10 tick gap.
// ═══════════════════════════════════════════════════════════

// [PERF] Global DP byte-delta tracker — early warning system
// Measures actual bytes written by comparing getTotalByteCount snapshots.
// Zero integration needed — no need to call from every dpSet.
let _lastByteSnap = -1;
let _byteSnapTime = Date.now();
const DP_BYTE_RATE_WARN = 500_000; // warn if >500KB DP change per minute

/**
 * Hapus semua DP keys milik satu player.
 * @param {string} playerId
 * @param {string[]} allIds — pre-fetched key list (hindari panggil ulang)
 */
export function cleanupPlayer(playerId, allIds) {
  let deleted = 0;
  // [PERF] Pre-build target keys sekali, lalu cek dengan Set untuk O(1) lookup
  const targets = new Set();
  targets.add(DP_CFG.K_LAST_SEEN + playerId);
  for (const prefix of DP_CFG.PLAYER_KEY_PREFIXES) {
    targets.add(prefix + playerId);
  }

  for (const id of allIds) {
    if (targets.has(id)) {
      try { world.setDynamicProperty(id, undefined); deleted++; } catch {}
    }
  }
  return deleted;
}

/**
 * Hapus data player inaktif > thresholdDays hari.
 * [PERF] Spread cleanup ke beberapa tick supaya tidak drop TPS.
 * [PERF v2] Batch 2 player/batch, 10 tick gap antar batch.
 * @param {number} [thresholdDays]
 * @param {boolean} [immediate] — true = langsung semua (untuk admin manual)
 */
let _cleanupRunning = false;

export function cleanupInactive(thresholdDays = DP_CFG.CLEANUP_DAYS, immediate = false) {
  if (_cleanupRunning) return { players: 0, keys: 0 };
  _cleanupRunning = true;

  const now         = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const allIds      = world.getDynamicPropertyIds(); // [PERF] Sekali saja
  const onlineIds   = new Set(world.getPlayers().map(p => p.id));

  // Kumpulkan player yang perlu di-cleanup
  const toCleanup = [];
  for (const id of allIds) {
    if (!id.startsWith(DP_CFG.K_LAST_SEEN)) continue;
    const playerId = id.slice(DP_CFG.K_LAST_SEEN.length);
    if (onlineIds.has(playerId)) continue;
    const lastSeen = world.getDynamicProperty(id);
    if (typeof lastSeen !== "number") continue;
    if ((now - lastSeen) < thresholdMs) continue;
    toCleanup.push(playerId);
  }

  if (toCleanup.length === 0) { _cleanupRunning = false; return { players: 0, keys: 0 }; }

  // [PERF] Immediate mode: proses semua sekarang (untuk admin manual click)
  if (immediate || toCleanup.length <= DP_CFG.CLEANUP_BATCH) {
    let totalKeys = 0;
    for (const pid of toCleanup) totalKeys += cleanupPlayer(pid, allIds);
    console.log(`[DP Cleanup] Dibersihkan ${totalKeys} keys dari ${toCleanup.length} player inaktif (>${thresholdDays} hari).`);
    _cleanupRunning = false;
    return { players: toCleanup.length, keys: totalKeys };
  }

  // [PERF v2] Batch mode: 2 player per batch, 10 tick gap antar batch
  // Ini mencegah spike DP writes yang bisa trigger BDS 10MB threshold.
  let idx = 0;
  let totalKeys = 0;
  function processBatch() {
    try {
      // [PERF] Reuse allIds dari scope cleanupInactive — tidak fetch ulang tiap batch.
      // allIds di-snapshot sekali di awal, cukup akurat karena cleanup berjalan bertahap.
      const end = Math.min(idx + DP_CFG.CLEANUP_BATCH, toCleanup.length);
      for (; idx < end; idx++) {
        totalKeys += cleanupPlayer(toCleanup[idx], allIds);
      }
    } catch (e) {
      console.warn("[DP Cleanup] Batch error:", e);
    }
    if (idx < toCleanup.length) {
      system.runTimeout(processBatch, 10); // 10 tick gap — spread writes
    } else {
      console.log(`[DP Cleanup] Dibersihkan ${totalKeys} keys dari ${toCleanup.length} player inaktif (>${thresholdDays} hari).`);
      _cleanupRunning = false;
    }
  }
  system.run(processBatch);
  return { players: toCleanup.length, keys: -1 }; // -1 = async, belum selesai
}

// ═══════════════════════════════════════════════════════════
// MONITORING — auto-check & auto-cleanup
// [PERF] Monitor hanya panggil getDynamicPropertyTotalByteCount()
// yang ringan (1 API call, tidak iterate keys).
// getDPStats() hanya dipanggil saat startup (sekali) dan admin UI.
// ═══════════════════════════════════════════════════════════
export function startMonitoring() {
  system.runTimeout(() => {
    try {
      const totalBytes = world.getDynamicPropertyTotalByteCount();
      console.log(`[DP Monitor] Startup: ${formatBytes(totalBytes)}`);
      if (totalBytes > DP_CFG.WARN_BYTES) {
        console.warn(`[DP Monitor] High usage at startup — running cleanup (14d)...`);
        cleanupInactive(14);
      }
      // One-time purge: remove deprecated pt_d: keys (replaced by p_reg.ptm)
      let purged = 0;
      for (const id of world.getDynamicPropertyIds()) {
        if (id.startsWith("pt_d:")) { try { world.setDynamicProperty(id, undefined); purged++; } catch {} }
      }
      if (purged) console.log(`[DP Monitor] Purged ${purged} deprecated pt_d: keys.`);
    } catch {}
  }, 200);

  // [PERF] Combined monitor + cleanup — single interval instead of two
  // Checks byte usage every 5 min, triggers cleanup if needed.
  system.runInterval(() => {
    try {
      const totalBytes = world.getDynamicPropertyTotalByteCount();
      if (totalBytes > DP_CFG.CRITICAL_BYTES) {
        console.error(`[DP Monitor] CRITICAL: ${formatBytes(totalBytes)} — auto-cleanup 7d...`);
        cleanupInactive(7);
      } else if (totalBytes > DP_CFG.WARN_BYTES) {
        console.warn(`[DP Monitor] WARNING: ${formatBytes(totalBytes)} — cleanup 14d...`);
        cleanupInactive(14);
      }
    } catch {}
  }, DP_CFG.MONITOR_INTERVAL);

  // [PERF] DP byte-delta monitor — logs warning when byte churn is high.
  // Uses getDynamicPropertyTotalByteCount() snapshots — self-measuring, zero integration.
  system.runInterval(() => {
    try {
      const currentBytes = world.getDynamicPropertyTotalByteCount();
      const now = Date.now();
      if (_lastByteSnap >= 0) {
        const elapsed = (now - _byteSnapTime) / 60000;
        if (elapsed >= 0.5) {
          const delta = Math.abs(currentBytes - _lastByteSnap);
          const rate = Math.round(delta / elapsed);
          if (rate > DP_BYTE_RATE_WARN) {
            console.warn(`[DP Monitor] High byte churn: ${formatBytes(rate)}/min (threshold: ${formatBytes(DP_BYTE_RATE_WARN)})`);
          }
        }
      }
      _lastByteSnap = currentBytes;
      _byteSnapTime = now;
    } catch {}
  }, 1200); // check every 60s
}
