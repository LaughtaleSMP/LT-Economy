// sync_recovery.js — Web recovery queue poller
// Polls recovery_queue for pending imports from admin panel.
// SLO: poll success >= 95% / 24h. Apply latency <= 60s p95.

import { world } from "@minecraft/server";
import { HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { SUPABASE_URL, SUPABASE_KEY, isOfflineMode, isCircuitOpen, httpWithTimeout } from "./sync_http.js";
import { parseImportString, applyImport, applyImportOffline } from "../gacha/utils/export.js";
import { dpGetChunked } from "./sync_dp.js";

const RECOVERY_EP = `${SUPABASE_URL}/rest/v1/recovery_queue`;
const _doneIds = new Set();
let _polling = false;
let _pollStartMs = 0;

const STUCK_MS = 60_000;
const DONE_CAP = 50;

export async function pollRecoveryQueue() {
  if (isOfflineMode() || isCircuitOpen()) return;

  if (_polling && Date.now() - _pollStartMs > STUCK_MS) {
    console.warn("[Recovery-Poll] Stuck guard, force reset");
    _polling = false;
  }
  if (_polling) return;
  _polling = true;
  _pollStartMs = Date.now();

  try {
    const rows = await _fetchPending();
    if (!rows || rows.length === 0) return;
    for (const row of rows) await _processRecovery(row);

    if (_doneIds.size > DONE_CAP) {
      const a = [..._doneIds];
      _doneIds.clear();
      a.slice(-Math.floor(DONE_CAP / 2)).forEach(id => _doneIds.add(id));
    }
  } catch (e) {
    if (!e?.circuitOpen) console.warn("[Recovery-Poll] Error:", e);
  } finally {
    _polling = false;
  }
}

async function _fetchPending() {
  const req = new HttpRequest(`${RECOVERY_EP}?status=eq.pending&order=created_at.asc&limit=10`);
  req.method = HttpRequestMethod.Get;
  req.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
  ];
  const res = await httpWithTimeout(req);
  if (res.status < 200 || res.status >= 300) return null;
  return JSON.parse(res.body || "[]");
}

async function _processRecovery(row) {
  const { id, player_name, import_string } = row;
  if (!player_name || !import_string) {
    await _markRecovery(id, "failed", "Missing data");
    return;
  }
  if (_doneIds.has(id)) {
    await _markRecovery(id, "done", "OK (re-mark)");
    return;
  }

  const parsed = parseImportString(import_string);
  if (!parsed.ok) {
    _doneIds.add(id);
    await _markRecovery(id, "failed", `Parse error: ${parsed.err}`);
    console.warn(`[Recovery] Parse failed for ${player_name}: ${parsed.err}`);
    return;
  }

  const safeName = player_name.replace(/["\\\\\\n]/g, "");
  if (await _tryApplyOnline(id, safeName, parsed)) return;
  await _tryApplyOffline(id, safeName, parsed);
}

async function _tryApplyOnline(id, safeName, parsed) {
  try {
    for (const p of world.getPlayers()) {
      if (p.name !== safeName) continue;
      applyImport(p, parsed);
      _doneIds.add(id);
      await _markRecovery(id, "done", `Restored to ${safeName} (online)`);
      try {
        p.sendMessage(`§a[Recovery] §fData berhasil di-restore oleh Admin.`);
        p.playSound("random.levelup", { pitch: 1.3, volume: 1.0 });
      } catch {}
      return true;
    }
  } catch (e) {
    console.warn(`[Recovery] Online apply error for ${safeName}:`, e);
  }
  return false;
}

async function _tryApplyOffline(id, safeName, parsed) {
  try {
    const reg = dpGetChunked("p_reg", {});
    let pid = null;
    for (const [regId, info] of Object.entries(reg)) {
      if (info.name === safeName) { pid = regId; break; }
    }
    if (!pid) {
      _doneIds.add(id);
      await _markRecovery(id, "failed", `Player "${safeName}" not in registry`);
      console.warn(`[Recovery] Player not found: ${safeName}`);
      return;
    }
    applyImportOffline(pid, parsed);
    _doneIds.add(id);
    await _markRecovery(id, "done", `Queued for ${safeName} (offline, apply on login)`);
  } catch (e) {
    _doneIds.add(id);
    await _markRecovery(id, "failed", `Error: ${e?.message || e}`);
    console.warn(`[Recovery] FAIL ${safeName}:`, e);
  }
}

async function _markRecovery(id, status, msg) {
  try {
    const req = new HttpRequest(`${RECOVERY_EP}?id=eq.${id}`);
    req.method = HttpRequestMethod.Patch;
    req.body = JSON.stringify({
      status,
      processed_at: new Date().toISOString(),
      result_msg: msg,
    });
    req.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Content-Type", "application/json"),
      new HttpHeader("Prefer", "return=minimal"),
    ];
    await httpWithTimeout(req);
  } catch (e) {
    if (!e?.circuitOpen) console.warn("[Recovery] Mark error:", e);
  }
}
