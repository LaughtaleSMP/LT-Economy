// auction/helpers.js — Coin, lock, formatting, SFX helpers

import { world, system } from "@minecraft/server";
import { CFG, SFX } from "../config.js";

// ═══ LOCK ═══
const lockSet = new Set();
export async function withLock(id, fn) {
  if (lockSet.has(id)) return false;
  lockSet.add(id);
  try { return await fn(); }
  finally { lockSet.delete(id); }
}

// ═══ COIN ═══
function ensureCoinObj() {
  return world.scoreboard.getObjective(CFG.COIN_OBJ)
    ?? world.scoreboard.addObjective(CFG.COIN_OBJ, "Koin");
}
export function getCoin(player) {
  try { return ensureCoinObj()?.getScore(player.scoreboardIdentity ?? player) ?? 0; }
  catch { return 0; }
}
export function setCoin(player, n) {
  try { ensureCoinObj()?.setScore(player.scoreboardIdentity ?? player, Math.max(0, Math.floor(n))); }
  catch (e) { console.error("[Auction] setCoin:", e); }
}
export const addCoin = (p, n) => setCoin(p, getCoin(p) + n);

// ═══ SESSION STATE ═══
export const activeSessions = new Set();
const cooldownMap = new Map();
export const checkCooldown = p =>
  (system.currentTick - (cooldownMap.get(p.id) ?? -(CFG.COOLDOWN_TICKS + 1))) >= CFG.COOLDOWN_TICKS;
export const setCooldown = p => cooldownMap.set(p.id, system.currentTick);

// ═══ FORMAT ═══
export const fmt = n => Math.floor(n).toLocaleString("id-ID");
export function timeAgo(ts) {
  if (!ts) return "?";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)}mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}jam lalu`;
  return `${Math.floor(s / 86400)}hr lalu`;
}
export function timeLeft(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "§cExpired";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}mnt`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}jam ${m % 60}mnt`;
  return `${Math.floor(h / 24)}hr ${h % 24}jam`;
}

// ═══ SFX ═══
export const playSfx = (player, s) => {
  try { player.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch {}
};

// ═══ CLEANUP ═══
export function onPlayerLeave(playerId) {
  cooldownMap.delete(playerId);
  activeSessions.delete(playerId);
  lockSet.delete(playerId);
}

// ═══ AUCTION HELPERS ═══
export function getMinBid(listing) {
  if (!listing.bidCount || listing.bidCount === 0) return listing.startBid;
  // Pure 10% increment — minimum 1 coin to always move up
  const pctInc = Math.max(1, Math.ceil(listing.currentBid * CFG.BID_INCREMENT_PCT / 100));
  return listing.currentBid + pctInc;
}

export function getEffectivePrice(l) {
  if (l.mode === "auction") return l.currentBid > 0 ? l.currentBid : l.startBid;
  return l.price;
}
