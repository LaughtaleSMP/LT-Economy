/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_http.js — Supabase constants + HTTP helpers

   SLO: HTTP request timeout enforced at 15s p99 (or caller override).
        Circuit breaker trips after CB_FAIL_THRESHOLD consecutive
        failures, pauses CB_COOLDOWN_MS before allowing retry.

   Bedrock http.request has no native timeout — wrapped via Promise.race.
   ══════════════════════════════════════════════════════════════ */

import { system } from "@minecraft/server";
import { http } from "@minecraft/server-net";

export const SUPABASE_URL = "https://jlxtnbnrirxhwuyqjlzw.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpseHRuYm5yaXJ4aHd1eXFqbHp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjYzOTAsImV4cCI6MjA5MTQ0MjM5MH0.MRhoVRDju41J8nWp4WTgiKOvxy7AgwGYH-el2zVsbWI";
export const ENDPOINT = `${SUPABASE_URL}/rest/v1/leaderboard_sync`;

// OFFLINE_MODE: true = test (no Supabase calls), false = production.
export const OFFLINE_MODE = true;
if (OFFLINE_MODE) console.warn("[Economy] OFFLINE_MODE = true — Supabase sync disabled");
export function isOfflineMode() { return OFFLINE_MODE; }

// Default 15s — enough for slow mobile networks, short enough to avoid
// stacking up requests during outage.
export const HTTP_TIMEOUT_TICKS = 300;

// Circuit breaker: trip on N consecutive failures, pause for cooldown.
// Prevents thundering herd when Supabase is degraded.
const CB_FAIL_THRESHOLD = 3;
const CB_COOLDOWN_MS = 5 * 60_000; // 5 min — matches full-sync cadence

let _cbFailures = 0;
let _cbOpenedAt = 0;

function _isCircuitOpen() {
  if (_cbFailures < CB_FAIL_THRESHOLD) return false;
  if (Date.now() - _cbOpenedAt < CB_COOLDOWN_MS) return true;
  // Cooldown elapsed — half-open: allow next call, reset on success.
  return false;
}

function _onSuccess() {
  if (_cbFailures > 0) console.warn(`[HTTP] circuit recovered after ${_cbFailures} fail(s)`);
  _cbFailures = 0;
}

function _onFailure() {
  _cbFailures++;
  if (_cbFailures === CB_FAIL_THRESHOLD) {
    _cbOpenedAt = Date.now();
    console.warn(`[HTTP] circuit OPEN after ${_cbFailures} consecutive failures — pausing ${CB_COOLDOWN_MS / 60_000}min`);
  }
}

/** Tagged error so callers can filter circuit-open noise from real failures. */
function _circuitOpenError() {
  const e = new Error("Circuit open");
  e.circuitOpen = true;
  return e;
}

/**
 * HTTP request with timeout + circuit breaker.
 * Rejects with `Error{circuitOpen:true}` if breaker tripped — callers should
 * treat as expected during outage and skip logging at WARN level.
 *
 * [SRE §7.2] Single-promise pattern with `settled` flag + clearRun() ensures
 * each request increments the failure counter exactly once. Previous Promise.race
 * implementation leaked late timer callbacks → spurious _onFailure() calls
 * after success, producing false "circuit recovered after N fail(s)" logs.
 */
export function httpWithTimeout(req, timeoutTicks = HTTP_TIMEOUT_TICKS) {
  if (_isCircuitOpen()) {
    return Promise.reject(_circuitOpenError());
  }

  // Jitter: ±25% of timeout to spread retry storms.
  const jitter = (Math.random() - 0.5) * 0.5 * timeoutTicks;
  const effective = Math.max(20, Math.round(timeoutTicks + jitter));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timerId = -1;

    timerId = system.runTimeout(() => {
      if (settled) return;
      settled = true;
      _onFailure();
      reject(new Error("HTTP timeout"));
    }, effective);

    http.request(req).then(
      res => {
        if (settled) return;
        settled = true;
        try { system.clearRun(timerId); } catch { }
        _onSuccess();
        resolve(res);
      },
      err => {
        if (settled) return;
        settled = true;
        try { system.clearRun(timerId); } catch { }
        _onFailure();
        reject(err);
      }
    );
  });
}

/** True if a request would short-circuit immediately. Cheap — use to skip work. */
export function isCircuitOpen() { return _isCircuitOpen(); }

/** Diagnostic — exposed for /lt:* admin commands or health check. */
export function getCircuitState() {
  return {
    failures: _cbFailures,
    open: _isCircuitOpen(),
    cooldownMsLeft: _isCircuitOpen() ? Math.max(0, CB_COOLDOWN_MS - (Date.now() - _cbOpenedAt)) : 0,
  };
}
