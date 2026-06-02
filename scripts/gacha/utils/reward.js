import { world, ItemStack, EnchantmentTypes } from "@minecraft/server";
import { CFG, PT_POOL, EQ_POOL, EQ_IDX, R } from "../config.js";
import { dpGet, dpSet } from "./storage.js";
import { refundGem } from "./scoreboard.js";
import { syncPlayerData } from "./player.js";
import { getByteLength } from "../../dp_manager.js";

export function applyEnchants(stack, rarity, id) {
  if (rarity !== "EPIC" && rarity !== "LEGENDARY") return;
  try {
    const enc = stack.getComponent("minecraft:enchantable"); if (!enc) return;
    const add = (e, l) => { try { enc.addEnchantment({ type: EnchantmentTypes.get(e), level: l }); } catch {} };
    const sw   = id.includes("sword");
    const helm = id.includes("helmet"), chst = id.includes("chestplate"), legs = id.includes("leggings");
    if (rarity === "EPIC") {
      if (sw)                    { add("sharpness",3); add("fire_aspect",1); add("unbreaking",2); }
      else if (helm||chst||legs) { add("protection",3); add("unbreaking",2); }
      else if (id === "minecraft:bow")      { add("power",3); add("punch",1); }
      else if (id === "minecraft:crossbow") { add("multishot",1); add("unbreaking",2); }
    } else {
      if (sw)                    { add("sharpness",5); add("fire_aspect",2); add("looting",3); add("unbreaking",3); }
      else if (helm||chst||legs) {
        add("protection",4); add("unbreaking",3);
        if (chst) add("thorns",3); if (helm) add("aqua_affinity",1);
      }
      else if (id === "minecraft:bow")      { add("power",5); add("punch",2); add("infinity",1); }
      else if (id === "minecraft:crossbow") { add("multishot",1); add("quick_charge",3); add("unbreaking",3); }
    }
  } catch {}
}

/**
 * Apply enchantments dari field item.enchants (untuk enchanted book / item khusus).
 * Berbeda dari applyEnchants yang otomatis berdasarkan rarity — ini eksplisit dari config.
 */
