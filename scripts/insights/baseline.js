/* ══════════════════════════════════════════════════════════════
   insights/baseline.js — Read-only baseline snapshot for gem economy

   Tujuan: jawab 4 pertanyaan kunci sebelum eksekusi roadmap
   peningkatan pembelian gem (P0 dari rekomendasi panel pakar).

     Q1 (Reach)        — Berapa player pernah pegang gem? Penetrasi?
     Q2 (Distribution) — Distribusi balance gem per player (avg/median/p90)
     Q3 (Sink ratio)   — Gem keluar via land vs gacha vs lain
     Q4 (Throughput)   — Gem in (topup) vs gem out (sink) windowed

   ⚠ Read-only. Tidak menulis DP, tidak memanggil consumeFlow().
   ⚠ Admin tag "mimi" only. Snapshot live, bukan time-series.

   Output: ActionFormData multi-section (konsisten dengan /lt:tax style)
   dengan navigasi: Ringkasan → Distribusi → Flow → Top Whales → Diagnosis.
   ══════════════════════════════════════════════════════════════ */

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { dpGet, dpGetChunked } from "../leaderboard/sync_dp.js";
import { readMetrics as readWelcomeMetrics } from "../welcome_metrics.js";

// ── Config ──────────────────────────────────────────────────
const CMD_NAME    = "lt:baseline";
const ADMIN_TAG   = "mimi";
const FLOW_KEY    = "eco:flow";
const TOPUP_DAILY_PFX = "topup:daily:";
const MS_PER_DAY  = 86_400_000;
const GEM_OBJ     = "gem";
const COIN_OBJ    = "coin";

// Visual constants (match welcome.js / wealth_admin.js convention)
const HR      = "§8══════════════════════════";
const HR_THIN = "§8──────────────────────────";

// ── Command registration ────────────────────────────────────
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  try {
    customCommandRegistry.registerCommand(
      {
        name:            CMD_NAME,
        description:     "Snapshot baseline ekonomi gem (Admin only)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) {
          system.run(() => player.sendMessage("§8[§cBaseline§8]§c Akses ditolak."));
          return { status: 0 };
        }
        system.run(() => showBaselineSummary(player));
        return { status: 0 };
      }
    );
  } catch (e) {
    console.warn("[Baseline] Command reg gagal:", e);
  }
});

// ══════════════════════════════════════════════════════════════
// SECTION 0 — Snapshot builder (single source of truth)
// ══════════════════════════════════════════════════════════════
function _buildSnapshot() {
  const t0 = Date.now();
  const reg = dpGetChunked("p_reg", {});
  const onlineMap = _buildOnlineMap();
  const gemDist  = _analyzeDistribution(reg, onlineMap, "gem");
  const coinDist = _analyzeDistribution(reg, onlineMap, "coin");
  const reach    = _analyzeReach(gemDist);
  const flow     = _readFlowSnapshot();
  const topup    = _scanTopupToday();
  const topGem   = _topHolders(reg, onlineMap, "gem", 10);
  const welcome  = _readWelcomeMetricsSafe();
  const elapsed  = Date.now() - t0;
  return { reach, gemDist, coinDist, flow, topup, topGem, welcome, elapsed };
}

function _readWelcomeMetricsSafe() {
  try { return readWelcomeMetrics() || {}; }
  catch { return {}; }
}

