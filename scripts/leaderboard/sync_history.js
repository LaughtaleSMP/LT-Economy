/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_history.js — Push history rows + retention prune

   pushMetricsHistory()  — insert one row per full sync (~288/day)
   pushEcoHistory()      — insert eco snapshot with anti-dup check

   Both functions:
   - Fire-and-forget (no await on POST result)
   - Schedule retention prune after successful insert
   - Silent fail (history is non-critical)
   ══════════════════════════════════════════════════════════════ */

import { HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { SUPABASE_URL, SUPABASE_KEY, httpWithTimeout } from "./sync_http.js";

// ── Metrics history ─────────────────────────────────────────
const MH_RETENTION_DAYS = 30;
const MH_POS_RETENTION_HOURS = 168; // 7 days — must match monitor.html max range

export function pushMetricsHistory(serverMetrics) {
  const mh = {
    tps:      serverMetrics.tps || 0,
    players:  serverMetrics.players_online || 0,
    mobs:     serverMetrics.mobs?.total || 0,
    items:    serverMetrics.items?.total || 0,
    entities: serverMetrics.entities?.total || 0,
    dp_pct:   serverMetrics.dp_pct || 0,
    pos: JSON.stringify(
      (serverMetrics.player_details || []).slice(0, 30).map(p => ({
        n: (p.name || "?").substring(0, 16),
        x: p.x | 0, z: p.z | 0,
        d: (p.dim || "overworld")[0],
        p: p.pvp ? 1 : 0,
      }))
    ),
  };

  const req = new HttpRequest(`${SUPABASE_URL}/rest/v1/metrics_history`);
  req.method = HttpRequestMethod.Post;
  req.body = JSON.stringify(mh);
  req.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("Prefer", "return=minimal"),
  ];
  httpWithTimeout(req).then(r => {
    if (r.status >= 200 && r.status < 300) {
      // console.log("[MH] OK");
      _pruneMetricsHistory();
    } else {
      console.warn(`[MH] FAIL ${r.status}: ${r.body?.substring(0, 150)}`);
    }
  }).catch(e => { if (!e?.circuitOpen) console.warn("[MH] Error:", e); });
}

function _pruneMetricsHistory() {
  // Clear old position data (>168h / 7 days)
  const posCut = new Date(Date.now() - MH_POS_RETENTION_HOURS * 3600000).toISOString();
  const clrReq = new HttpRequest(`${SUPABASE_URL}/rest/v1/metrics_history?ts=lt.${posCut}&pos=not.is.null`);
  clrReq.method = HttpRequestMethod.Patch;
  clrReq.body = '{"pos":null}';
  clrReq.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    new HttpHeader("Content-Type", "application/json"),
  ];
  httpWithTimeout(clrReq).catch(() => {});

  // Delete rows >30 days old
  const rowCut = new Date(Date.now() - MH_RETENTION_DAYS * 86400000).toISOString();
  const delReq = new HttpRequest(`${SUPABASE_URL}/rest/v1/metrics_history?ts=lt.${rowCut}`);
  delReq.method = HttpRequestMethod.Delete;
  delReq.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
  ];
  httpWithTimeout(delReq).catch(() => {});
}

// ── Eco history (with anti-dup) ─────────────────────────────
const ECO_RETENTION_DAYS = 90;
const ECO_DUP_WINDOW_MS = 60_000;

/**
 * Push economy history snapshot with anti-dup check.
 * @param {object} summary       — gachaLB.summary
 * @param {object} logs          — { bankLog, auctionLog }
 * @param {string} flowForInsert — pre-stringified flow JSON
 */