function applySpecificEnchants(stack, enchants) {
  if (!enchants?.length) return;
  try {
    const enc = stack.getComponent("minecraft:enchantable");
    if (!enc) return;
    for (const { id, level } of enchants) {
      try { enc.addEnchantment({ type: EnchantmentTypes.get(id), level }); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * [FIX] Menggunakan WORLD DP, bukan player DP.
 * Player DP bersifat pack-scoped — Economy set, Dragon Update tidak bisa baca.
 */
function _markAuctionElytra(player) {
  try {
    const key = `ll:ely_pending_${player.id}`;
    const cur = world.getDynamicProperty(key) ?? 0;
    world.setDynamicProperty(key, cur + 1);
  } catch (e) {
    console.error(`[ELY-MARK-GACHA] FAILED for ${player?.name}: ${e}`);
  }
}

/**
 * Buat ItemStack dari item config dan siapkan semua properti:
 * - nameTag (untuk EPIC & LEGENDARY)
 * - applyEnchants (auto berdasarkan rarity)
 * - applySpecificEnchants (dari field enchants — untuk enchanted book)
 * - ll:auction_give (untuk elytra — bypass dragon daily limit)
 */
function buildStack(item) {
  const stack = new ItemStack(item.id, item.qty ?? 1);
  applyEnchants(stack, item.rarity, item.id);
  applySpecificEnchants(stack, item.enchants);
  // Set nama kustom untuk EPIC & LEGENDARY agar tampil dengan warna rarity
  // SKIP untuk elytra — elyStripRename di dragon_boundary akan hapus nameTag apapun
  // Menambahkan nameTag pada elytra menyebabkan:
  //   1. Inkonsistensi: tampil "§6Elytra" lalu reversi ke vanilla setelah scan
  //   2. hasComplexData = true → warning palsu "data custom mungkin hilang" di sell UI
  //   3. Browse auction menampilkan ⚠ renamed badge palsu
  if ((item.rarity === "EPIC" || item.rarity === "LEGENDARY") && item.id !== "minecraft:elytra") {
    try { stack.nameTag = `${R[item.rarity].color}${item.name}`; } catch (_) {}
  }
  // [FIX] Elytra dari gacha harus bypass dragon daily limit
  // Sama seperti elytra dari auction — dragon scan akan confiscate jika ll:count >= 1
  if (item.id === "minecraft:elytra") {
    try { stack.setDynamicProperty("ll:auction_give", true); } catch (_) {}
  }
  return stack;
}

// [FIX] encPend menggunakan findIndex(id + name) bukan EQ_IDX
// EQ_IDX hanya memetakan id → satu index (last entry), collision untuk dua enchanted_book berbeda
const encPend = list => list.map(it => ({
  i: EQ_POOL.findIndex(p => p.id === it.id && p.name === it.name)
})).filter(e => e.i !== -1);
const decPend = raw => raw.filter(e => e.i >= 0 && e.i < EQ_POOL.length).map(({ i }) => ({ ...EQ_POOL[i] }));

export const getPend = p => decPend(dpGet(CFG.K_EQ_PEND + p.id, []));

export function savePend(p, list) {
  let enc = encPend(list), str = JSON.stringify(enc);
  const orig = enc.length;
  while (enc.length > 0 && getByteLength(str) > 30000) { enc.pop(); str = JSON.stringify(enc); }
  if (enc.length < orig) console.warn(`[Gacha] savePend: ${orig - enc.length} item terpotong (${p.name})`);
  dpSet(CFG.K_EQ_PEND + p.id, enc);
}

export function addPend(p, item) {
  const list = getPend(p);
  if (list.length >= CFG.MAX_PENDING) { p.sendMessage("§c[!] Pending penuh! Klaim dulu."); return false; }
  list.push(item); savePend(p, list); return true;
}

export function claimPend(p) {
  const list = getPend(p); if (!list.length) return 0;
  const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) return 0;
  const still = []; let n = 0;
  for (const item of list) {
    try {
      const stack = buildStack(item);
      if (inv.addItem(stack)) still.push(item);
      else {
        // [FIX] Set player-level DP saat klaim pending elytra
        if (item.id === "minecraft:elytra") _markAuctionElytra(p);
        n++;
      }
    } catch { still.push(item); }
  }
  savePend(p, still); return n;
}

export function applyReward(player, item, type) {
  if (type === "PARTICLE") {
    if (player.hasTag(item.tag)) {
      // Duplicate — refund GEM. Log kalau gagal (player tidak akan complain
      // karena dup juga tidak kasih item baru, tapi worth investigating).
      if (!refundGem(player, CFG.GEM_REFUND)) {
        console.warn(`[Gacha] dup refund failed: ${player.name} ${CFG.GEM_REFUND} gem`);
      }
      return { ...item, isDup: true };
    }
    player.addTag(item.tag);
    syncPlayerData(player);
    return { ...item, isDup: false };
  }
  const stack = buildStack(item);
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (inv) {
    const remaining = inv.addItem(stack);
    if (remaining) {
      // Inventory penuh — item masuk pending, JANGAN mark (akan di-mark saat claimPend berhasil)
      addPend(player, item);
    } else {
      // Item berhasil masuk inventory — mark bypass sekarang
      if (item.id === "minecraft:elytra") _markAuctionElytra(player);
    }
  } else {
    addPend(player, item);
  }
  return { ...item, isDup: false };
}

export function preCheckDupBatch(player, items, type) {
  if (type !== "PARTICLE") return items.map(r => ({ ...r, isDup: false }));
  const seen = new Set();
  return items.map(r => {
    const isDup = player.hasTag(r.tag) || seen.has(r.tag);
    if (!isDup) seen.add(r.tag);
    return { ...r, isDup };
  });
}
