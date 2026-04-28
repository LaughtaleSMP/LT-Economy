// player_dp.js — Hybrid Player/World DP abstraction
// Menyimpan data per-player di Player DP (entity DP) alih-alih World DP.
// Setiap player punya alokasi DP sendiri, TERPISAH dari world DP 1MB.
// Ini secara efektif memberikan unlimited storage untuk data per-player.
//
// Fitur:
// - Auto-migrate: data lama di world DP otomatis pindah ke player DP saat login
// - Fallback-safe: kalau player DP gagal, tetap coba world DP
// - Zero-downtime: tidak perlu wipe data, migrasi gradual saat player login

import { world } from "@minecraft/server";

// ═══════════════════════════════════════════════════════════
// KONFIGURASI — Daftar key prefix yang akan di-migrate
// Format: world DP key = "prefix" + playerId
//         player DP key = "prefix" (tanpa playerId, karena sudah per-player)
// ═══════════════════════════════════════════════════════════
const MIGRATE_PREFIXES = [
  // Daily
  "daily:login:",
  "daily:quest:",
  "daily:weekly:",
  "daily:monthly:",
  "daily:stats:",
  // Combat (self-only data)
  "cs:",
  "ch:",
  "cho:",
  // Bank (self-only data)
  "bank:hist:",
  "bank:daily:",
  // MobuXP
  "xp:daily_coin:",
  // Welcome
  "welcome:seen:",
];

// ═══════════════════════════════════════════════════════════
// CORE API — read/write data per-player
// ═══════════════════════════════════════════════════════════

/**
 * Baca data per-player. Prioritas: Player DP → World DP (legacy).
 * @param {Player} player — player entity (harus online)
 * @param {string} prefix — key prefix (contoh: "daily:login:")
 * @param {*} def — default value
 * @returns {*} parsed data
 */
export function pGet(player, prefix, def) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  // 1. Coba Player DP dulu
  try {
    const raw = player.getDynamicProperty(pKey);
    if (raw !== undefined && raw !== null) {
      if (typeof raw === "string") return JSON.parse(raw) ?? def;
      return raw ?? def;
    }
  } catch {}

  // 2. Fallback ke World DP (data lama belum di-migrate)
  try {
    const wKey = prefix + player.id;
    const raw = world.getDynamicProperty(wKey);
    if (raw !== undefined && raw !== null) {
      if (typeof raw === "string") return JSON.parse(raw) ?? def;
      return raw ?? def;
    }
  } catch {}

  return def;
}

/**
 * Tulis data per-player ke Player DP.
 * @param {Player} player — player entity (harus online)
 * @param {string} prefix — key prefix (contoh: "daily:login:")
 * @param {*} value — data to store (will be JSON.stringify'd)
 */
export function pSet(player, prefix, value) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    player.setDynamicProperty(pKey, str);
  } catch (e) {
    // Fallback: tulis ke world DP kalau player DP gagal
    console.warn(`[PDP] pSet fallback to world DP for "${pKey}":`, e);
    try {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      world.setDynamicProperty(prefix + player.id, str);
    } catch (e2) {
      console.error(`[PDP] pSet FAILED both player and world DP for "${pKey}":`, e2);
    }
  }
}

/**
 * Hapus data per-player dari Player DP (dan World DP legacy).
 * @param {Player} player — player entity (harus online)
 * @param {string} prefix — key prefix
 */
export function pDel(player, prefix) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  try { player.setDynamicProperty(pKey, undefined); } catch {}
  // Juga hapus legacy world DP key
  try { world.setDynamicProperty(prefix + player.id, undefined); } catch {}
}

/**
 * Baca raw (tanpa JSON.parse) — untuk data non-JSON seperti angka/timestamp.
 */
export function pGetRaw(player, prefix) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  try {
    const raw = player.getDynamicProperty(pKey);
    if (raw !== undefined && raw !== null) return raw;
  } catch {}
  try {
    return world.getDynamicProperty(prefix + player.id) ?? undefined;
  } catch {}
  return undefined;
}

/**
 * Tulis raw (tanpa JSON.stringify) — untuk data non-JSON.
 */
