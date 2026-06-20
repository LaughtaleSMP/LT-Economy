// Mimi Inka cross-pack data bridge for recovery backup
// SLO: cache freshness <= 10 min. Graceful null if Mimi Inka offline.
// §7.4: external call fail != feature dead → return empty object
// §8.5: scriptevent bridge, not shared DP
// Supports chunked reply for large payloads (>1800 chars)

import { world, system } from "@minecraft/server";

let _cache = null;
let _lastReplyTs = 0;
const CACHE_TTL = 600_000; // 10 min

// Chunked reply assembly state
let _chunkBuf = [];
let _chunkTotal = 0;

system.afterEvents.scriptEventReceive.subscribe((event) => {
  // Single reply (payload <= 1800 chars)
  if (event.id === "mimi:backup_reply") {
    try {
      _cache = JSON.parse(event.message);
      _lastReplyTs = Date.now();
    } catch (e) {
      console.warn(`[Sync-Mimi] parse failed: ${e.message}`);
    }
    return;
  }

  // Chunked reply — START
  if (event.id === "mimi:backup_start") {
    const total = parseInt(event.message, 10);
    // [FIX] Cap at 200 chunks (200×1800 = 360KB) — guard against runaway allocation
    if (!isNaN(total) && total > 0 && total <= 200) {
      _chunkBuf = new Array(total);
      _chunkTotal = total;
    }
    return;
  }

  // Chunked reply — CHUNK
  if (event.id === "mimi:backup_chunk") {
    try {
      const sepIdx = event.message.indexOf('|');
      if (sepIdx < 0) return;
      const idx = parseInt(event.message.slice(0, sepIdx), 10);
      const data = event.message.slice(sepIdx + 1);
      if (isNaN(idx) || idx < 0 || idx >= _chunkTotal) return;

      _chunkBuf[idx] = data;

      // [FIX] Use !== undefined (not filter(Boolean)) to handle empty-string chunks
      const filled = _chunkBuf.filter(c => c !== undefined).length;
      if (filled === _chunkTotal) {
        const full = _chunkBuf.join('');
        _cache = JSON.parse(full);
        _lastReplyTs = Date.now();
        _chunkBuf = [];
        _chunkTotal = 0;
      }
    } catch (e) {
      console.warn(`[Sync-Mimi] chunk assembly failed: ${e.message}`);
      _chunkBuf = [];
      _chunkTotal = 0;
    }
    return;
  }
});

export function requestMimiBackup() {
  try {
    world.getDimension("overworld").runCommand("scriptevent mimi:backup_request");
  } catch {
    // §7.4: graceful degradation — Mimi Inka pack may not be loaded
  }
}

// Returns {ct, cn, it, in} or null
export function getMimiData(playerName) {
  if (!_cache || Date.now() - _lastReplyTs > CACHE_TTL) return null;
  return _cache[playerName] || null;
}

// Returns all player names in the mimi cache
export function getAllMimiNames() {
  if (!_cache || Date.now() - _lastReplyTs > CACHE_TTL) return [];
  return Object.keys(_cache);
}