// ══════════════════════════════════════════════════════════════
// SECTION 1 — Ringkasan (entry point)
// ══════════════════════════════════════════════════════════════
async function showBaselineSummary(player) {
  let snap;
  try { snap = _buildSnapshot(); }
  catch (e) {
    player.sendMessage(`§8[§cBaseline§8]§c Error: ${e?.message || e}`);
    console.warn("[Baseline] build error:", e);
    return;
  }
  _logToConsole(snap);

  const { reach, gemDist, coinDist, topup, elapsed } = snap;

  let body = `${HR}\n`;
  body += `§e  BASELINE EKONOMI GEM\n`;
  body += `${HR}\n\n`;
  body += `  §8Snapshot live §8┃ §7${elapsed}ms §8┃ §fn=${reach.total}\n\n`;

  // Reach (Q1)
  body += `  §b▼ Q1 PENETRASI GEM\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fTercatat   §8── §f${_fmt(reach.total)} §8player\n`;
  body += `  §8├ §fPegang gem §8── §a${_fmt(reach.everHeld)} §8(${reach.pct.toFixed(1)}%%)\n`;
  body += `  §8└ §fBelum      §8── §c${_fmt(gemDist.zero)}\n\n`;

  // Distribution (Q2) — kompak satu blok
  body += `  §b▼ Q2 DISTRIBUSI BALANCE\n`;
  body += `${HR_THIN}\n`;
  body += `  §8┌ §dGEM§8─────────────────────\n`;
  body += `  §8├ §fTotal   §8── §d${_fmt(gemDist.total)}\n`;
  body += `  §8├ §fAvg     §8── §d${_fmt(gemDist.avg)} §8(holder ${_fmt(gemDist.avgNz)})\n`;
  body += `  §8├ §fp50/p90 §8── §d${_fmt(gemDist.median)}§8/§d${_fmt(gemDist.p90)}\n`;
  body += `  §8├ §fp99/max §8── §d${_fmt(gemDist.p99)}§8/§d${_fmt(gemDist.max)}\n`;
  body += `  §8└────────────────────────\n`;
  body += `  §8┌ §6KOIN§8────────────────────\n`;
  body += `  §8├ §fTotal §8── §6${_fmt(coinDist.total)}\n`;
  body += `  §8├ §fAvg   §8── §6${_fmt(coinDist.avg)}\n`;
  body += `  §8├ §fp50   §8── §6${_fmt(coinDist.median)}\n`;
  body += `  §8└ §fp90   §8── §6${_fmt(coinDist.p90)}\n\n`;

  // Topup hari ini
  body += `  §b▼ TOPUP HARI INI §8(UTC)\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §dGem  §8── §a${topup.gem.players}p §8┃ §d+${_fmt(topup.gem.total)}\n`;
  body += `  §8└ §6Koin §8── §a${topup.coin.players}p §8┃ §6+${_fmt(topup.coin.total)}\n\n`;

  // Welcome adoption (cumulative since deploy)
  const w = snap.welcome || {};
  const wTotal = (w.welcome_first || 0) + (w.welcome_update || 0);
  if (wTotal > 0 || (w.guide_open || 0) > 0 || (w.nudge_shown || 0) > 0) {
    body += `  §b▼ WELCOME ADOPSI §8(kumulatif)\n`;
    body += `${HR_THIN}\n`;
    body += `  §8├ §fWelcome   §8── §a${_fmt(w.welcome_first || 0)}§8 baru §8+ §a${_fmt(w.welcome_update || 0)}§8 update\n`;
    body += `  §8├ §fGuide     §8── §a${_fmt(w.guide_open || 0)}§8 buka\n`;
    body += `  §8├ §dGem panel §8── §a${_fmt(w.gem_panel_open || 0)}§8 klik\n`;
    body += `  §8└ §eNudge     §8── §a${_fmt(w.nudge_shown || 0)}§8 tampil\n\n`;
  }

  // Diagnosis cepat (1-2 baris terpenting)
  body += `  §b▼ DIAGNOSIS RINGKAS\n`;
  body += `${HR_THIN}\n`;
  for (const line of _diagnoseShort(snap)) body += `  ${line}\n`;
  body += `\n${HR}`;

  const form = new ActionFormData()
    .title("§8 ♦ §eBASELINE§r §8♦ §r")
    .body(body)
    .button("§b  Detail Flow\n§r  §8Source/sink window terakhir", "textures/items/compass_item")
    .button("§d  Top 10 Pemegang Gem\n§r  §8Whale list (anonimisasi inisial)", "textures/items/diamond")
    .button("§a  Diagnosis Lengkap\n§r  §8Saran prioritas roadmap", "textures/items/book_normal")
    .button("§e  Refresh\n§r  §8Ambil snapshot ulang", "textures/items/clock_item")
    .button("§8  Tutup", "textures/items/redstone_dust");

  const res = await form.show(player);
  if (res.canceled) return;
  switch (res.selection) {
    case 0: return showFlowDetail(player, snap);
    case 1: return showWhaleList(player, snap);
    case 2: return showDiagnosisFull(player, snap);
    case 3: return showBaselineSummary(player); // refresh
    default: return;
  }
}

