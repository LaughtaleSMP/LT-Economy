// sync_mimi_cmd.js — Mimi Inka Command Queue poller
// Polls mimi_commands table for pending admin actions (revoke/assign title/nametag).
// SLO: poll success >= 95%/24h. Apply latency <= 60s p95.
// §7.4: circuit open → skip silently. §8.5: scriptevent bridge only.
// Security: sanitize player_name + validate action/slot before dispatch.

import { world, system } from "@minecraft/server";
import { HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { SUPABASE_URL, SUPABASE_KEY, isOfflineMode, isCircuitOpen, httpWithTimeout } from "./sync_http.js";

const CMD_EP = `${SUPABASE_URL}/rest/v1/mimi_commands`;
const _doneIds   = new Set();
const MAX_DONE   = 100;
const BATCH_SIZE = 5;    // max processed per poll cycle
const STUCK_MS   = 60_000;
const VALID_ACTIONS = new Set(['revoke_title','revoke_nametag','assign_title','assign_nametag']);
const VALID_SLOTS   = new Set(['ct','cn','it','in']);

// Pending replies from scriptevent (id -> resolve)
const _pendingReply = new Map();

let _polling    = false;
let _pollStartMs = 0;

// ── Register scriptevent reply listeners ──────────────────────────────
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === 'mimi:cmd_done' || event.id === 'mimi:cmd_fail') {
    try {
      const { id, msg } = JSON.parse(event.message);
      const entry = _pendingReply.get(id);
      if (entry) {
        try { system.clearRun(entry.timeout); } catch {} // [FIX] use system.clearRun
        _pendingReply.delete(id);
        entry.resolve({ ok: event.id === 'mimi:cmd_done', msg: msg || '' });
      }
    } catch (e) {
      console.warn(`[MimiCmd] Reply parse error: ${e.message}`);
    }
  }
});

// ── Public poll function — called from main.js every 30s ──────────────
export async function pollMimiCommands() {
  if (isOfflineMode() || isCircuitOpen()) return;

  // Stuck guard
  if (_polling && Date.now() - _pollStartMs > STUCK_MS) {
    console.warn('[MimiCmd] Stuck guard triggered, resetting.');
    _polling = false;
  }
  if (_polling) return;
  _polling = true;
  _pollStartMs = Date.now();

  try {
    const rows = await _fetchPending();
    if (!rows || rows.length === 0) return;
    console.warn(`[MimiCmd] ${rows.length} pending command(s) found.`);

    let processed = 0;
    for (const row of rows) {
      if (processed >= BATCH_SIZE) break;
      await _processCmd(row);
      processed++;
    }
  } catch (e) {
    if (!e?.circuitOpen) console.warn('[MimiCmd] Poll error:', e);
  } finally {
    _polling = false;
    // Trim _doneIds to avoid unbounded growth
    if (_doneIds.size > MAX_DONE) {
      const arr = [..._doneIds];
      _doneIds.clear();
      arr.slice(-Math.floor(MAX_DONE / 2)).forEach(id => _doneIds.add(id));
    }
  }
}

// ── Fetch pending rows ────────────────────────────────────────────────
async function _fetchPending() {
  const req = new HttpRequest(`${CMD_EP}?status=eq.pending&order=created_at.asc&limit=${BATCH_SIZE}`);
  req.method = HttpRequestMethod.Get;
  req.headers = [
    new HttpHeader('apikey',        SUPABASE_KEY),
    new HttpHeader('Authorization', `Bearer ${SUPABASE_KEY}`),
  ];
  const res = await httpWithTimeout(req);
  if (res.status < 200 || res.status >= 300) return null;
  return JSON.parse(res.body || '[]');
}

