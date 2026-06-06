// Mimi Inka cross-pack data bridge for recovery backup
// SLO: cache freshness <= 10 min. Graceful null if Mimi Inka offline.
// §7.4: external call fail != feature dead → return empty object
// §8.5: scriptevent bridge, not shared DP

import { world, system } from "@minecraft/server";

let _cache = null;
let _lastReplyTs = 0;
const CACHE_TTL = 600_000; // 10 min — matches 2x sync interval

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "mimi:backup_reply") return;
  try {
    _cache = JSON.parse(event.message);
    _lastReplyTs = Date.now();
  } catch (e) {
    console.warn(`[Sync-Mimi] parse failed: ${e.message}`);
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
