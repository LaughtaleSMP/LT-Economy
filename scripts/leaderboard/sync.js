/* ══════════════════════════════════════════════════════════════
   leaderboard/sync.js — Push weekly LB + gacha LB + online players
   to Supabase (orchestration layer).

   SLO: full sync success ≥ 99% / 24h. Latency p95 ≤ 5s.
        Error budget: ~14 min/24h. Beyond → freeze new releases.

   SYNC MODES:
   1. Full sync (every 5 min) — all data: LB, gacha, logs, full metrics
   2. Micro-sync (every 5s)   — PATCH server_metrics only (positions + cached counts)
   3. Topup poll (every 30s)  — GET pending topups from web panel (sync_topup.js)

   See docs/runbook/leaderboard-sync.md for failure-mode handling.
   ══════════════════════════════════════════════════════════════ */

import { world, system } from "@minecraft/server";
import { HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { getTPS } from "../MobuXP/monitor/tps_tracker.js";
import { getEntityCounts } from "../MobuXP/monitor/entity_counter.js";
import { consumeFlow } from "../eco_flow.js";
import { LB_CFG as CFG } from "./config.js";

import { SUPABASE_KEY, ENDPOINT, isOfflineMode, isCircuitOpen, httpWithTimeout } from "./sync_http.js";
import { dpRead, dpGet, dpGetChunked } from "./sync_dp.js";
import { buildServerMetrics, cachedFullExtras, trackWeatherTransition } from "./sync_metrics.js";
import { buildGachaLBAsync } from "./sync_gacha.js";
import { updateDynamicPricing, updateEcoPolicy, updateStagflation, cleanupLegacyWtaxDp } from "./sync_pricing.js";
import { pushMetricsHistory, pushEcoHistory, flushAuctionHistory, pushAuctionHistory } from "./sync_history.js";
import { buildFeatureGuide } from "./sync_guide.js";
import { buildExportAll } from "../gacha/utils/export.js";
import { PT_POOL } from "../gacha/config.js";
import { CFG as COMBAT_CFG } from "../Combat/config.js";
import { checkWorldTransition, getWorldId, isBackupSafe, unlockBackup, backupFingerprint, hasBackupChanged, getBackupTs } from "./sync_world_guard.js";
import { _injectAuctionSync } from "../auction/utils/storage.js";

export { pollTopupQueue } from "./sync_topup.js";
export { pollRecoveryQueue } from "./sync_recovery.js";

// Wire auction → Supabase bridge (static import, no dynamic import needed)
try { _injectAuctionSync(pushAuctionHistory); } catch {}

// ── Sync state ──────────────────────────────────────────────
let _syncing = false;
let _syncStartMs = 0;
const SYNC_STUCK_THRESHOLD_MS = 60_000;

let _posSyncing = false;
let _posSyncStartMs = 0;
const POS_SYNC_STUCK_THRESHOLD_MS = 15_000;
const POS_SYNC_TIMEOUT_TICKS = 200; // 10s

// ────────────────────────────────────────────────────────────
// FULL SYNC — every 5 min: all data including weekly LB, gacha,
// economy logs, server metrics, and policy/pricing recalculation.
// ────────────────────────────────────────────────────────────
export async function syncLeaderboard() {
  if (isOfflineMode()) return;

  // Skip when server in emergency mode
  try { if (getTPS() < 10) return; } catch {}

  // [SRE §7.4] Circuit open → skip silently. Scheduler will retry next cycle;
  // logging here just spams WARN during 5-min cooldown.
  if (isCircuitOpen()) return;

  // Stuck guard
  if (_syncing && Date.now() - _syncStartMs > SYNC_STUCK_THRESHOLD_MS) {
    console.warn("[LB-Sync] Stuck guard detected, force reset");
    _syncing = false;
  }
  if (_syncing) return;
  _syncing = true;
  _syncStartMs = Date.now();

  try {
    const onlinePlayers = _gatherOnlineNames();

    let serverMetrics = {};
    try { serverMetrics = buildServerMetrics(); }
    catch (e) { console.warn("[LB-Sync] Metrics error:", e); }

    const weekly = _readWeeklyLb();

    let gachaLB = {};
    try { gachaLB = await buildGachaLBAsync(); } catch {}

    _attachFeatureGuide(gachaLB);

    // World transition detection — runs once on first sync
    await checkWorldTransition();
    gachaLB._world_id = getWorldId();

    // Skip players without paid assets — save Supabase payload size
    try {
      const backups = buildExportAll();
      const filtered = [];
      for (const b of backups) {
        const parts = b.str.split('|');
        let gem = 0, pt = '', rawKfx = '';
        for (let i = 1; i < parts.length; i++) {
          const ci = parts[i].indexOf(':');
          if (ci < 0) continue;
          const k = parts[i].slice(0, ci), v = parts[i].slice(ci + 1);
          if (k === 'gem') gem = parseInt(v, 10) || 0;
          else if (k === 'pt') pt = v;
          else if (k === 'kfx') rawKfx = v;
        }

        // Bracket-safe split for kfx
        let kfxKeys = [];
        if (rawKfx) {
          kfxKeys = rawKfx.split(',').reduce((acc, chunk) => {
            if (acc._buf) {
              acc._buf += "," + chunk;
              if (chunk.endsWith("]")) { acc.push(acc._buf); acc._buf = null; }
            } else if (chunk.startsWith("[")) {
              if (chunk.endsWith("]")) acc.push(chunk); else acc._buf = chunk;
            } else { acc.push(chunk); }
            return acc;
          }, []);
          delete kfxKeys._buf;
        }

        if (gem > 0 || pt || kfxKeys.length > 0) {
          filtered.push({
            id: b.id, name: b.name, data: b.str, online: b.isOnline,
            gem, trails: pt ? pt.split(',').filter(Boolean) : [],
            killfx: kfxKeys,
          });
        }
      }

      // Guard: don't overwrite rich backup with empty new-world data
      if (!isBackupSafe()) {
        console.warn("[LB-Sync] Backup SKIPPED — new world detected, waiting for recovery");
      } else {
        const fp = backupFingerprint(filtered);
        const changed = hasBackupChanged(fp);
        
        // Kita HARUS selalu menyertakan data ini di setiap sync.
        // Karena `gacha_lb` adalah overwrite JSON penuh, jika dihilangkan maka data terhapus.
        gachaLB.player_backups = filtered;
        gachaLB._backup_ts = getBackupTs(changed);

        // Tag→name maps
        const trailMap = {};
        for (const p of PT_POOL) trailMap[p.tag] = p.name;
        gachaLB._trail_names = trailMap;
        
        const fxMap = {};
        const _fk = (id) => Array.isArray(id) ? JSON.stringify(id) : id;
        for (const e of COMBAT_CFG.KILL_EFFECTS) fxMap[_fk(e.id)] = e.name;
        gachaLB._fx_names = fxMap;
      }
    } catch (e) {
      console.warn(`[LB-Sync] backup build FAILED: ${e?.message || e}`);
      gachaLB._backup_err = String(e?.message || e).slice(0, 100);
    }

    const logs = _readEconLogs();
    const discCodes = dpGet("disc_codes", {});

    const payload = _buildPayload({
      weekly, onlinePlayers, gachaLB, logs, discCodes, serverMetrics,
    });

    const res = await _sendFullSyncPayload(payload);

    if (res.status >= 200 && res.status < 300) {
      _logFullSyncOk(res.status, weekly.entries, gachaLB, onlinePlayers);
      _postSyncSideEffects(serverMetrics, gachaLB, logs);
    } else {
      console.warn(`[LB-Sync] FAIL HTTP ${res.status}: ${res.body?.substring(0, 200)}`);
    }
  } catch (e) {
    if (!e?.circuitOpen) console.warn("[LB-Sync] Error:", e);
  } finally {
    _syncing = false;
  }
}

// ── Full sync helpers ───────────────────────────────────────

function _gatherOnlineNames() {
  const out = [];
  try { for (const p of world.getPlayers()) out.push(p.name); } catch {}
  return out;
}

function _readWeeklyLb() {
  let entries = [];
  let weekStart = Date.now();
  let timeLeftMs = CFG.WEEK_MS;

  const weekRaw = dpRead(CFG.K_WEEK);
  if (!weekRaw) return { entries, weekStart, timeLeftMs };

  try {
    const data = JSON.parse(weekRaw);
    if (data?.players) {
      entries = Object.entries(data.players)
        .map(([, p]) => {
          const k = p.kills || 0, m = p.mined || 0, b = p.placed || 0, v = p.pvp || 0;
          return {
            name: p.name || "???", kills: k, mined: m, placed: b, pvp: v,
            score: k * CFG.SCORE.kill + m * CFG.SCORE.mine
                 + b * CFG.SCORE.place + v * CFG.SCORE.pvp,
          };
        })
        .filter(e => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      weekStart = data.start || Date.now();
      timeLeftMs = Math.max(0, CFG.WEEK_MS - (Date.now() - weekStart));
    }
  } catch {}

  return { entries, weekStart, timeLeftMs };
}

function _readEconLogs() {
  let bankLog = [], auctionLog = [], gachaLog = [], topupLog = [], landLog = [];
  try { bankLog = dpGet("bank:global_hist", []).slice(-50); } catch {}
  try { auctionLog = dpGet("auc:hist", []).slice(-100); } catch {}
  try { gachaLog = dpGet("g_hist", []).slice(-50); } catch {}
  try { topupLog = dpGetChunked("gacha:topup_log", []).slice(-50); } catch {}
  // Land log: read from _land_hist scoreboard (cross-pack bridge from Mimi Land)
  try {
    const sb = world.scoreboard.getObjective("_land_hist");
    if (sb) {
      const parts = sb.getParticipants();
      for (const p of parts) {
        try {
          const entry = JSON.parse(p.displayName);
          if (entry && entry.p) {
            landLog.push({
              ts: new Date(entry.ts).toISOString(),
              player: entry.p,
              action: entry.a,
              detail: entry.d,
              coin: entry.c || 0,
              gem: entry.g || 0
            });
          }
        } catch {}
      }
      // Sort by timestamp, keep last 50
      landLog.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      landLog = landLog.slice(-50);
      // NOTE: Do NOT clear scoreboard here — land_hist is an append-only
      // log with 50-entry cap managed by Mimi Land. Clearing would make
      // logs disappear between sync cycles (5 min).
    }
  } catch {}
  return { bankLog, auctionLog, gachaLog, topupLog, landLog };
}

function _attachFeatureGuide(gachaLB) {
  try {
    gachaLB.guide = buildFeatureGuide(dpRead);
  } catch (ge) {
    console.warn("[LB-Sync] Guide build:", ge);
  }
}

function _buildPayload({ weekly, onlinePlayers, gachaLB, logs, discCodes, serverMetrics }) {
  if (logs.landLog && logs.landLog.length > 0) gachaLB.land_log = logs.landLog;
  return {
    id: "current",
    week_start: new Date(weekly.weekStart).toISOString(),
    time_left_ms: weekly.timeLeftMs,
    synced_at: new Date().toISOString(),
    entries:        JSON.stringify(weekly.entries),
    online_players: JSON.stringify(onlinePlayers),
    gacha_lb:       JSON.stringify(gachaLB),
    bank_log:       JSON.stringify(logs.bankLog),
    auction_log:    JSON.stringify(logs.auctionLog),
    gacha_log:      JSON.stringify(logs.gachaLog),
    topup_log:      JSON.stringify(logs.topupLog),
    disc_codes:     JSON.stringify(discCodes),
    server_metrics: JSON.stringify(serverMetrics),
  };
}

async function _sendFullSyncPayload(payload) {
  const req = new HttpRequest(ENDPOINT + "?on_conflict=id");
  req.method = HttpRequestMethod.Post;
  req.body = JSON.stringify(payload);
  req.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("Prefer", "resolution=merge-duplicates,return=minimal"),
  ];
  return httpWithTimeout(req);
}

function _logFullSyncOk(status, entries, gachaLB, onlinePlayers) {
  const gc = Object.values(gachaLB).reduce((s, a) => Math.max(s, Array.isArray(a) ? a.length : 0), 0);
  // console.log(
  //   `[LB-Sync] OK (${status}): ${entries.length} weekly, ` +
  //   `${gc} gacha, ${onlinePlayers.length} online.`
  // );
}

function _postSyncSideEffects(serverMetrics, gachaLB, logs) {
  try { pushMetricsHistory(serverMetrics); } catch {}
  try { flushAuctionHistory(); } catch {}

  if (!gachaLB.summary) return;

  // [CRITICAL] Single consumeFlow() — counters reset on first call.
  // Same flow object used by: eco_history insert, pricing calc, policy calc.
  try {
    const flow = consumeFlow();
    _attachFlowMeta(flow, gachaLB.summary, logs);

    // [INFL-V2] Pricing dihitung DULU agar price_index bisa di-attach ke
    // snapshot yang akan masuk economy_history. Web pakai _pi delta untuk
    // hitung inflasi sejati (CPI-style), bukan supply growth.
    updateDynamicPricing(gachaLB.summary, flow);
    _attachPriceIndex(flow);

    // Snapshot untuk insert (deferred via dup-check) — immutable copy
    const flowSnapshot = JSON.stringify(flow);

    try { pushEcoHistory(gachaLB.summary, logs, flowSnapshot); } catch {}
    updateEcoPolicy(gachaLB.summary, flow);
    cleanupLegacyWtaxDp();
    updateStagflation(gachaLB.summary, logs.bankLog, logs.auctionLog);
  } catch (e) {
    console.warn("[LB-Sync] post-sync calc:", e);
  }
}

function _attachFlowMeta(flow, summary, logs) {
  let bVol = 0, aVol = 0;
  for (let i = 0; i < logs.bankLog.length; i++) bVol += Math.abs(logs.bankLog[i].amount || 0);
  for (let i = 0; i < logs.auctionLog.length; i++) aVol += Math.abs(logs.auctionLog[i].price || 0);
  flow._bv = bVol;
  flow._av = aVol;
  flow._gini = summary.gini || 0;
  flow._p25 = summary.coin?.p25 || 0;
  flow._p75 = summary.coin?.p75 || 0;
}

// [INFL-V2] Read freshly-written eco:pricing dan attach price index.
// _pi = basket harga representatif. Pakai weighted avg untuk stabilitas:
//   60% coinBasis (income/hour anchor) + 30% eq10 + 10% land smallest tier.
// Skip silently kalau pricing belum ada (cold start).
function _attachPriceIndex(flow) {
  try {
    const raw = world.getDynamicProperty("eco:pricing");
    if (typeof raw !== "string" || !raw.length) return;
    const p = JSON.parse(raw);
    if (!p || !Number.isFinite(p.iph)) return;
    const eq10 = Number.isFinite(p.eq10) ? p.eq10 : p.iph * 9;
    const lr0 = (p.lr && p.lr[0] && Number.isFinite(p.lr[0].r)) ? p.lr[0].r : p.iph * 0.012;
    // Basket: 0.6×basis + 0.3×(eq10/9 normalized) + 0.1×(land rate ×100 normalized)
    const idx = p.iph * 0.6 + (eq10 / 9) * 0.3 + (lr0 * 100) * 0.1;
    flow._pi = +idx.toFixed(2);
  } catch {}
}

// ── Metrics + eco history pushes are in sync_history.js ─────

/* ══════════════════════════════════════════════════════════════
   MICRO-SYNC — PATCH player positions + cached metrics every 5s

   - PATCHes the SAME leaderboard_sync row (id="current")
   - Updates ONLY server_metrics + synced_at columns
   - Uses ONLY cached data → zero getEntities(), zero DP reads
   - Web monitor polls leaderboard_sync → gets fresh positions
   - Full sync (5 min) overwrites with complete data

   COST: ~0 TPS impact, ~12 KB/min network, 0 new DB rows.
   ══════════════════════════════════════════════════════════════ */
export async function microSyncPositions() {
  if (isOfflineMode()) return;

  // TPS gate: skip when server is under pressure
  try { if (getTPS() < 15) return; } catch { return; }

  // [SRE §7.4] Circuit open → silent skip (5s cadence would spam logs).
  if (isCircuitOpen()) return;

  // Overlap guard with stuck detection
  if (_posSyncing) {
    if (Date.now() - _posSyncStartMs > POS_SYNC_STUCK_THRESHOLD_MS) {
      console.warn("[Pos-Sync] Stuck guard, force reset");
      _posSyncing = false;
    } else return;
  }
  _posSyncing = true;
  _posSyncStartMs = Date.now();

  try {
    const players = world.getPlayers();
    if (players.length === 0) return;

    const { details, dimCount } = _gatherPlayerDetails(players);
    if (details.length === 0) return;

    const miniMetrics = _buildMiniMetrics(players.length, details, dimCount);
    _mergeCachedExtras(miniMetrics);
    _attachLiveTimeAndWeather(miniMetrics);

    await _sendMicroSyncPatch(miniMetrics);
  } catch {
    // Silent fail — positions are non-critical data
  } finally {
    _posSyncing = false;
  }
}

function _gatherPlayerDetails(players) {
  const details = [];
  const dimCount = { overworld: 0, nether: 0, the_end: 0 };

  for (const p of players) {
    try {
      const dimId = p.dimension?.id || "minecraft:overworld";
      const dimKey = dimId.replace("minecraft:", "");
      if (dimCount[dimKey] !== undefined) dimCount[dimKey]++;

      const loc = p.location;
      const detail = {
        name: p.name,
        dim: dimKey,
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z),
      };
      try { detail.gamemode = p.getGameMode?.() || "unknown"; } catch {}
      try { detail.pvp = p.hasTag("pvp:on"); } catch {}
      details.push(detail);
    } catch {}
  }

  return { details, dimCount };
}

