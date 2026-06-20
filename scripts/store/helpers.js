// ============================================================
// store/helpers.js — Coin ops, locks, format utilities
// Pola: sama dengan Bank & Auction helpers
// ============================================================

import { world, system, ItemStack } from "@minecraft/server";
import { CFG } from "./config.js";

// ═══ LOCK — cegah race condition per player ═══
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
  try {
    const INT32_MAX = 2_147_483_647;
    const clamped = Math.min(INT32_MAX, Math.max(0, Math.floor(n)));
    ensureCoinObj()?.setScore(player.scoreboardIdentity ?? player, clamped);
    return true;
  } catch (e) {
    console.error("[Store] setCoin:", e);
    return false;
  }
}

export const addCoin = (p, n) => setCoin(p, getCoin(p) + n);

// ═══ SESSION STATE ═══
export const activeSessions = new Set();
const cooldownMap = new Map();
const purchaseCdMap = new Map();

export const checkCooldown = (p) =>
  (system.currentTick - (cooldownMap.get(p.id) ?? -(CFG.COOLDOWN_TICKS + 1))) >= CFG.COOLDOWN_TICKS;
export const setCooldown = (p) => cooldownMap.set(p.id, system.currentTick);

export const checkPurchaseCd = (p) =>
  (system.currentTick - (purchaseCdMap.get(p.id) ?? -(CFG.PURCHASE_CD_TICKS + 1))) >= CFG.PURCHASE_CD_TICKS;
export const setPurchaseCd = (p) => purchaseCdMap.set(p.id, system.currentTick);

// ═══ FORMAT ═══
export const fmt = (n) => Math.floor(n).toLocaleString("id-ID");

export function timeAgo(ts) {
  if (!ts) return "?";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)}mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)}jam lalu`;
  return `${Math.floor(s / 86400)}hr lalu`;
}

// ═══ ITEM GIVE — aman, auto-split stack ═══
/**
 * Berikan qty item ke player inventory.
 * Otomatis split ke multiple stack kalau qty > maxAmount.
 * @returns {number} jumlah unit yang BERHASIL diberikan (bisa < qty kalau inventory penuh)
 */
export function giveItems(player, itemId, totalQty) {
  if (totalQty <= 0) return 0;
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return 0;

    let given = 0;
    let remaining = totalQty;

    // Coba buat 1 ItemStack dulu untuk cek apakah valid & dapat max stack size
    let testStack;
    try {
      testStack = new ItemStack(itemId, 1);
    } catch (e) {
      console.warn(`[Store] Invalid item id: ${itemId}`, e);
      return 0;
    }
    const maxStack = testStack.maxAmount || 64;

    while (remaining > 0) {
      const take = Math.min(remaining, maxStack);
      const stack = new ItemStack(itemId, take);
      const leftover = inv.addItem(stack);
      if (leftover) {
        // Inventory penuh sebagian — hitung yang berhasil
        given += (take - (leftover.amount || 0));
        break;
      } else {
        given += take;
        remaining -= take;
      }
    }
    return given;
  } catch (e) {
    console.warn("[Store] giveItems error:", e);
    return 0;
  }
}

/** Cek ketersediaan slot — apakah player bisa menerima qty item? */
export function canFitItems(player, itemId, totalQty) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    // Fast path: cek empty slot
    let emptySlots = 0;
    const maxStack = 64; // asumsi terburuk
    for (let i = 0; i < inv.size; i++) {
      if (!inv.getItem(i)) emptySlots++;
    }
    const capacity = emptySlots * maxStack;
    return capacity >= totalQty;
  } catch {
    return false;
  }
}

// ═══ SFX HELPER ═══
export const playSfx = (player, s) => {
  try { player.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch {}
};

// ═══ CLEANUP ═══
export function onPlayerLeave(playerId) {
  cooldownMap.delete(playerId);
  purchaseCdMap.delete(playerId);
  activeSessions.delete(playerId);
  lockSet.delete(playerId);
}
