// ============================================================
// welfare/stagflation.js — Stagflation Detector & Auto-Stimulus
//
// DETEKSI:
//   Stagflation = inflasi tinggi + "unemployment" tinggi
//
//   INFLATION: coin supply growth >5% per minggu
//   UNEMPLOYMENT: >40% player login dalam 7 hari tapi <3 transaksi
//
//   Kalau KEDUA kondisi true → trigger Stimulus Week (7 hari):
//     - Quest reward +100% (double)
//     - Kill mob subsidy +2 (dari 1)
//     - UBI amount +50 (150 total untuk player <7d)
//
// PERFORMA:
//   - Check interval: 6000 ticks (5 menit) — piggyback leaderboard sync
//   - Zero in-memory state accumulation (computed from world DP)
//   - DP reads: 2 per check (eco:pricing, stag state)
//   - DP writes: 0 per normal check, 1 saat transition state (rare)
//   - Works even if offline for 2+ weeks (period-based math)
//
// DP KEYS:
//   "stag:state" — {active, startMs, expireMs, stats: {infPct, unempPct}}
//
// ============================================================

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { trackFlow } from "../eco_flow.js";

const K_STATE = "stag:state";
const ADMIN_TAG = "mimi";

const CFG = Object.freeze({
  INFLATION_THRESHOLD_PCT:   5.0,   // >5% supply growth/week
  UNEMPLOYMENT_THRESHOLD_PCT: 40,   // >40% players idle
  MIN_PLAYERS:                10,   // don't trigger if server < 10 players
  STIMULUS_DURATION_MS:  7 * 86_400_000, // 7 days
  COOLDOWN_MS:          14 * 86_400_000, // can re-trigger after 14 days
  CHECK_INTERVAL_TICKS:   6_000,         // 5 minutes
  QUEST_MULT_BOOST:        1.0,   // +100% quest reward (double)
  KILL_SUB_BOOST:          2,     // +2 extra coin/kill (on top of 1 existing)
  UBI_BOOST:              50,     // +50 coin/day for new players
});

// ── In-memory cache for fast reads ──────────────────────────
let _stateCache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 30_000; // 30s — fast enough for actionbar display

function _readState() {
  const now = Date.now();
  if (_stateCache && (now - _cacheTs) < CACHE_TTL_MS) return _stateCache;
  try {
    const raw = world.getDynamicProperty(K_STATE);
    _stateCache = (typeof raw === "string" && raw.length > 0) ? JSON.parse(raw) : null;
  } catch { _stateCache = null; }
  _cacheTs = now;
  return _stateCache;
}

function _writeState(state) {
  try {
    if (state === null || state === undefined) {
      world.setDynamicProperty(K_STATE, undefined);
    } else {
      world.setDynamicProperty(K_STATE, JSON.stringify(state));
    }
    _stateCache = state;
    _cacheTs = Date.now();
  } catch (e) { console.warn("[Stagflation] write error:", e); }
}

/**
 * Public API: Check if stimulus currently active.
 * Returns {active, expireMs, daysLeft, stats} or null.
 */
export function getStimulusState() {
  const s = _readState();
  if (!s || !s.active) return null;
  const now = Date.now();
  if (now >= s.expireMs) return null; // expired but not yet cleaned
  return {
    active: true,
    startMs: s.startMs,
    expireMs: s.expireMs,
    daysLeft: Math.max(0, Math.ceil((s.expireMs - now) / 86_400_000)),
    stats: s.stats || {},
  };
}

/** Get quest reward multiplier (1.0 = normal, 2.0 = stimulus). */
export function getQuestRewardMult() {
  const s = getStimulusState();
  return s ? (1 + CFG.QUEST_MULT_BOOST) : 1;
}

/** Get extra kill subsidy (on top of normal treasury subsidy). */
export function getKillSubsidyBoost() {
  return getStimulusState() ? CFG.KILL_SUB_BOOST : 0;
}

/** Get UBI boost amount for new players. */
export function getUbiBoost() {
  return getStimulusState() ? CFG.UBI_BOOST : 0;
}

/**
 * Detection logic — analyzes current economy metrics.
 * Returns {triggered, reason, stats} or null if no action.
 *
 * @param {object} metrics - {supplyGrowthPct, unemploymentPct, playerCount}
 */
function _analyze(metrics) {
  if (!metrics || typeof metrics !== "object") return null;
  const supplyGrowthPct = Number.isFinite(metrics.supplyGrowthPct) ? metrics.supplyGrowthPct : 0;
  const unemploymentPct = Number.isFinite(metrics.unemploymentPct) ? metrics.unemploymentPct : 0;
  const playerCount = Number.isFinite(metrics.playerCount) ? metrics.playerCount : 0;
  if (playerCount < CFG.MIN_PLAYERS) return null;

  const highInf = supplyGrowthPct > CFG.INFLATION_THRESHOLD_PCT;
  const highUnemp = unemploymentPct > CFG.UNEMPLOYMENT_THRESHOLD_PCT;

  if (highInf && highUnemp) {
    return {
      triggered: true,
      reason: `Stagflation: inflasi ${supplyGrowthPct.toFixed(1)}%/minggu, pengangguran ${unemploymentPct.toFixed(0)}%`,
      stats: { infPct: supplyGrowthPct, unempPct: unemploymentPct, pn: playerCount },
    };
  }
  return null;
}

