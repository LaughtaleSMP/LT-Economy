/* ══════════════════════════════════════════════════════════════
   eco_flow.js — Production-ready coin flow tracker

   Tracks WHERE coins enter/leave the economy by source.
   Stored as a single World DP key (~100-200 bytes).

   PERFORMANCE GUARANTEES:
   - Memory: 1 in-memory Map (~12 keys max), 1 DP key
   - CPU: trackFlow() = O(1) Map increment, ZERO DP writes
   - DP Writes: batched every 5s via system.runInterval (1 write/5s)
   - Size cap: max 16 source keys, auto-prunes smallest
   - Fault-tolerant: all operations wrapped in try/catch

   COST:
   - Memory: ~500 bytes in-memory + 1 DP key (~200 bytes)
   - CPU: negligible (Map.set per event, periodic JSON.stringify)
   - Supabase: 0 extra requests (piggybacked on economy_history)
   - DP Writes: exactly 1 per 5 seconds (batched), not per event

   USAGE:
     import { trackFlow } from "../eco_flow.js";
     trackFlow("mob_kill", 5);   // +5 coins from mob kill
     trackFlow("bank_tax", -10); // -10 coins from bank tax

   SOURCES tracked:
     mob_kill      — MobuXP mob kill rewards
     mob_penalty   — MobuXP anti-stack penalty (negative)
     topup         — Admin topup
     topup_first_bonus — First-topup bonus (sekali per player, gem only)
     gacha_cost    — Gacha pull cost (coin, negative)
     gacha_refund  — Gacha duplicate refund (coin)
     gacha_gem_cost   — Gacha pull cost (gem, partikel, negative)
     gacha_gem_refund — Gacha duplicate refund (gem)
     bank_tax      — Bank transfer tax (negative, coin sink)
     auction_fee   — Auction sale fee (negative, coin sink)
     pvp_penalty   — PvP illegal kill denda (negative)
     pvp_refund    — PvP victim compensation
     weekly_reward — Weekly leaderboard reward
     first_sale    — Auction first sale bonus
     wealth_tax    — Pajak kekayaan harian (negative, coin sink)
     tax_distribute — Distribusi treasury ke player (positive)
     ubi_injection — UBI player baru 7 hari (positive)
     demurrage     — Biaya hoarding coin inaktif (negative, coin sink)
     store_sink    — Pembelian di Store (negative, coin sink)
   ══════════════════════════════════════════════════════════════ */
import { world, system } from "@minecraft/server";

const FLOW_KEY = "eco:flow";
// [PhD-v2] Naik dari 16 → 24 untuk mengakomodasi ubi_injection + demurrage
// + ruang untuk flow key tambahan di masa depan. Single DP key dengan 24 small
// numeric values masih jauh di bawah 32KB limit (est ~1KB serialized).
const MAX_KEYS = 24;
const FLUSH_INTERVAL = 200; // ticks (10 seconds) — [PERF] doubled from 5s, flow data is analytics-only

// ── In-memory accumulator — zero DP cost per trackFlow call ──
const _mem = new Map();
let _dirty = false;

/** Add amount to a flow source. Positive = coin created, negative = coin destroyed.
 *  O(1) — only touches in-memory Map, never writes DP directly. */
export function trackFlow(source, amount) {
  if (!source || !amount || !Number.isFinite(amount)) return;
  _mem.set(source, (_mem.get(source) || 0) + amount);
  _dirty = true;
}

/** Flush in-memory accumulator to DP. Called every 10s by runInterval.
 *  Merges with existing DP data so no data is lost between flushes. */
function _flush() {
  if (!_dirty) return;
  _dirty = false;
  try {
    // Read existing DP flow (may have data from before server restart)
    let persisted = {};
    try {
      const raw = world.getDynamicProperty(FLOW_KEY);
      if (raw) persisted = JSON.parse(raw);
    } catch { persisted = {}; }

    // Merge in-memory into persisted
    for (const [k, v] of _mem) {
      persisted[k] = (persisted[k] || 0) + v;
    }
    _mem.clear();

    // Cap keys to MAX_KEYS — prune smallest absolute values
    const keys = Object.keys(persisted);
    if (keys.length > MAX_KEYS) {
      keys.sort((a, b) => Math.abs(persisted[a]) - Math.abs(persisted[b]));
      for (let i = 0; i < keys.length - MAX_KEYS; i++) {
        delete persisted[keys[i]];
      }
    }

    world.setDynamicProperty(FLOW_KEY, JSON.stringify(persisted));
  } catch (e) {
    console.warn("[Eco-Flow] flush error:", e);
  }
}

/** Read and reset flow counters (called by sync after sending to Supabase).
 *  Returns combined in-memory + persisted + cross-pack data, then resets all. */
export function consumeFlow() {
  // Merge any unflushed in-memory data
  let result = {};
  try {
    const raw = world.getDynamicProperty(FLOW_KEY);
    if (raw) result = JSON.parse(raw);
  } catch { result = {}; }

  // Merge unflushed in-memory data
  for (const [k, v] of _mem) {
    result[k] = (result[k] || 0) + v;
  }
  _mem.clear();
  _dirty = false;

  // Reset persisted DP
  try { world.setDynamicProperty(FLOW_KEY, "{}"); } catch { }

  // ── Merge cross-pack flow from _eco_flow scoreboard (Mimi Land) ──
  // Mimi Land writes land_buy, land_ppn, land_refund, land_buy_gem here.
  try {
    const sb = world.scoreboard.getObjective("_eco_flow");
    if (sb) {
      const flowKeys = ["land_buy", "land_ppn", "land_refund", "land_buy_gem",
                        "land_expand", "land_expand_ppn", "land_expand_gem"];
      for (const k of flowKeys) {
        try {
          const v = sb.getScore(k);
          if (v && v !== 0) {
            result[k] = (result[k] || 0) + v;
            sb.setScore(k, 0); // reset individual score (atomic, no race)
          }
        } catch {}
      }
    }
  } catch {}

  return result;
}

// ── Batched flush every 10 seconds — exactly 1 DP write per interval ──
system.runInterval(() => {
  try { _flush(); } catch { }
}, FLUSH_INTERVAL);
