// auction/storage.js

import { world } from "@minecraft/server";
import { CFG } from "../config.js";
import { getByteLength } from "../../dp_manager.js";

// ═══════════════════════════════════════════════════════════
// DYNAMIC PROPERTY WRAPPER
// ═══════════════════════════════════════════════════════════
const dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try {
      const str = JSON.stringify(v);
      const byteLen = getByteLength(str);
      if (byteLen > 30_000)
        console.warn(`[Auction] dp.set WARNING: "${k}" ${byteLen} bytes (limit 32KB)`);
      world.setDynamicProperty(k, str);
    } catch (e) { console.error("[Auction] dp.set gagal:", k, e); }
  },
  del: (k) => { try { world.setDynamicProperty(k, undefined); } catch {} },
};

export { dp };

// ═══════════════════════════════════════════════════════════
// SETTINGS (cached)
// ═══════════════════════════════════════════════════════════
let _settingsCache = null;

export function getSettings() {
  if (!_settingsCache) _settingsCache = dp.get(CFG.K_SETTINGS, { feePct: CFG.LISTING_FEE_PCT });
  return _settingsCache;
}
export function saveSettings(s) {
  _settingsCache = s;
  dp.set(CFG.K_SETTINGS, s);
}
export const getFee  = () => getSettings().feePct;
export const calcFee = (n) => Math.ceil(n * getFee() / 100);

// ═══════════════════════════════════════════════════════════
// LISTINGS CRUD (cached — hindari JSON.parse berulang)
// ═══════════════════════════════════════════════════════════
let _listCache = null;  // in-memory cache, null = belum loaded

export const genId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/**
 * Ambil semua listings dari cache (atau load dari DP jika belum).
 * Mengembalikan referensi langsung — jangan mutasi tanpa saveListings()!
 */
export function getListings() {
  if (_listCache === null) {
    _listCache = dp.get(CFG.K_LISTINGS, []);
  }
  return _listCache;
}

/**
 * Simpan listings ke DP dan update cache.
 * Jika ukuran data mendekati batas DP, auto-prune entri lama.
 */
export function saveListings(listings) {
  _listCache = listings;
  const str = JSON.stringify(listings);
  const byteLen = getByteLength(str);

  // Size guard: byte-accurate — jika mendekati batas, buang entri non-active terlama
  if (byteLen > CFG.DP_MAX_BYTES) {
    console.warn(`[Auction] saveListings: ${byteLen} bytes > ${CFG.DP_MAX_BYTES} limit! Auto-pruning...`);
    // [PERF] Hapus sold/expired paling lama, estimasi ~700B per entri
    // Hindari JSON.stringify berulang di dalam loop (mahal)
    const sorted = listings
      .filter(l => l.status !== "active")
      .sort((a, b) => (a.expiresAt ?? a.createdAt) - (b.expiresAt ?? b.createdAt));
    let estBytes = byteLen;
    while (sorted.length > 0 && estBytes > CFG.DP_MAX_BYTES) {
      const oldest = sorted.shift();
      const idx = listings.indexOf(oldest);
      if (idx >= 0) {
        // Estimasi bytes yang dihemat (hindari stringify ulang)
        estBytes -= getByteLength(JSON.stringify(oldest)) + 1; // +1 untuk koma
        listings.splice(idx, 1);
      }
    }
    _listCache = listings;
  }

  dp.set(CFG.K_LISTINGS, listings);
}

export function getActiveListings() {
  const now = Date.now();
  return getListings().filter(l => l.status === "active" && l.expiresAt > now);
}

export function getPlayerActiveCount(playerId) {
  return getActiveListings().filter(l => l.sellerId === playerId).length;
}

export function getListing(id) {
  return getListings().find(l => l.id === id) ?? null;
}

export function addListing(listing) {
  const all = getListings();
  all.push(listing);
  saveListings(all);
}

export function removeListing(id) {
  saveListings(getListings().filter(l => l.id !== id));
}

export function updateListing(id, updater) {
  const all = getListings();
  const idx = all.findIndex(l => l.id === id);
  if (idx < 0) return false;
  updater(all[idx]);
  saveListings(all);
  return true;
}

// ═══════════════════════════════════════════════════════════
// PRUNE EXPIRED (optimized — skip jika tidak ada yg expired)
// ═══════════════════════════════════════════════════════════
export function pruneExpired() {
  const now = Date.now();
  const all = getListings();

  // Quick check: ada yang perlu di-prune?
  const needsPrune = all.some(l =>
    (l.status === "active" && l.expiresAt <= now) ||
    (l.status !== "active" && (now - (l.expiresAt ?? l.createdAt)) > CFG.OLD_RETAIN_MS)
  );
  if (!needsPrune) return { expired: [], settled: [] };

  const expired = [];
  const settled = [];
  const kept    = [];

  for (const l of all) {
    if (l.status === "active" && l.expiresAt <= now) {
      // Auction with winning bid → auto-settle as sold
      if (l.mode === "auction" && l.bidderId && l.currentBid > 0) {
        l.status = "sold";
        l.buyerId = l.bidderId;
        l.buyerName = l.bidderName;
        settled.push(l);
      } else {
        l.status = "expired";
        expired.push(l);
      }
    }
    // Buang entri lama setelah OLD_RETAIN_MS
    if (l.status !== "active" && (now - (l.expiresAt ?? l.createdAt)) > CFG.OLD_RETAIN_MS) {
      continue;
    }
    kept.push(l);
  }

  if (expired.length > 0 || settled.length > 0 || kept.length !== all.length) {
    saveListings(kept);
  }
  return { expired, settled };
}