// ── Process one command row ───────────────────────────────────────────
async function _processCmd(row) {
  const { id, player_name, action, slot, value } = row;

  // Idempotency: skip already-done rows
  if (_doneIds.has(id)) {
    await _markCmd(id, 'done', 'OK (already done)');
    return;
  }

  // ── Validation ──
  if (!player_name || !action) {
    await _markCmd(id, 'failed', 'Missing player_name or action');
    _doneIds.add(id);
    return;
  }
  // Sanitize: player name must only contain safe chars (no scriptevent injection)
  if (/[^\w\s\-]/.test(player_name) || player_name.length > 64) {
    await _markCmd(id, 'failed', `Invalid player_name: "${player_name}"`);
    _doneIds.add(id);
    console.warn(`[MimiCmd] Rejected unsafe player_name: ${player_name}`);
    return;
  }
  if (!VALID_ACTIONS.has(action)) {
    await _markCmd(id, 'failed', `Unknown action: "${action}"`);
    _doneIds.add(id);
    return;
  }
  if (!slot || !VALID_SLOTS.has(slot)) {
    await _markCmd(id, 'failed', `Invalid slot: "${slot}"`);
    _doneIds.add(id);
    return;
  }
  // For assign, validate value is only safe glyph codepoints + Minecraft formatting codes
  if ((action === 'assign_title' || action === 'assign_nametag') && value) {
    if (!_isValidGlyphValue(value)) {
      await _markCmd(id, 'failed', 'Invalid glyph value — contains unsafe characters');
      _doneIds.add(id);
      return;
    }
  }

  // Mark as processing to prevent double-dispatch
  await _markCmd(id, 'processing', null);

  // Dispatch to Mimi Inka pack via scriptevent
  const payload = JSON.stringify({ id, player: player_name, action, slot, value: value || '' });
  try {
    world.getDimension('overworld').runCommand(`scriptevent mimi:admin_cmd ${payload}`);
    console.warn(`[MimiCmd] Dispatched id=${id} action=${action} player=${player_name}`);
  } catch (e) {
    await _markCmd(id, 'failed', `scriptevent dispatch failed: ${e.message}`);
    _doneIds.add(id);
    return;
  }

  // Wait for reply from bridge.js (timeout 10s)
  const result = await _waitReply(id, 10_000);
  _doneIds.add(id);
  await _markCmd(id, result.ok ? 'done' : 'failed', result.msg);
}

// ── Wait for reply via scriptevent ───────────────────────────────────
function _waitReply(id, timeoutMs) {
  // [FIX] Use system.runTimeout (Bedrock official API) not setTimeout
  const timeoutTicks = Math.ceil(timeoutMs / 50); // ms → ticks (1 tick ≈ 50ms)
  return new Promise((resolve) => {
    const tmo = system.runTimeout(() => {
      _pendingReply.delete(id);
      resolve({ ok: false, msg: 'Timeout — no reply from Mimi Inka pack' });
    }, timeoutTicks);
    _pendingReply.set(id, { resolve, timeout: tmo });
  });
}

// ── PATCH command status ──────────────────────────────────────────────
async function _markCmd(id, status, msg) {
  try {
    const body = { status, processed_at: new Date().toISOString() };
    if (msg !== null) body.result_msg = msg;
    const req = new HttpRequest(`${CMD_EP}?id=eq.${id}`);
    req.method = HttpRequestMethod.Patch;
    req.body   = JSON.stringify(body);
    req.headers = [
      new HttpHeader('apikey',        SUPABASE_KEY),
      new HttpHeader('Authorization', `Bearer ${SUPABASE_KEY}`),
      new HttpHeader('Content-Type',  'application/json'),
      new HttpHeader('Prefer',        'return=minimal'),
    ];
    await httpWithTimeout(req);
  } catch (e) {
    if (!e?.circuitOpen) console.warn(`[MimiCmd] _markCmd error for id=${id}:`, e);
  }
}

// ── Validate glyph value — PUA E000–EFFF + §formatting + basic ASCII ──
function _isValidGlyphValue(v) {
  if (typeof v !== 'string' || v.length > 256) return false;
  for (let i = 0; i < v.length; i++) {
    const cp = v.codePointAt(i);
    // [FIX] Allow full Private Use Area E000–EFFF (covers E7, E8, E9... ranges)
    if (cp >= 0xE000 && cp <= 0xEFFF) { if (cp > 0xFFFF) i++; continue; }
    if (cp === 0xA7) { i++; continue; }  // § + next format char
    if (cp === 0x20) continue;           // space
    if (cp >= 0x21 && cp <= 0x7E) continue; // printable ASCII
    return false;
  }
  return true;
}
