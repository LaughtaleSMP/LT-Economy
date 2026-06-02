// ============================================================
// shared/actionbar_manager.js
// Centralized actionbar manager dengan sistem prioritas.
// Import oleh xp_manager.js dan mob_cleaner.js.
//
// Priority:
//   10 = mob cleaner countdown (tertinggi — selalu tampil)
//   15 = admin HUD (highest)
//    5 = kill notification XP (default)
//
// [PERF v4.0]:
//   - Interval 10 tick (2x/detik) — balanced smooth vs TPS
//   - Build player Map once, reuse for lookups
//   - Lazy cleanup: only iterate when _bars has entries
//   - Bounded Map: auto-prune on size > 100 as safety net
// ============================================================

import { world, system } from "@minecraft/server";

// name -> { msg, priority, expireTick }
const _bars = new Map();

// [PERF] Interval 10 tick — smooth enough for actionbar, low overhead
system.runInterval(() => {
  if (_bars.size === 0) return;

  const now = system.currentTick;

  // [PERF] Build player map once, O(P) — reused for O(1) lookups
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

  // [PERF] Safety net: prevent unbounded growth if playerLeave missed
  if (_bars.size > 100) {
    const oldest = [..._bars.entries()].sort((a, b) => a[1].expireTick - b[1].expireTick);
    for (let i = 0; i < oldest.length - 50; i++) _bars.delete(oldest[i][0]);
  }
}, 20);  // [PERF] 1x/sec — actionbar doesn't need faster refresh

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