// ═══════════════════════════════════════════════════════════
// HISTORY — global auction log
// ═══════════════════════════════════════════════════════════
export function getHistory() {
  return dp.get(CFG.K_HIST, []);
}

export function pushHistory(entry) {
  const hist = getHistory();
  hist.unshift({ ...entry, ts: Date.now() });
  dp.set(CFG.K_HIST, hist.slice(0, CFG.MAX_HIST));
}

// ═══════════════════════════════════════════════════════════
// PENDING NOTIFICATIONS (offline)
// ═══════════════════════════════════════════════════════════
export function pushNotif(playerId, msg) {
  const list = dp.get(CFG.K_NOTIF + playerId, []);
  list.push(msg);
  dp.set(CFG.K_NOTIF + playerId, list.slice(0, 15));
}

export function flushNotifs(player) {
  const list = dp.get(CFG.K_NOTIF + player.id, []);
  if (!list.length) return;
  dp.del(CFG.K_NOTIF + player.id);
  for (const msg of list) player.sendMessage(msg);
}

// ═══════════════════════════════════════════════════════════
// PENDING ITEMS (expired / cancelled listing returns)
// ═══════════════════════════════════════════════════════════
export function getPendingItems(playerId) {
  return dp.get(CFG.K_PEND_ITEMS + playerId, []);
}

export function addPendingItem(playerId, itemData) {
  const list = getPendingItems(playerId);
  list.push(itemData);
  // Batas max 20 pending items per player (mencegah DP overflow)
  if (list.length > 20) {
    console.warn(`[Auction] addPendingItem: player ${playerId} punya ${list.length} pending items, trim ke 20.`);
    list.splice(0, list.length - 20); // hapus terlama
  }
  dp.set(CFG.K_PEND_ITEMS + playerId, list);
}

export function clearPendingItems(playerId) {
  dp.del(CFG.K_PEND_ITEMS + playerId);
}

export function savePendingItems(playerId, list) {
  if (!list.length) dp.del(CFG.K_PEND_ITEMS + playerId);
  else dp.set(CFG.K_PEND_ITEMS + playerId, list);
}

// ═══════════════════════════════════════════════════════════
// PENDING COIN (offline seller/bidder refund)
// ═══════════════════════════════════════════════════════════
export function addPendingCoin(playerId, amount) {
  const key = CFG.K_PEND_COIN + playerId;
  const existing = dp.get(key, 0);
  dp.set(key, existing + amount);
}

export function claimPendingCoin(player, addCoinFn) {
  const key = CFG.K_PEND_COIN + player.id;
  const amount = dp.get(key, 0);
  if (amount > 0) {
    addCoinFn(player, amount);
    dp.del(key);
    return amount;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════
// TRANSACTION JOURNAL (Write-Ahead Log)
// Proteksi crash: tulis intent SEBELUM operasi,
// hapus SETELAH selesai. Recovery saat startup.
// ═══════════════════════════════════════════════════════════

/**
 * Tulis transaksi sebelum operasi berbahaya.
 * @param {string} playerId
 * @param {object} tx - { type: "sell"|"buy", ...data }
 */
export function writeTx(playerId, tx) {
  dp.set(CFG.K_TX + playerId, { ...tx, ts: Date.now() });
}

/**
 * Hapus transaksi setelah operasi berhasil.
 */
export function clearTx(playerId) {
  dp.del(CFG.K_TX + playerId);
}

/**
 * Cek apakah ada transaksi incomplete untuk player.
 */
export function getTx(playerId) {
  return dp.get(CFG.K_TX + playerId, null);
}

/**
 * Recovery: dipanggil saat player login.
 * Mengembalikan item/koin yang tertahan akibat crash.
 * @returns {string[]} pesan recovery untuk player
 */
export function recoverTx(playerId) {
  const tx = getTx(playerId);
  if (!tx) return [];

  const messages = [];

  try {
    if (tx.type === "sell") {
      const listing = getListings().find(l => l.id === tx.listingId);
      if (!listing) {
        if (tx.itemData) {
          addPendingItem(playerId, tx.itemData);
          messages.push("§e[Auction Recovery] Item dari listing gagal dikembalikan ke pending.");
        }
        if (tx.fee > 0) {
          addPendingCoin(playerId, tx.fee);
          messages.push(`§e[Auction Recovery] Fee §f${tx.fee} Koin §edikembalikan.`);
        }
      }
    }

    if (tx.type === "buy") {
      const listing = getListings().find(l => l.id === tx.listingId);
      if (listing && listing.status === "active") {
        addPendingCoin(playerId, tx.price);
        messages.push(`§e[Auction Recovery] Pembelian gagal, §f${tx.price} Koin §edikembalikan.`);
      }
    }

    if (tx.type === "bid") {
      const listing = getListings().find(l => l.id === tx.listingId);
      // Jika listing masih aktif tapi bidder bukan kita → bid gagal, refund
      if (!listing || (listing.bidderId !== playerId)) {
        if (tx.amount > 0) {
          addPendingCoin(playerId, tx.amount);
          messages.push(`§e[Auction Recovery] Bid gagal, §f${tx.amount} Koin §edikembalikan.`);
        }
      }
    }
  } catch (e) {
    console.error("[Auction] recoverTx error:", e);
    messages.push("§c[Auction Recovery] Terjadi error saat recovery. Hubungi admin.");
  }

  clearTx(playerId);
  return messages;
}