function _buildMiniMetrics(playerCount, details, dimCount) {
  const ec = getEntityCounts();
  return {
    ts: Date.now(),
    tps: getTPS(),
    players_online: playerCount,
    player_details: details,
    players_per_dim: dimCount,
    entities: {
      overworld: ec.perDim.OW,
      nether:    ec.perDim.N,
      the_end:   ec.perDim.E,
      total:     ec.total,
    },
    mobs: {
      overworld: (ec.hostilePerDim?.OW || 0) + (ec.passivePerDim?.OW || 0),
      nether:    (ec.hostilePerDim?.N  || 0) + (ec.passivePerDim?.N  || 0),
      the_end:   (ec.hostilePerDim?.E  || 0) + (ec.passivePerDim?.E  || 0),
      total:     (ec.hostile || 0) + (ec.passive || 0) + (ec.villagers || 0),
    },
    items: {
      overworld: 0, nether: 0, the_end: 0,
      total: ec.items || 0,
    },
  };
}

function _mergeCachedExtras(m) {
  // Merge cached full-sync exclusive fields so web monitor never
  // loses data between full syncs (every 5 min).
  if (cachedFullExtras.dp_pct !== undefined) {
    m.dp_pct   = cachedFullExtras.dp_pct;
    m.dp_bytes = cachedFullExtras.dp_bytes;
    m.dp_max   = cachedFullExtras.dp_max;
  }
  if (cachedFullExtras.dp_breakdown)     m.dp_breakdown     = cachedFullExtras.dp_breakdown;
  if (cachedFullExtras.entity_breakdown) m.entity_breakdown = cachedFullExtras.entity_breakdown;
  if (cachedFullExtras.entity_hotspots)  m.entity_hotspots  = cachedFullExtras.entity_hotspots;
  if (cachedFullExtras.land_claims)      m.land_claims      = cachedFullExtras.land_claims;
  if (cachedFullExtras.world_day !== undefined) m.world_day = cachedFullExtras.world_day;
}

