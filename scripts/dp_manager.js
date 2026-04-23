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
    "pg_s:", "eq_s:", "eq_py:", "eq_p:", "hist:", "ud:", "pt_d:", "imp_p:",
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
  CLEANUP_DAYS:       30,
  WARN_BYTES:         500_000,
  CRITICAL_BYTES:     1_500_000,
  MONITOR_INTERVAL:   6000,     // ~5 menit
  CLEANUP_INTERVAL:   72000,    // ~1 jam
  CLEANUP_BATCH:      3,        // maks player di-cleanup per tick (spread load)
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
// [PERF] Batch processing: maks N player per tick via system.run chain.
// ═══════════════════════════════════════════════════════════

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
 * @param {number} [thresholdDays]
 * @param {boolean} [immediate] — true = langsung semua (untuk admin manual)
 */
export function cleanupInactive(thresholdDays = DP_CFG.CLEANUP_DAYS, immediate = false) {
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

  if (toCleanup.length === 0) return { players: 0, keys: 0 };

  // [PERF] Immediate mode: proses semua sekarang (untuk admin manual click)
  if (immediate || toCleanup.length <= DP_CFG.CLEANUP_BATCH) {
    let totalKeys = 0;
    for (const pid of toCleanup) totalKeys += cleanupPlayer(pid, allIds);
    console.log(`[DP Cleanup] Dibersihkan ${totalKeys} keys dari ${toCleanup.length} player inaktif (>${thresholdDays} hari).`);
    return { players: toCleanup.length, keys: totalKeys };
  }

  // [PERF] Batch mode: spread ke beberapa tick supaya TPS stabil
  let idx = 0;
  let totalKeys = 0;
  function processBatch() {
    // Re-fetch IDs sekali per batch (keys berubah setelah delete)
    const freshIds = world.getDynamicPropertyIds();
    const end = Math.min(idx + DP_CFG.CLEANUP_BATCH, toCleanup.length);
    for (; idx < end; idx++) {
      totalKeys += cleanupPlayer(toCleanup[idx], freshIds);
    }
    if (idx < toCleanup.length) {
      system.run(processBatch); // lanjut di tick berikutnya
    } else {
      console.log(`[DP Cleanup] Dibersihkan ${totalKeys} keys dari ${toCleanup.length} player inaktif (>${thresholdDays} hari).`);
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
  // [PERF] Byte-check berkala — hanya 1 API call, sangat ringan
  system.runInterval(() => {
    try {
      const totalBytes = world.getDynamicPropertyTotalByteCount();
      if (totalBytes > DP_CFG.CRITICAL_BYTES) {
        console.error(`[DP Monitor] ⛔ CRITICAL: ${formatBytes(totalBytes)} — auto-cleanup 7 hari...`);
        cleanupInactive(7);
      } else if (totalBytes > DP_CFG.WARN_BYTES) {
        console.warn(`[DP Monitor] ⚠ WARNING: ${formatBytes(totalBytes)}`);
      }
    } catch {}
  }, DP_CFG.MONITOR_INTERVAL);

  // Auto-cleanup berkala — spread across ticks
  system.runInterval(() => {
    try { cleanupInactive(); } catch {}
  }, DP_CFG.CLEANUP_INTERVAL);

}