// ══════════════════════════════════════════════════════════════
// SECTION 2 — Detail Flow (Q3 + Q4)
// ══════════════════════════════════════════════════════════════
async function showFlowDetail(player, snap) {
  const { flow } = snap;

  // Bagi flow jadi empat bucket: gem source, gem sink, coin source, coin sink.
  const gemSources  = ["topup", "topup_first_bonus", "land_buy_gem", "gacha_gem_refund"];
  const gemSinks    = ["gacha_gem_cost"];
  const coinSinks   = ["bank_tax", "auction_fee", "wealth_tax", "demurrage", "store_sink", "land_buy", "land_ppn", "gacha_cost"];
  const coinSources = ["mob_kill", "weekly_reward", "first_sale", "tax_distribute", "ubi_injection", "land_refund", "pvp_refund", "gacha_refund"];

  let body = `${HR}\n`;
  body += `§b  Q3+Q4 FLOW WINDOW\n`;
  body += `${HR}\n\n`;
  body += `  §8Sejak sync terakhir §8(≤5 menit)\n`;
  body += `  §8Read-only — counter tidak di-reset.\n\n`;

  body += `  §d▼ GEM — SOURCE §8(masuk)\n`;
  body += `${HR_THIN}\n`;
  body += _renderFlowBucket(flow, gemSources, "  §7(tidak ada flow gem masuk)\n");
  body += `\n`;

  body += `  §5▼ GEM — SINK §8(keluar)\n`;
  body += `${HR_THIN}\n`;
  body += _renderFlowBucket(flow, gemSinks, "  §7(belum ada sink gem)\n");
  body += `\n`;

  body += `  §6▼ KOIN — SOURCE §8(masuk)\n`;
  body += `${HR_THIN}\n`;
  body += _renderFlowBucket(flow, coinSources, "  §7(belum ada source koin)\n");
  body += `\n`;

  body += `  §c▼ KOIN — SINK §8(keluar)\n`;
  body += `${HR_THIN}\n`;
  body += _renderFlowBucket(flow, coinSinks, "  §7(belum ada sink koin)\n");

  // Other (key tidak dikenali)
  const known = new Set([...gemSources, ...gemSinks, ...coinSources, ...coinSinks]);
  const other = Object.keys(flow).filter(k => !known.has(k));
  if (other.length > 0) {
    body += `\n  §7▼ LAINNYA\n${HR_THIN}\n`;
    body += _renderFlowBucket(flow, other, "");
  }

  body += `\n${HR}`;

  const form = new ActionFormData()
    .title("§8 ♦ §bFLOW§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .button("§8  Tutup", "textures/items/redstone_dust");

  const res = await form.show(player);
  if (res.canceled || res.selection === 1) return;
  if (res.selection === 0) return showBaselineSummary(player);
}

// ══════════════════════════════════════════════════════════════
// SECTION 3 — Top 10 holders (anonimisasi inisial untuk privacy)
// ══════════════════════════════════════════════════════════════
async function showWhaleList(player, snap) {
  const { topGem, gemDist } = snap;

  let body = `${HR}\n`;
  body += `§d  TOP 10 PEMEGANG GEM\n`;
  body += `${HR}\n\n`;
  body += `  §8Anonimisasi inisial §8(privacy)\n`;
  body += `  §8Total holder §8── §a${gemDist.nonzero}\n\n`;

  if (topGem.length === 0) {
    body += `  §c(belum ada player dengan gem > 0)\n`;
  } else {
    body += `  §8Rank ─ Inisial ──────── Saldo\n`;
    body += `${HR_THIN}\n`;
    for (let i = 0; i < topGem.length; i++) {
      const e = topGem[i];
      const rank = String(i + 1).padStart(2, " ");
      const init = _toInitials(e.name).padEnd(6, " ");
      body += `  §8#${rank} §f${init} §8── §d${_fmt(e.bal)}\n`;
    }
    body += `\n  §8Median §8── §d${_fmt(gemDist.median)}  §8┃ p99 §8── §d${_fmt(gemDist.p99)}\n`;
  }

  body += `\n${HR}`;

  const form = new ActionFormData()
    .title("§8 ♦ §dWHALES§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .button("§8  Tutup", "textures/items/redstone_dust");

  const res = await form.show(player);
  if (res.canceled || res.selection === 1) return;
  if (res.selection === 0) return showBaselineSummary(player);
}

// ══════════════════════════════════════════════════════════════
// SECTION 4 — Diagnosis lengkap dengan rekomendasi
// ══════════════════════════════════════════════════════════════
async function showDiagnosisFull(player, snap) {
  const { reach, gemDist, flow, topup } = snap;

  let body = `${HR}\n`;
  body += `§a  DIAGNOSIS & REKOMENDASI\n`;
  body += `${HR}\n\n`;

  // Penetrasi
  body += `  §e▼ PENETRASI\n`;
  body += `${HR_THIN}\n`;
  if (reach.pct < 10) {
    body += `  §c⚠ §f${reach.pct.toFixed(1)}%% §8(<10%%)\n`;
    body += `  §8└ §fFokus §cAWARENESS\n`;
    body += `  §8  §fP1 #1 visibility hooks\n`;
    body += `  §8  §fP1 #3 welcome calculator\n\n`;
  } else if (reach.pct < 30) {
    body += `  §e⚠ §f${reach.pct.toFixed(1)}%% §8(10-30%%)\n`;
    body += `  §8└ §fFokus §eKONVERSI\n`;
    body += `  §8  §fP2 #5 auction pin\n`;
    body += `  §8  §fP2 #8 first-topup bonus\n\n`;
  } else {
    body += `  §a✓ §f${reach.pct.toFixed(1)}%% §8(>30%%)\n`;
    body += `  §8└ §fFokus §aRETENSI\n`;
    body += `  §8  §fP3 #12 premium pass\n`;
    body += `  §8  §fP3 #9 leaderboard opt-in\n\n`;
  }

  // Skew
  body += `  §e▼ SKEW DISTRIBUSI\n`;
  body += `${HR_THIN}\n`;
  if (gemDist.nonzero === 0) {
    body += `  §7Belum ada holder.\n\n`;
  } else {
    const skew = gemDist.median > 0 ? gemDist.p99 / gemDist.median : Infinity;
    const skewStr = Number.isFinite(skew) ? skew.toFixed(0) + "×" : "∞";
    if (!Number.isFinite(skew) || skew > 50) {
      body += `  §c⚠ p99/p50 = ${skewStr}\n`;
      body += `  §8└ §fHindari leaderboard publik\n`;
      body += `  §8  §f(whale dominasi tinggi)\n\n`;
    } else if (skew > 10) {
      body += `  §e⚠ p99/p50 = ${skewStr}\n`;
      body += `  §8└ §fLeaderboard opt-in OK\n\n`;
    } else {
      body += `  §a✓ p99/p50 = ${skewStr}\n`;
      body += `  §8└ §fDistribusi sehat\n\n`;
    }
  }

  // Flow / utility
  body += `  §e▼ UTILITAS GEM\n`;
  body += `${HR_THIN}\n`;
  const sinkLand    = Math.abs(flow.land_buy_gem || 0);
  const sinkGacha   = Math.abs(flow.gacha_gem_cost || 0);
  const topupIn     = flow.topup || 0;
  const firstBonus  = flow.topup_first_bonus || 0;
  const gemRefund   = flow.gacha_gem_refund || 0;
  const totalSink   = sinkLand + sinkGacha;
  const totalSource = topupIn + firstBonus + gemRefund;
  if (totalSink === 0 && totalSource === 0) {
    body += `  §7Belum ada flow gem di window\n`;
    body += `  §7§8(window ≤5 menit)\n\n`;
  } else {
    body += `  §8┃ topup     §8── §a+${_fmt(topupIn)}\n`;
    if (firstBonus > 0)
      body += `  §8┃ 1st bonus §8── §a+${_fmt(firstBonus)}\n`;
    body += `  §8┃ land      §8── §c-${_fmt(sinkLand)}\n`;
    body += `  §8┃ gacha     §8── §c-${_fmt(sinkGacha)}\n`;
    body += `  §8┃ refnd     §8── §a+${_fmt(gemRefund)}\n`;
    if (topupIn > 0 && totalSink === 0) {
      body += `  §e⚠ Gem masuk tapi tidak terpakai\n`;
      body += `  §8└ §fCek utilitas — mungkin\n`;
      body += `  §8  §fperlu §eEXPAND SINK §f(P2)\n`;
    }
    body += `\n`;
  }

  // Topup activity today
  body += `  §e▼ TOPUP HARI INI\n`;
  body += `${HR_THIN}\n`;
  if (topup.gem.players === 0) {
    body += `  §c⚠ Belum ada topup gem hari ini\n`;
    body += `  §8└ §fCek funnel: apakah ada\n`;
    body += `  §8  §fissue di queue Supabase?\n\n`;
  } else {
    body += `  §a✓ ${topup.gem.players} player topup\n`;
    body += `  §8└ §fTotal +${_fmt(topup.gem.total)} gem\n\n`;
  }

  body += `${HR}`;

  const form = new ActionFormData()
    .title("§8 ♦ §aDIAGNOSIS§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .button("§8  Tutup", "textures/items/redstone_dust");

  const res = await form.show(player);
  if (res.canceled || res.selection === 1) return;
  if (res.selection === 0) return showBaselineSummary(player);
}

// ══════════════════════════════════════════════════════════════
// ANALYSIS HELPERS
// ══════════════════════════════════════════════════════════════
function _analyzeDistribution(reg, onlineMap, currency) {
  const balances = [];
  let zero = 0, nonzero = 0, total = 0;
  for (const info of Object.values(reg)) {
    if (!info?.name) continue;
    const live = onlineMap.get(info.name);
    const bal = live !== undefined ? live[currency] : (info?.[currency] ?? 0);
    if (typeof bal !== "number" || !Number.isFinite(bal)) continue;
    balances.push(bal);
    if (bal > 0) { nonzero++; total += bal; } else { zero++; }
  }
  balances.sort((a, b) => a - b);
  return {
    n:      balances.length,
    nonzero, zero, total,
    avg:    balances.length > 0 ? Math.round(total / balances.length) : 0,
    avgNz:  nonzero > 0 ? Math.round(total / nonzero) : 0,
    median: _percentile(balances, 0.50),
    p75:    _percentile(balances, 0.75),
    p90:    _percentile(balances, 0.90),
    p99:    _percentile(balances, 0.99),
    max:    balances[balances.length - 1] || 0,
  };
}

function _analyzeReach(gemDist) {
  const total = gemDist.n;
  const everHeld = gemDist.nonzero;
  return { total, everHeld, pct: total > 0 ? (everHeld / total * 100) : 0 };
}

function _readFlowSnapshot() {
  const merged = {};
  try {
    const raw = world.getDynamicProperty(FLOW_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed || {})) {
        if (typeof v === "number" && Number.isFinite(v)) merged[k] = (merged[k] || 0) + v;
      }
    }
  } catch {}
  try {
    const sb = world.scoreboard.getObjective("_eco_flow");
    if (sb) {
      for (const k of ["land_buy", "land_ppn", "land_refund", "land_buy_gem"]) {
        try {
          const v = sb.getScore(k);
          if (typeof v === "number" && v !== 0) merged[k] = (merged[k] || 0) + v;
        } catch {}
      }
    }
  } catch {}
  return merged;
}

function _scanTopupToday() {
  const today = Math.floor(Date.now() / MS_PER_DAY);
  const todayPrefix = TOPUP_DAILY_PFX + today + ":";
  const stats = { gem: { players: 0, total: 0 }, coin: { players: 0, total: 0 } };
  try {
    for (const id of world.getDynamicPropertyIds()) {
      if (!id.startsWith(todayPrefix)) continue;
      const after = id.substring(todayPrefix.length);
      const colonIdx = after.indexOf(":");
      if (colonIdx < 0) continue;
      const slot = stats[after.substring(0, colonIdx)];
      if (!slot) continue;
      const amount = dpGet(id, 0);
      if (typeof amount === "number" && amount > 0) {
        slot.players += 1;
        slot.total   += amount;
      }
    }
  } catch (e) {
    console.warn("[Baseline] _scanTopupToday error:", e);
  }
  return stats;
}

function _topHolders(reg, onlineMap, currency, n) {
  const arr = [];
  for (const info of Object.values(reg)) {
    if (!info?.name) continue;
    const live = onlineMap.get(info.name);
    const bal = live !== undefined ? live[currency] : (info?.[currency] ?? 0);
    if (typeof bal === "number" && bal > 0) arr.push({ name: info.name, bal });
  }
  arr.sort((a, b) => b.bal - a.bal);
  return arr.slice(0, n);
}

function _buildOnlineMap() {
  const map = new Map();
  try {
    const gemSb  = world.scoreboard.getObjective(GEM_OBJ);
    const coinSb = world.scoreboard.getObjective(COIN_OBJ);
    for (const p of world.getPlayers()) {
      map.set(p.name, { gem: _safeScore(gemSb, p), coin: _safeScore(coinSb, p) });
    }
  } catch {}
  return map;
}

function _safeScore(obj, entity) {
  if (!obj) return 0;
  try { return obj.getScore(entity) ?? 0; } catch { return 0; }
}

function _percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p));
  return sortedArr[idx] || 0;
}