function _attachLiveTimeAndWeather(m) {
  try { m.tick = system.currentTick; } catch {}
  try { m.world_time = world.getTimeOfDay?.() ?? 0; } catch {}

  // Include weather + transition log in micro-sync (5s update for atmosphere visual + forecast)
  let weatherStr = "clear";
  try {
    const ow = world.getDimension("overworld");
    const w = ow?.getWeather?.();
    weatherStr = w === "Rain" ? "rain" : w === "Thunder" ? "thunder" : "clear";
  } catch {
    weatherStr = cachedFullExtras.weather || "clear";
  }
  m.weather = weatherStr;
  // Track transition di micro-sync juga supaya event di antara full sync (5 menit) tertangkap.
  trackWeatherTransition(weatherStr);
  cachedFullExtras.weather = weatherStr;

  // Bridge weather history ke micro-sync biar web monitor selalu dapat sample hist global.
  if (cachedFullExtras.weather_log) m.weather_log = cachedFullExtras.weather_log;
  if (cachedFullExtras.weather_since_ms) m.weather_since_ms = cachedFullExtras.weather_since_ms;
}

async function _sendMicroSyncPatch(miniMetrics) {
  const req = new HttpRequest(`${ENDPOINT}?id=eq.current`);
  req.method = HttpRequestMethod.Patch;
  req.body = JSON.stringify({
    server_metrics: JSON.stringify(miniMetrics),
    synced_at: new Date().toISOString(),
  });
  req.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("Prefer", "return=minimal"),
  ];

  await httpWithTimeout(req, POS_SYNC_TIMEOUT_TICKS);
}
