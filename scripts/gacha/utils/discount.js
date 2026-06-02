import { CFG } from "../config.js";
import { dpGet, dpSet } from "./storage.js";

export const getDiscCodes  = ()    => dpGet(CFG.K_DISC, {});
export const saveDiscCodes = (map) => dpSet(CFG.K_DISC, map);
export const getUsedCodes  = pid  => dpGet(CFG.K_USED_DISC + pid, []);
export const hasUsedCode   = (pid, code) => getUsedCodes(pid).includes(String(code).toUpperCase());

export function markCodeUsed(pid, code) {
  const used = getUsedCodes(pid), key = String(code).toUpperCase();
  if (!used.includes(key)) { used.push(key); dpSet(CFG.K_USED_DISC + pid, used); }
}

/** Sanitize entry — pastikan field number valid agar arithmetic tidak NaN. */
function _sanitizeEntry(e) {
  if (!e || typeof e !== "object") return null;
  const uses = Number(e.uses);
  if (!Number.isFinite(uses) || uses <= 0) return null;
  const pct = Number(e.pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  const type = (e.type === "ALL" || e.type === "PT" || e.type === "EQ") ? e.type : "ALL";
  return { pct, type, uses: Math.floor(uses) };
}

export function validateDisc(code, gachaType, playerId) {
  if (!code) return null;
  const map = getDiscCodes();
  const key = String(code).toUpperCase();
  const e = _sanitizeEntry(map[key]);
  if (!e) return null;
  if (e.type !== "ALL" && e.type !== (gachaType === "PARTICLE" ? "PT" : "EQ")) return null;
  if (hasUsedCode(playerId, code)) return null;
  return e;
}

export function consumeDisc(code, playerId) {
  if (!code) return;
  markCodeUsed(playerId, code);
  const map = getDiscCodes();
  const key = String(code).toUpperCase();
  const e = _sanitizeEntry(map[key]);
  if (!e) return;
  e.uses--;
  if (e.uses <= 0) delete map[key];
  else map[key] = e;
  saveDiscCodes(map);
}

/**
 * [FIX M-1] Atomic validate + consume dalam SATU operasi.
 * Mencegah TOCTOU: dua player dengan kode uses=1 tidak bisa keduanya dapat diskon.
 *
 * Karena Minecraft Script API single-threaded, urutan read→write
 * dalam fungsi sync ini benar-benar atomic (tidak ada interleaving).
 *
 * Trade-off: jika player cancel setelah apply kode, uses berkurang.
 * Mitigasi: refundDisc() dipanggil di playerLeave & catch block.
 */
export function validateAndConsumeDisc(code, gachaType, playerId) {
  if (!code || !playerId) return null;
  const map = getDiscCodes();
  const key = String(code).toUpperCase();
  const sanitized = _sanitizeEntry(map[key]);
  if (!sanitized) return null;
  if (sanitized.type !== "ALL" && sanitized.type !== (gachaType === "PARTICLE" ? "PT" : "EQ")) return null;
  if (hasUsedCode(playerId, code)) return null;

  // ── Atomic write block ──
  const result = { pct: sanitized.pct, type: sanitized.type, uses: sanitized.uses };
  markCodeUsed(playerId, code);
  sanitized.uses--;
  if (sanitized.uses <= 0) delete map[key];
  else map[key] = sanitized;
  saveDiscCodes(map);
  return result;
}

/**
 * [FIX BUG-1] Refund kode diskon jika gacha session gagal (timeout, error, dll).
 * Mengembalikan uses dan menghapus dari daftar "sudah pakai" player.
 *
 * @param {object} originalEntry - { pct, type } untuk recreate jika kode sudah dihapus
 *                                 (player consumed last use, bukan admin delete)
 * @param {boolean} [allowRecreate=true] - jika false, tidak recreate kode yang sudah dihapus
 *                                          (pakai false untuk admin-deleted scenario)
 */
export function refundDisc(code, playerId, originalEntry, allowRecreate = true) {
  if (!code || !playerId) return;
  const key = String(code).toUpperCase();

  // 1. Hapus dari daftar used milik player (idempotent)
  const used = getUsedCodes(playerId);
  const idx  = used.indexOf(key);
  if (idx !== -1) {
    used.splice(idx, 1);
    dpSet(CFG.K_USED_DISC + playerId, used);
  }

  // 2. Kembalikan uses di map kode
  const map = getDiscCodes();
  const existing = map[key];
  if (existing && _sanitizeEntry(existing)) {
    // Kode masih ada (uses belum habis). Increment safely.
    const cur = _sanitizeEntry(existing);
    cur.uses++;
    map[key] = cur;
  } else if (allowRecreate && originalEntry) {
    // Kode sudah dihapus (uses habis di consume terakhir). Recreate dengan uses=1.
    // [GUARD] Validasi originalEntry agar tidak corrupt data.
    const pct = Number(originalEntry.pct);
    const type = (originalEntry.type === "ALL" || originalEntry.type === "PT" || originalEntry.type === "EQ")
      ? originalEntry.type : "ALL";
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
      map[key] = { pct, type, uses: 1 };
    }
    // else: silent skip — data corrupt, jangan recreate
  }
  // else: admin sudah delete kode → tidak recreate (allowRecreate=false)
  saveDiscCodes(map);
}