/**
 * Try to trigger stimulus. Respects cooldown (can't re-trigger within 14 days).
 * Returns true if triggered, false if in cooldown or no stagflation.
 *
 * @param {object} metrics
 */
export function tryTriggerStimulus(metrics) {
  const now = Date.now();
  const s = _readState();

  if (s && s.active && now < s.expireMs) return false;
  if (s && s.lastEndMs && (now - s.lastEndMs) < CFG.COOLDOWN_MS) return false;

  const analysis = _analyze(metrics);
  if (!analysis) return false;

  const newState = {
    active: true,
    startMs: now,
    expireMs: now + CFG.STIMULUS_DURATION_MS,
    lastEndMs: s?.lastEndMs || 0,
    stats: analysis.stats,
    reason: analysis.reason,
  };
  _writeState(newState);

  try {
    world.sendMessage(
      "\n§8═══════════════════\n" +
      "§6§lECONOMIC STIMULUS §r§6WEEK §7aktif\n" +
      "§8───────────────────\n" +
      `§7${analysis.reason}\n\n` +
      "§aBonus selama 7 hari:\n" +
      "§7  • Quest reward §f×2\n" +
      "§7  • Kill mob bonus §f+2 koin\n" +
      "§7  • UBI player baru §f+50 koin\n" +
      "§8═══════════════════\n"
    );
  } catch {}
  trackFlow("stimulus_triggered", 1);
  return true;
}

/**
 * Check and clean up expired stimulus. Called periodically.
 */
function _tickCleanup() {
  const s = _readState();
  if (!s || !s.active) return;
  const now = Date.now();
  if (now < s.expireMs) return;

  // Expired — transition to inactive, record lastEndMs
  _writeState({
    active: false,
    lastEndMs: s.expireMs,
    stats: s.stats,
  });
  try {
    world.sendMessage(
      "§8═══════════════════\n" +
      "§6Economic Stimulus berakhir. §7Reward kembali normal.\n" +
      "§8═══════════════════"
    );
  } catch {}
}

// ── Background cleanup — check every 5 menit ────────────────
// Low CPU: 1 DP read per check (via cache), 0 writes unless expired
system.runInterval(() => {
  try { _tickCleanup(); } catch {}
}, CFG.CHECK_INTERVAL_TICKS);

// ── Admin command ──────────────────────────────────────────
system.beforeEvents.startup.subscribe((init) => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:stagflation",
        description: "Lihat status stimulus ekonomi",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        const s = getStimulusState();
        if (!s) {
          system.run(() => {
            try {
              player.sendMessage(
                "\n§b● Status Ekonomi\n" +
                "§7  Normal — tidak ada stimulus aktif."
              );
            } catch {}
          });
        } else {
          system.run(() => {
            try {
              const stats = s.stats || {};
              player.sendMessage(
                "\n§6● Economic Stimulus aktif\n" +
                `§7  Sisa: §f${s.daysLeft} hari\n` +
                `§7  Inflasi: §f${(stats.infPct || 0).toFixed(1)}%%/minggu\n` +
                `§7  Pengangguran: §f${(stats.unempPct || 0).toFixed(0)}%%\n` +
                "§7  Bonus: §aquest ×2, kill +2, UBI +50"
              );
            } catch {}
          });
        }
        return { status: 0 };
      }
    );

    // Admin: paksa trigger (debug)
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:stimulus_force",
        description: "Admin: force trigger stimulus (debug)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) {
          system.run(() => { try { player.sendMessage("§8[§cStimulus§8]§c Akses ditolak."); } catch {} });
          return { status: 0 };
        }
        const now = Date.now();
        _writeState({
          active: true,
          startMs: now,
          expireMs: now + CFG.STIMULUS_DURATION_MS,
          stats: { infPct: 6.0, unempPct: 50, pn: 20 },
          reason: "Manual trigger by admin",
        });
        system.run(() => {
          try {
            player.sendMessage("§8[§aStimulus§8]§a Forced active selama 7 hari.");
            world.sendMessage(
              "\n§6§lECONOMIC STIMULUS §r§6aktif §7(diaktifkan admin)\n" +
              "§7Bonus: quest ×2, kill +2, UBI +50 selama 7 hari.\n"
            );
          } catch {}
        });
        return { status: 0 };
      }
    );

    init.customCommandRegistry.registerCommand(
      {
        name: "lt:stimulus_clear",
        description: "Admin: clear stimulus state",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) {
          system.run(() => { try { player.sendMessage("§8[§cStimulus§8]§c Akses ditolak."); } catch {} });
          return { status: 0 };
        }
        _writeState(null);
        system.run(() => { try { player.sendMessage("§8[§aStimulus§8]§a State dibersihkan."); } catch {} });
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[Stagflation] command reg failed:", e); }
});

export const STAGFLATION_CFG = CFG;