export function pSetRaw(player, prefix, value) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  try {
    player.setDynamicProperty(pKey, value);
  } catch (e) {
    console.warn(`[PDP] pSetRaw fallback for "${pKey}":`, e);
    try { world.setDynamicProperty(prefix + player.id, value); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════
// MIGRASI — pindahkan data World DP → Player DP saat login
// Dipanggil sekali per player saat join.
// [PERF] Hanya iterate prefix yang diketahui, tidak scan semua keys.
// ═══════════════════════════════════════════════════════════

/**
 * Migrate semua data per-player dari world DP ke player DP.
 * Aman dipanggil berulang — skip key yang sudah dimigrate.
 * @param {Player} player
 * @returns {{ migrated: number, freed: number }} stats
 */
export function migratePlayer(player) {
  let migrated = 0;
  let freed = 0;

  for (const prefix of MIGRATE_PREFIXES) {
    const worldKey = prefix + player.id;
    const playerKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;

    try {
      const worldVal = world.getDynamicProperty(worldKey);
      if (worldVal === undefined || worldVal === null) continue;

      // Cek apakah player DP sudah punya data
      const playerVal = player.getDynamicProperty(playerKey);
      if (playerVal === undefined || playerVal === null) {
        // Belum ada di player DP → copy dari world DP
        player.setDynamicProperty(playerKey, worldVal);
        migrated++;
      }

      // Hapus dari world DP (baik sudah ada di player DP atau baru di-copy)
      world.setDynamicProperty(worldKey, undefined);
      freed++;
    } catch (e) {
      // Jangan crash jika 1 key gagal, lanjutkan yang lain
      console.warn(`[PDP] Migrate "${worldKey}" failed:`, e);
    }
  }


  if (migrated > 0) {
    console.log(`[PDP] Migrated ${migrated} keys, freed ${freed} world DP keys for ${player.name}`);
  }

  return { migrated, freed };
}

// ═══════════════════════════════════════════════════════════
// GACHA CHUNKED — versi player DP dari dpSetChunked/dpGetChunked
// ═══════════════════════════════════════════════════════════
const MAX_CHUNK_SCAN = 32;

/**
 * Write chunked data ke Player DP.
 * @param {Player} player
 * @param {string} prefix — key prefix (contoh: "pg_s:")
 * @param {*} value — data to store
 * @param {number} chunkSize — bytes per chunk
 */
export function pSetChunked(player, prefix, value, chunkSize = 2800) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  try {
    const str = JSON.stringify(value);
    const n = Math.max(1, Math.ceil(str.length / chunkSize));
    const oldN = player.getDynamicProperty(pKey + "_cn") ?? 0;
    for (let i = n; i < Math.min(oldN, n + MAX_CHUNK_SCAN); i++) {
      try { player.setDynamicProperty(pKey + "_c" + i, undefined); } catch {}
    }
    player.setDynamicProperty(pKey + "_cn", n);
    for (let i = 0; i < n; i++) {
      player.setDynamicProperty(pKey + "_c" + i, str.slice(i * chunkSize, (i + 1) * chunkSize));
    }
  } catch (e) {
    console.error("[PDP] pSetChunked failed:", pKey, e);
  }
}

/**
 * Read chunked data dari Player DP, fallback ke World DP.
 * @param {Player} player
 * @param {string} prefix — key prefix
 * @param {*} def — default value
 * @param {string} [playerId] — player ID (untuk world DP fallback)
 */
export function pGetChunked(player, prefix, def, playerId) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  // 1. Coba Player DP
  try {
    const n = player.getDynamicProperty(pKey + "_cn");
    if (n && n > 0) {
      let str = "";
      for (let i = 0; i < n; i++) str += (player.getDynamicProperty(pKey + "_c" + i) ?? "");
      return JSON.parse(str) ?? def;
    }
    const raw = player.getDynamicProperty(pKey);
    if (raw !== undefined && raw !== null) return JSON.parse(raw) ?? def;
  } catch {}

  // 2. Fallback ke World DP (legacy)
  const pid = playerId ?? player.id;
  const wKey = prefix + pid;
  try {
    const n = world.getDynamicProperty(wKey + "_cn");
    if (n && n > 0) {
      let str = "";
      for (let i = 0; i < n; i++) str += (world.getDynamicProperty(wKey + "_c" + i) ?? "");
      return JSON.parse(str) ?? def;
    }
    const raw = world.getDynamicProperty(wKey);
    if (raw !== undefined && raw !== null) return JSON.parse(raw) ?? def;
  } catch {}

  return def;
}

/**
 * Delete chunked data dari Player DP dan World DP.
 */
export function pDelChunked(player, prefix) {
  const pKey = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  try {
    const n = player.getDynamicProperty(pKey + "_cn") ?? 0;
    player.setDynamicProperty(pKey + "_cn", undefined);
    for (let i = 0; i < n + MAX_CHUNK_SCAN; i++) {
      try { player.setDynamicProperty(pKey + "_c" + i, undefined); } catch {}
    }
    try { player.setDynamicProperty(pKey, undefined); } catch {}
  } catch {}

  // Juga hapus legacy world DP
  const wKey = prefix + player.id;
  try {
    const n = world.getDynamicProperty(wKey + "_cn") ?? 0;
    world.setDynamicProperty(wKey + "_cn", undefined);
    for (let i = 0; i < n + MAX_CHUNK_SCAN; i++) {
      try { world.setDynamicProperty(wKey + "_c" + i, undefined); } catch {}
    }
    try { world.setDynamicProperty(wKey, undefined); } catch {}
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// UTILITY — Get player by ID (untuk module yang perlu resolve)
// ═══════════════════════════════════════════════════════════
export function getOnlinePlayer(playerId) {
  return world.getPlayers().find(p => p.id === playerId) ?? null;
}

export { MIGRATE_PREFIXES };
