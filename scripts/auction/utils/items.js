// auction/items.js
// Serialisasi & deserialisasi ItemStack untuk penyimpanan di DynamicProperty.

import { ItemStack } from "@minecraft/server";
import { CATEGORIES, CAT_OTHER } from "../config.js";

// ═══════════════════════════════════════════════════════════
// SERIALIZE — ubah ItemStack jadi plain object
// ═══════════════════════════════════════════════════════════
export function serializeItem(itemStack) {
  const data = {
    typeId: itemStack.typeId,
    amount: itemStack.amount,
  };

  if (itemStack.nameTag) data.nameTag = itemStack.nameTag;

  // Lore
  try {
    const lore = itemStack.getLore();
    if (lore && lore.length > 0) data.lore = lore;
  } catch {}

  // Enchantments
  try {
    const enc = itemStack.getComponent("minecraft:enchantable");
    if (enc) {
      const list = enc.getEnchantments();
      if (list.length > 0) {
        data.enchantments = list.map(e => ({
          id: e.type.id,
          level: e.level,
        }));
      }
    }
  } catch {}

  // Durability
  try {
    const dur = itemStack.getComponent("minecraft:durability");
    if (dur) {
      data.damage       = dur.damage;
      data.maxDurability = dur.maxDurability;
    }
  } catch {}

  return data;
}

// ═══════════════════════════════════════════════════════════
// DESERIALIZE — buat ItemStack dari plain object
// ═══════════════════════════════════════════════════════════
export function deserializeItem(data) {
  try {
    const item = new ItemStack(data.typeId, data.amount ?? 1);

    if (data.nameTag) item.nameTag = data.nameTag;

    // Lore
    if (data.lore && data.lore.length > 0) {
      try { item.setLore(data.lore); } catch {}
    }

    // Enchantments
    if (data.enchantments && data.enchantments.length > 0) {
      try {
        const enc = item.getComponent("minecraft:enchantable");
        if (enc) {
          for (const e of data.enchantments) {
            try { enc.addEnchantment({ type: e.id, level: e.level }); } catch {}
          }
        }
      } catch {}
    }

    // Durability
    if (typeof data.damage === "number") {
      try {
        const dur = item.getComponent("minecraft:durability");
        if (dur) dur.damage = data.damage;
      } catch {}
    }

    return item;
  } catch (e) {
    console.error("[Auction] deserializeItem gagal:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// INVENTORY HELPERS
// ═══════════════════════════════════════════════════════════
export function giveItem(player, itemData) {
  const item = deserializeItem(itemData);
  if (!item) return false;

  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    for (let i = 0; i < inv.size; i++) {
      if (!inv.getItem(i)) {
        inv.setItem(i, item);
        return true;
      }
    }
    return false;   // inventory penuh
  } catch (e) {
    console.error("[Auction] giveItem gagal:", e);
    return false;
  }
}

export function takeItemFromSlot(player, slot) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return null;

    const item = inv.getItem(slot);
    if (!item) return null;

    const data = serializeItem(item);
    inv.setItem(slot, undefined);
    return data;
  } catch (e) {
    console.error("[Auction] takeItemFromSlot gagal:", e);
    return null;
  }
}

/**
 * Ambil sebagian stack dari slot inventory.
 * Jika quantity === item.amount, ambil semua (hapus slot).
 * Jika quantity < item.amount, kurangi amount di slot, return data dengan amount = quantity.
 * @returns {object|null} serialized item data dengan amount = quantity, atau null jika gagal
 */
export function takePartialFromSlot(player, slot, quantity) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return null;

    const item = inv.getItem(slot);
    if (!item) return null;
    if (quantity <= 0 || quantity > item.amount) return null;

    // Serialize SEBELUM modifikasi slot
    const data = serializeItem(item);
    data.amount = quantity;

    if (quantity === item.amount) {
      // Ambil semua — hapus slot
      inv.setItem(slot, undefined);
    } else {
      // Ambil sebagian — buat stack baru dengan sisa amount
      // Gunakan item yang sudah ada, clone via ItemStack constructor + set properties
      const remaining = new ItemStack(item.typeId, item.amount - quantity);
      if (item.nameTag) remaining.nameTag = item.nameTag;
      try { remaining.setLore(item.getLore()); } catch {}
      try {
        const srcEnc = item.getComponent("minecraft:enchantable");
        const dstEnc = remaining.getComponent("minecraft:enchantable");
        if (srcEnc && dstEnc) {
          for (const e of srcEnc.getEnchantments()) {
            try { dstEnc.addEnchantment(e); } catch {}
          }
        }
      } catch {}
      try {
        const srcDur = item.getComponent("minecraft:durability");
        const dstDur = remaining.getComponent("minecraft:durability");
        if (srcDur && dstDur) dstDur.damage = srcDur.damage;
      } catch {}
      inv.setItem(slot, remaining);
    }

    return data;
  } catch (e) {
    console.error("[Auction] takePartialFromSlot gagal:", e);
    return null;
  }
}

export function freeSlots(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return 0;
  let f = 0;
  for (let i = 0; i < inv.size; i++) if (!inv.getItem(i)) f++;
  return f;
}

// ═══════════════════════════════════════════════════════════
// KATEGORI — deteksi kategori item berdasarkan typeId
// ═══════════════════════════════════════════════════════════

/**
 * Tentukan kategori item berdasarkan typeId.
 * @param {string} typeId - e.g. "minecraft:diamond_sword"
 * @returns {{ id: string, label: string, color: string }}
 */
export function getCategory(typeId) {
  const id = (typeId ?? "").replace("minecraft:", "");
  for (const cat of CATEGORIES) {
    if (cat.re.test(id)) return cat;
  }
  return CAT_OTHER;
}

// ═══════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════
export function displayName(itemData) {
  if (itemData.nameTag) {
    // Strip §k (obfuscated text) dan invisible marker prefix yang bikin "????"
    // Juga strip §0§r§k§r pattern dari gacha MARK
    let clean = itemData.nameTag
      .replace(/§k/g, "")             // hapus obfuscated formatter
      .replace(/\u00A7k/g, "")        // hapus unicode variant
      .replace(/\u00A70\u00A7r\u00A7k\u00A7r/g, "") // hapus gacha MARK prefix
      .replace(/§0§r§k§r/g, "")       // hapus MARK dalam format biasa
      .trim();
    if (clean.length > 0) return clean;
  }
  // Fallback: format typeId jadi readable
  const id = itemData.typeId ?? "unknown";
  const raw = id.includes(":") ? id.split(":").pop() : id;
  return raw.replace(/_/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function enchantSummary(itemData) {
  if (!itemData.enchantments || !itemData.enchantments.length) return "";
  return itemData.enchantments
    .map(e => {
      const name = e.id.replace("minecraft:", "").replace(/_/g, " ");
      return `${name} ${toRoman(e.level)}`;
    })
    .join(", ");
}

function toRoman(n) {
  if (n <= 0 || n > 10) return String(n);
  const r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return r[n];
}
