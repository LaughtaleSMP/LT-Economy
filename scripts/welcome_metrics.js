// welcome_metrics.js — Counter sederhana untuk track adopsi welcome panel
//
// Tujuan: ukur impact deploy fitur gem panel & welcome update v2.
// Tanpa metric, deploy = guessing.
//
// Iron rule compliance:
// - Batched accumulator (in-memory) → flush ke 1 DP key tiap 30 detik
// - Single DP key, JSON object — total ≤200 bytes (under budget 1MB / pack)
// - Tidak ada per-tick / per-event setDynamicProperty
//
// Counters (key = nama event):
//   guide_open       → /lt:guide dipanggil atau auto-open dari welcome
//   gem_panel_open   → tombol "Gem Premium" di-klik
//   welcome_first    → player baru lihat welcome (mode="first")
//   welcome_update   → player lama dapat re-trigger (mode="update")
//   nudge_shown      → daily tip muncul di header Bank/Store
//
// Read via /lt:baseline atau langsung world.getDynamicProperty("welcome:metrics").

import { world, system } from "@minecraft/server";

const DP_KEY = "welcome:metrics";
const FLUSH_INTERVAL_TICKS = 600; // 30 detik (20 tps × 30)

// ── In-memory accumulator ──
const _mem = new Map();
let _dirty = false;

/**
 * Increment counter untuk event tertentu.
 * O(1) — tidak menulis DP per call. Aman dipanggil dari hot path.
 *
 * @param {string} event — nama event (guide_open, gem_panel_open, dll)
 * @param {number} [n=1] — increment value
 */
export function bumpMetric(event, n = 1) {
  if (!event || typeof event !== "string") return;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return;
  _mem.set(event, (_mem.get(event) || 0) + n);
  _dirty = true;
}

function _flush() {
  if (!_dirty) return;
  // Snapshot in-memory ke local & clear segera. Kalau write gagal di bawah,
  // kembalikan snapshot ke _mem (rollback) supaya counter tidak hilang.
  // [SRE §7.2] Pattern: optimistic clear + rollback on failure. Ini mencegah
  // race kalau bumpMetric() dipanggil di tengah-tengah flush.
  const snapshot = new Map(_mem);
  _mem.clear();
  _dirty = _mem.size > 0;

  try {
    let persisted = {};
    try {
      const raw = world.getDynamicProperty(DP_KEY);
      if (raw) persisted = JSON.parse(raw) || {};
    } catch { persisted = {}; }

    for (const [k, v] of snapshot) {
      persisted[k] = (persisted[k] || 0) + v;
    }

    // Cap key count untuk safety (tidak kena DP overflow accidental).
    const keys = Object.keys(persisted);
    if (keys.length > 32) {
      // Prune key dengan value paling kecil (event yang nyaris tidak terpakai).
      keys.sort((a, b) => persisted[a] - persisted[b]);
      for (let i = 0; i < keys.length - 32; i++) delete persisted[keys[i]];
    }

    world.setDynamicProperty(DP_KEY, JSON.stringify(persisted));
  } catch (e) {
    console.warn("[Welcome-Metrics] flush error — rolling back snapshot:", e);
    // Rollback: merge snapshot kembali ke _mem supaya retry flush berikutnya.
    for (const [k, v] of snapshot) {
      _mem.set(k, (_mem.get(k) || 0) + v);
    }
    _dirty = true;
  }
}

/** Snapshot read — mostly untuk admin command / baseline. */
export function readMetrics() {
  try {
    const raw = world.getDynamicProperty(DP_KEY);
    const persisted = raw ? (JSON.parse(raw) || {}) : {};
    // Merge unflushed in-memory data juga.
    const out = { ...persisted };
    for (const [k, v] of _mem) out[k] = (out[k] || 0) + v;
    return out;
  } catch { return {}; }
}

system.runInterval(() => {
  try { _flush(); } catch {}
}, FLUSH_INTERVAL_TICKS);
