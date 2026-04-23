// monitor/tps_tracker.js — TPS Tracker v2.0
// Fixed bar gradient direction (green=full, red=low)

import { system } from "@minecraft/server";

const SAMPLE_TICKS = 20;
const HISTORY_SIZE = 30;

let _lastTime = Date.now();
let _tps = 20.0;
let _minTps = 20.0;
let _maxTps = 20.0;
const _history = [];
let _startTime = Date.now();

system.runInterval(() => {
  const now = Date.now();
  const elapsed = now - _lastTime;
  _lastTime = now;
  if (elapsed > 0) {
    _tps = Math.min(20, (SAMPLE_TICKS / elapsed) * 1000);
    _tps = Math.round(_tps * 10) / 10;
  }
  if (_tps < _minTps) _minTps = _tps;
  if (_tps > _maxTps) _maxTps = _tps;
  _history.push(_tps);
  if (_history.length > HISTORY_SIZE) _history.shift();
}, SAMPLE_TICKS);

export function getTPS() { return _tps; }
export function getTPSMin() { return _minTps; }
export function getTPSMax() { return _maxTps; }
export function getTPSHistory() { return [..._history]; }

/**
 * Rata-rata N sampel terakhir (tiap ~1s). Dipakai Auto-throttle supaya
 * spike singkat tidak langsung memicu level / clean.
 * @param {number} n jumlah entri (default 6 ≈ 6 detik)
 */
export function getTPSAverageLast(n = 6) {
  const count = Math.max(1, Math.floor(n));
  if (_history.length === 0) return _tps;
  const slice = _history.slice(-Math.min(count, _history.length));
  let sum = 0;
  for (let i = 0; i < slice.length; i++) sum += slice[i];
  return Math.round((sum / slice.length) * 10) / 10;
}
export function resetTPSStats() { _minTps = 20.0; _maxTps = 20.0; }

export function getUptime() {
  const ms = Date.now() - _startTime;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function getTPSColor(tps) {
  if (tps >= 18) return "§a";
  if (tps >= 15) return "§e";
  if (tps >= 10) return "§6";
  return "§c";
}

/**
 * Build visual TPS bar — gradient: green (high) → yellow → red (low)
 * [FIX] Previous version had inverted colors (red=filled, green=empty)
 */
export function buildTPSBar(tps) {
  const filled = Math.round(Math.max(0, Math.min(1, tps / 20)) * 10);
  let bar = "";
  for (let i = 0; i < 10; i++) {
    if (i < filled) {
      // Filled portion — color based on overall TPS health
      if (tps >= 18)      bar += "§a";  // green — healthy
      else if (tps >= 15) bar += "§e";  // yellow — warning
      else if (tps >= 10) bar += "§6";  // orange — danger
      else                bar += "§c";  // red — critical
      bar += "█";
    } else {
      bar += "§8░";
    }
  }
  return bar;
}