export function pushEcoHistory(summary, logs, flowForInsert) {
  const doInsert = () => {
    const ecoRow = {
      player_count:     summary.n || 0,
      coin_total:       summary.coin?.total || 0,
      coin_avg:         summary.coin?.avg || 0,
      coin_median:      summary.coin?.median || 0,
      gem_total:        summary.gem?.total || 0,
      gem_avg:          summary.gem?.avg || 0,
      bank_tx_count:    logs.bankLog.length,
      auction_tx_count: logs.auctionLog.length,
      gacha_pull_count: summary.gacha?.pulls || 0,
      coin_flow:        flowForInsert,
    };
    const ecoReq = new HttpRequest(`${SUPABASE_URL}/rest/v1/economy_history`);
    ecoReq.method = HttpRequestMethod.Post;
    ecoReq.body = JSON.stringify(ecoRow);
    ecoReq.headers = [
      new HttpHeader("apikey", SUPABASE_KEY),
      new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
      new HttpHeader("Content-Type", "application/json"),
      new HttpHeader("Prefer", "return=minimal"),
    ];
    httpWithTimeout(ecoReq).then(er => {
      if (er.status >= 200 && er.status < 300) {
        // console.log("[Eco-History] OK");
        _pruneEcoHistory();
      } else {
        console.warn(`[Eco-History] FAIL ${er.status}: ${er.body?.substring(0, 150)}`);
      }
    }).catch(e => { if (!e?.circuitOpen) console.warn("[Eco-History] Error:", e); });
  };

  // Anti-dup check — fail-open (jika HTTP gagal, tetap insert)
  const dupCheckTs = new Date(Date.now() - ECO_DUP_WINDOW_MS).toISOString();
  const dupReq = new HttpRequest(`${SUPABASE_URL}/rest/v1/economy_history?ts=gte.${dupCheckTs}&select=id&limit=1`);
  dupReq.method = HttpRequestMethod.Get;
  dupReq.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
  ];
  httpWithTimeout(dupReq).then(dupRes => {
    let skip = false;
    if (dupRes.status >= 200 && dupRes.status < 300) {
      try {
        const arr = JSON.parse(dupRes.body || "[]");
        if (Array.isArray(arr) && arr.length > 0) skip = true;
      } catch {}
    }
    if (skip) {
      // console.log("[Eco-History] Skipped — instance lain sudah insert dalam 60s terakhir");
      return;
    }
    doInsert();
  }).catch(() => { doInsert(); });
}

function _pruneEcoHistory() {
  const ecoCut = new Date(Date.now() - ECO_RETENTION_DAYS * 86400000).toISOString();
  const ecoDelReq = new HttpRequest(`${SUPABASE_URL}/rest/v1/economy_history?ts=lt.${ecoCut}`);
  ecoDelReq.method = HttpRequestMethod.Delete;
  ecoDelReq.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
  ];
  httpWithTimeout(ecoDelReq).catch(() => {});
}

// ── Weather history ─────────────────────────────────────────
const WX_RETENTION_DAYS = 90;

/**
 * Push satu transisi cuaca ke `weather_history`.
 * @param {string} wx              - 'clear' | 'rain' | 'thunder'
 * @param {number} startMs         - ms epoch saat cuaca mulai
 * @param {number} endMs           - ms epoch saat cuaca berakhir
 * @param {number} worldTimeStart  - 0..23999 (Minecraft tick saat cuaca mulai)
 * @param {number} worldDay        - hari ke-N world (m.world_day saat start)
 *
 * Skip jika durasi <30s (kemungkinan /weather command spam) atau >2 jam (server pause).
 * Fire-and-forget, silent fail.
 */
export function pushWeatherHistory(wx, startMs, endMs, worldTimeStart, worldDay) {
  if (!wx || !startMs || !endMs) return;
  const dur = endMs - startMs;
  if (dur < 30000 || dur > 7200000) return;

  // Map world_time → time-of-day phase (0=pagi, 1=siang, 2=sore, 3=malam).
  // Fallback: derive dari real-time hour kalau worldTimeStart tidak tersedia.
  const td = ((worldTimeStart % 24000) + 24000) % 24000;
  const tod = td < 6000 ? 0 : td < 12000 ? 1 : td < 18000 ? 2 : 3;
  const dow = new Date(startMs).getDay(); // 0=Sun..6=Sat

  const row = {
    wx,
    start_ts: new Date(startMs).toISOString(),
    dur_ms: dur,
    tod,
    dow,
    world_day: worldDay || null,
  };
  const req = new HttpRequest(`${SUPABASE_URL}/rest/v1/weather_history`);
  req.method = HttpRequestMethod.Post;
  req.body = JSON.stringify(row);
  req.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("Prefer", "return=minimal"),
  ];
  httpWithTimeout(req).then(r => {
    if (r.status >= 200 && r.status < 300) {
      // console.log(`[WX-History] OK ${wx} ${(dur / 1000).toFixed(0)}s`);
      _pruneWeatherHistory();
    } else {
      console.warn(`[WX-History] FAIL ${r.status}: ${r.body?.substring(0, 120)}`);
    }
  }).catch(e => { if (!e?.circuitOpen) console.warn("[WX-History] Error:", e); });
}

let _wxLastPruneMs = 0;
function _pruneWeatherHistory() {
  // Throttle prune: max 1× per jam (jangan flood DELETE saat banyak transisi)
  const now = Date.now();
  if (now - _wxLastPruneMs < 3600000) return;
  _wxLastPruneMs = now;
  const cut = new Date(now - WX_RETENTION_DAYS * 86400000).toISOString();
  const delReq = new HttpRequest(`${SUPABASE_URL}/rest/v1/weather_history?ts=lt.${cut}`);
  delReq.method = HttpRequestMethod.Delete;
  delReq.headers = [
    new HttpHeader("apikey", SUPABASE_KEY),
    new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
  ];
  httpWithTimeout(delReq).catch(() => {});
}
