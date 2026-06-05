// sync_world_guard.js — New-world detection & auto-recovery
// Prevents empty world data from overwriting existing backups.
// On world transition: auto-queue recovery for all backed-up players.
// SLO: detection latency <= 1 sync cycle (5min). False positive rate < 0.1%.

import { world } from "@minecraft/server";
import { HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { SUPABASE_URL, SUPABASE_KEY, isOfflineMode, isCircuitOpen, httpWithTimeout } from "./sync_http.js";

const WORLD_ID_KEY = "lt:world_id";
const RECOVERY_EP = `${SUPABASE_URL}/rest/v1/recovery_queue`;

let _worldId = null;
let _checkedOnce = false;
let _isNewWorld = false;
let _backupSafe = false;
let _lastFingerprint = null;
let _lastBackupTs = Date.now();

export function getWorldId() {
  if (_worldId) return _worldId;
  try {
    _worldId = world.getDynamicProperty(WORLD_ID_KEY);
  } catch {}
  if (!_worldId) {
    _worldId = "w_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try { world.setDynamicProperty(WORLD_ID_KEY, _worldId); } catch {}
  }
  return _worldId;
}

// Call once on first sync — compares local world_id with Supabase's stored world_id
export async function checkWorldTransition() {
  if (_checkedOnce || isOfflineMode() || isCircuitOpen()) return;
  _checkedOnce = true;

  try {
    const localWid = getWorldId();
    const remote = await _fetchRemoteBackup();
    if (!remote) {
      // No existing backup in Supabase — first ever sync, safe to upload
      _backupSafe = true;
      return;
    }

    const remoteWid = remote._world_id || null;

    if (remoteWid === localWid) {
      // Same world — normal operation
      _backupSafe = true;
      return;
    }

    // World ID mismatch → new world detected
    _isNewWorld = true;
    console.warn(`[WorldGuard] NEW WORLD detected! local=${localWid} remote=${remoteWid}`);

    const backups = remote.player_backups || [];
    if (backups.length === 0) {
      console.warn("[WorldGuard] No player backups to recover, skipping");
      _backupSafe = true;
      return;
    }

    // Mass-insert recovery queue for all backed-up players
    const inserted = await _massQueueRecovery(backups);
    console.warn(`[WorldGuard] Auto-recovery queued: ${inserted}/${backups.length} players`);

    // Backup stays UNSAFE until recovery is processed — prevents overwrite
    _backupSafe = false;
  } catch (e) {
    console.warn("[WorldGuard] Check failed:", e?.message || e);
    // On error, block backup to be safe (don't overwrite)
    _backupSafe = false;
  }
}

// Guard: should we include player_backups in this sync cycle?
export function isBackupSafe() { return _backupSafe; }

// Unlock backup after recovery is confirmed processed
export function unlockBackup() {
  _backupSafe = true;
  _isNewWorld = false;
}

// Fingerprint to detect actual data changes — skip upload if unchanged
export function backupFingerprint(filtered) {
  let fp = "";
  for (let i = 0; i < filtered.length; i++) {
    const b = filtered[i];
    fp += b.name + ":" + b.gem + ":" + (b.trails || []).length + ":" + (b.killfx || []).length + ";";
  }
  return fp;
}

export function hasBackupChanged(fp) {
  if (fp === _lastFingerprint) return false;
  _lastFingerprint = fp;
  return true;
}

export function getBackupTs(changed) {
  if (changed) _lastBackupTs = Date.now();
  return _lastBackupTs;
}

async function _fetchRemoteBackup() {
  const url = `${SUPABASE_URL}/rest/v1/leaderboard_sync?id=eq.current&select=gacha_lb`;
  const req = new HttpRequest(url);
  req.method = HttpRequestMethod.Get;
  req.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    new HttpHeader("Accept", "application/json"),
  ];
  const res = await httpWithTimeout(req);
  if (res.status < 200 || res.status >= 300) return null;

  const rows = JSON.parse(res.body || "[]");
  if (!rows.length || !rows[0].gacha_lb) return null;

  const lb = typeof rows[0].gacha_lb === "string"
    ? JSON.parse(rows[0].gacha_lb)
    : rows[0].gacha_lb;
  return lb;
}

async function _massQueueRecovery(backups) {
  let ok = 0;
  // Batch in groups of 5 to avoid overwhelming Supabase
  for (let i = 0; i < backups.length; i += 5) {
    const batch = backups.slice(i, i + 5);
    const rows = batch
      .filter(b => b.name && b.data)
      .map(b => ({
        player_name: b.name,
        import_string: b.data,
        status: "pending",
        result_msg: "auto-recovery (world transition)",
      }));

    if (!rows.length) continue;

    try {
      const req = new HttpRequest(RECOVERY_EP);
      req.method = HttpRequestMethod.Post;
      req.body = JSON.stringify(rows);
      req.headers = [
        new HttpHeader("apikey", SUPABASE_KEY),
        new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
        new HttpHeader("Content-Type", "application/json"),
        new HttpHeader("Prefer", "return=minimal"),
      ];
      const res = await httpWithTimeout(req);
      if (res.status >= 200 && res.status < 300) ok += rows.length;
    } catch (e) {
      console.warn("[WorldGuard] Batch insert error:", e?.message || e);
    }
  }
  return ok;
}