// ══════════════════════════════════════════════════════════════
// RENDER HELPERS
// ══════════════════════════════════════════════════════════════
function _renderFlowBucket(flow, keys, emptyMsg) {
  const rows = keys
    .filter(k => flow[k] !== undefined && flow[k] !== 0)
    .sort((a, b) => Math.abs(flow[b]) - Math.abs(flow[a]));
  if (rows.length === 0) return emptyMsg;
  let s = "";
  for (const k of rows) {
    const v = flow[k];
    const color = v >= 0 ? "§a+" : "§c";
    const label = k.padEnd(14, " ");
    s += `  §8├ §f${label} §8── ${color}${_fmt(v)}\n`;
  }
  return s;
}

function _diagnoseShort(snap) {
  const { reach, gemDist, flow, topup } = snap;
  const out = [];

  if (reach.pct < 10)        out.push("§c⚠ §fPenetrasi <10%% — fokus §cAWARENESS");
  else if (reach.pct < 30)   out.push("§e⚠ §fPenetrasi 10-30%% — fokus §eKONVERSI");
  else                        out.push("§a✓ §fPenetrasi >30%% — fokus §aRETENSI");

  if (gemDist.nonzero > 0) {
    const skew = gemDist.median > 0 ? gemDist.p99 / gemDist.median : Infinity;
    if (!Number.isFinite(skew) || skew > 50)
      out.push(`§c⚠ §fSkew p99/p50 = ${Number.isFinite(skew) ? skew.toFixed(0)+"×" : "∞"} §8whale heavy`);
    else if (skew > 10)
      out.push(`§e⚠ §fSkew p99/p50 = ${skew.toFixed(0)}× §8moderate`);
    else
      out.push(`§a✓ §fSkew p99/p50 = ${skew.toFixed(0)}× §8sehat`);
  }

  if (topup.gem.players === 0) out.push("§7• Belum ada topup gem hari ini");
  const gemSink = Math.abs(flow.land_buy_gem || 0) + Math.abs(flow.gacha_gem_cost || 0);
  if ((flow.topup || 0) > 0 && gemSink === 0)
    out.push("§e• §fGem masuk tapi tidak terpakai");

  return out;
}

// ── Anonimisasi nama → inisial 4 char (privacy) ──
function _toInitials(name) {
  if (!name) return "????";
  const trimmed = name.trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.substring(0, 2) + ".." + trimmed.substring(trimmed.length - 1);
}

// ── Number formatter ──
function _fmt(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000)     return sign + (abs / 1_000).toFixed(1) + "k";
  return sign + abs.toString();
}

function _logToConsole(snap) {
  const { reach, gemDist, flow, topup, welcome, elapsed } = snap;
  const w = welcome || {};
  console.log(
    `[Baseline] reg=${reach.total} gemHolders=${reach.everHeld} (${reach.pct.toFixed(1)}%) ` +
    `gemAvg=${gemDist.avg} gemP50=${gemDist.median} gemP90=${gemDist.p90} gemP99=${gemDist.p99} ` +
    `topupToday=${topup.gem.players}p/${topup.gem.total}g ` +
    `flowKeys=${Object.keys(flow).length} ` +
    `welc=${(w.welcome_first || 0) + (w.welcome_update || 0)}/${w.guide_open || 0}/${w.gem_panel_open || 0} ` +
    `elapsed=${elapsed}ms`
  );
}
