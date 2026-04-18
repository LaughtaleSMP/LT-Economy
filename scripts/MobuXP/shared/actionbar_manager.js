// ============================================================
// shared/actionbar_manager.js
// Centralized actionbar manager dengan sistem prioritas.
// Import oleh xp_manager.js dan mob_cleaner.js.
//
// Priority:
//   10 = mob cleaner countdown (tertinggi — selalu tampil)
//    5 = kill notification XP (default)
// ============================================================

import { world, system } from "@minecraft/server";

// name -> { msg, priority, expireTick }
const _bars = new Map();

// Interval 4 tick (~5 update/detik) — hemat TPS vs 2 tick sebelumnya,
// masih cukup smooth untuk actionbar experience.
// Build Map<name, Player> sekali per tick → O(n+m) bukan O(n*m).
system.runInterval(() => {
  if (_bars.size === 0) return;

  const now = system.currentTick;

  const playerMap = new Map();
  for (const p of world.getPlayers()) playerMap.set(p.name, p);

  for (const [name, data] of _bars) {
    if (now > data.expireTick) {
      _bars.delete(name);
      continue;
    }
    try {
      const player = playerMap.get(name);
      if (!player) { _bars.delete(name); continue; }
      player.onScreenDisplay.setActionBar(data.msg);
    } catch { /* player invalid / offline */ }
  }
}, 4); // ← naik dari 2 ke 4: hemat ~50% call overhead interval ini

/**
 * Set actionbar untuk satu player.
 * Hanya override jika priority baru >= priority aktif.
 *
 * @param {import("@minecraft/server").Player | string} player
 * @param {string}  msg
 * @param {number}  priority  — lebih tinggi = lebih diutamakan
 * @param {number}  ticks     — durasi tampil dalam game-tick
 */
export function setBar(player, msg, priority = 5, ticks = 60) {
  const name = typeof player === "string" ? player : player.name;
  const cur  = _bars.get(name);

  if (cur && cur.priority > priority && system.currentTick < cur.expireTick) return;

  _bars.set(name, { msg, priority, expireTick: system.currentTick + ticks });
}

/**
 * Set actionbar ke semua player online (untuk countdown mob cleaner).
 */
export function setBarAll(msg, priority = 10, ticks = 40) {
  for (const p of world.getPlayers()) {
    setBar(p.name, msg, priority, ticks);
  }
}

/**
 * Hapus actionbar aktif untuk player (misal saat disconnect).
 */
export function clearBar(player) {
  const name = typeof player === "string" ? player : player.name;
  _bars.delete(name);
}

console.log("[ActionBar Manager] Aktif.");