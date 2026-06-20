// kill_fx.js — KillFX data layer (persistence + spawn)
// Shared by Combat PvP and MobuXP mob kills.
// Cache: TTL 5min, cap 50, cleanup on playerLeave.

import { world } from "@minecraft/server";
import { pGet, pSet, getOnlinePlayer } from "./player_dp.js";
import { CFG } from "./Combat/config.js";

const K_KILL_FX = "ckfx:";
const CACHE_MAX = 50;
const CACHE_TTL = 300_000; // 5 menit

const _dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try { world.setDynamicProperty(k, JSON.stringify(v)); }
    catch (e) { console.warn("[KillFX] dp.set failed:", k, e.message); }
  },
};

// Cache with TTL + cap
const _fxCache = new Map(); // pid -> { data, ts }

function _evictIfNeeded() {
  if (_fxCache.size < CACHE_MAX) return;
  // Evict oldest entry
  const first = _fxCache.keys().next().value;
  if (first !== undefined) _fxCache.delete(first);
}

// Default state factory
const _defaultFx = () => ({ active: "Games:coins", owned: ["Games:coins", "none"] });

/**
 * Get player's kill effect preference (cached, TTL 5min).
 * @returns {{ active: string, owned: string[] }}
 */
export function getKillFx(pid) {
  const cached = _fxCache.get(pid);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const p = getOnlinePlayer(pid);
  const def = _defaultFx();
  const v = p ? pGet(p, K_KILL_FX, def) : _dp.get(K_KILL_FX + pid, def);
  if (!v.owned) v.owned = ["Games:coins", "none"];
  if (!v.owned.includes("Games:coins")) v.owned.push("Games:coins");
  if (!v.owned.includes("none")) v.owned.push("none");

  _evictIfNeeded();
  _fxCache.set(pid, { data: v, ts: Date.now() });
  return v;
}

/**
 * Set player's kill effect preference (write-through).
 */
export function setKillFx(pid, v) {
  _fxCache.set(pid, { data: v, ts: Date.now() });
  const p = getOnlinePlayer(pid);
  if (p) pSet(p, K_KILL_FX, v);
  else _dp.set(K_KILL_FX + pid, v);
}

// Pre-build effect ID lookup for O(1) sound resolution
const _idKey = (id) => Array.isArray(id) ? JSON.stringify(id) : id;
const _effectById = new Map(CFG.KILL_EFFECTS.map(e => [_idKey(e.id), e]));

/**
 * Spawn the player's chosen kill effect.
 * Supports particle and entity-summon (prefixed "summon:").
 */
export function spawnKillEffect(player, pos) {
  const fx = getKillFx(player.id);
  const effectId = fx.active || "Games:coins";
  if (effectId === "none") return;
  const loc = pos ?? { x: player.location.x, y: player.location.y + 1, z: player.location.z };
  const ids = Array.isArray(effectId) ? effectId : [effectId];
  for (const id of ids) {
    if (typeof id === "string" && id.startsWith("summon:")) {
      try { player.runCommand(`summon ${id.slice(7)} ${loc.x} ${loc.y} ${loc.z}`); }
      catch (e) { console.warn(`[KillFX] summon failed: ${id.slice(7)} — ${e.message}`); }
      continue;
    }
    try { player.runCommand(`particle ${id} ${loc.x} ${loc.y} ${loc.z}`); }
    catch {
      try { player.dimension.spawnParticle(id, loc); }
      catch (e) { console.warn(`[KillFX] particle failed: ${id} — ${e.message}`); }
    }
  }
}

/**
 * Play kill effect sounds for nearby players.
 * Uses pre-built lookup — O(1) instead of Array.find.
 */
export function playKillFxSound(player, pos) {
  const fx = getKillFx(player.id);
  const effectId = fx.active || "Games:coins";
  const eff = _effectById.get(_idKey(effectId));
  if (!eff?.sound) return;
  const loc = pos ?? player.location;
  const sounds = Array.isArray(eff.sound) ? eff.sound : [eff.sound];
  for (const s of sounds) {
    try { player.runCommand(`playsound ${s.id} @a[r=48] ${loc.x} ${loc.y} ${loc.z} ${s.vol} ${s.pitch}`); }
    catch {}
  }
}

/**
 * Play kill effect sounds for ALL players on the server (no radius limit).
 * Used when a player purchases/activates a new effect — announcement sound.
 */
export function broadcastKillFxSound(player, pos) {
  const fx = getKillFx(player.id);
  const effectId = fx.active || "Games:coins";
  const eff = _effectById.get(_idKey(effectId));
  if (!eff?.sound) return;
  const loc = pos ?? player.location;
  const sounds = Array.isArray(eff.sound) ? eff.sound : [eff.sound];
  for (const s of sounds) {
    try { player.runCommand(`playsound ${s.id} @a ${loc.x} ${loc.y} ${loc.z} ${s.vol} ${s.pitch}`); }
    catch {}
  }
}

/** Evict cache for a player (call on leave). */
export function evictKillFxCache(pid) { _fxCache.delete(pid); }

/** Prune cache: remove offline players + expired entries. */
export function pruneKillFxCache() {
  if (_fxCache.size <= 10) return;
  const now = Date.now();
  for (const [pid, entry] of _fxCache) {
    if (now - entry.ts > CACHE_TTL || !getOnlinePlayer(pid)) _fxCache.delete(pid);
  }
}
