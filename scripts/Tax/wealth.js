// ============================================================
// Tax/wealth.js — Wealth Tax (Pajak Kekayaan) — Entry point
//
// SLO: collect cycle runs exactly once per UTC day. Treasury writes
//      verified read-after-write. No silent data loss tolerated.
//
// Tiers: > 5k (-0.5%), > 20k (-1.0%), > 50k (-2.0%) per day.
// Treasury auto-distributes to bottom 50% (weighted inverse-balance).
//
// Layout: wealth_state (data), _collect (tax), _distribute (subsidy),
//         _admin (UI). DP keys: tax:wealth_period, tax:treasury, tax:notif:*
// ============================================================

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { trackFlow } from "../eco_flow.js";

import {
  CHECK_INTERVAL, ADMIN_TAG,
  refreshTreasuryCache, drainOfflineNotifs,
  drainTreasury, flushSubsidyDrain, restoreSubsidyDrain,
} from "./wealth_state.js";
import { collectWealthTax } from "./wealth_collect.js";
import { showTaxAdmin } from "./wealth_admin.js";

// ── Re-export public API untuk konsumen lain ────────────────
// Konsumen: daily/ui.js, MobuXP/xp/xp_manager.js, leaderboard/sync.js
export {
  TAX_TIERS, SUBSIDY_CFG,
  getTreasury, drainTreasury,
  isSubsidyEligible, trySubsidize, applySubsidy,
  drainOfflineNotifs,
} from "./wealth_state.js";
export { autoDistributeTreasury } from "./wealth_distribute.js";

// ── Subsidy flush — batched DP write setiap 20 detik ────────
// Zero DP writes per individual kill/quest event.
system.runInterval(() => {
  const drain = flushSubsidyDrain();
  if (drain <= 0) return;
  try {
    drainTreasury(drain);
    trackFlow("tax_distribute", drain);
    refreshTreasuryCache();
  } catch (e) {
    console.warn("[WealthTax] subsidy flush error (retry next cycle):", e);
    // Restore agar di-flush ulang siklus berikutnya
    restoreSubsidyDrain(drain);
  }
}, 400); // 20 detik

// ── Scheduler — cek tiap 5 menit (collect hanya 1× per hari) ─
system.runTimeout(() => {
  refreshTreasuryCache(); // init cache on startup
  try { collectWealthTax(); }
  catch (e) { console.warn("[WealthTax] startup:", e); }

  system.runInterval(() => {
    try { collectWealthTax(); }
    catch (e) { console.warn("[WealthTax] interval:", e); }
  }, CHECK_INTERVAL);
}, 600); // 30 detik delay startup

// ── Drain notif offline saat player spawn ───────────────────
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  // Delay 4 detik supaya tidak tabrakan dengan daily login notif
  system.runTimeout(() => {
    try {
      const notifs = drainOfflineNotifs(player.name);
      for (const msg of notifs) player.sendMessage(msg);
    } catch {}
  }, 80);
});

// ── Perintah Admin: /lt:tax ─────────────────────────────────
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  try {
    customCommandRegistry.registerCommand(
      {
        name:            "lt:tax",
        description:     "Lihat dan kelola Treasury Pajak Kekayaan (Admin)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(ADMIN_TAG)) {
          system.run(() => player.sendMessage("§8[§cTax§8]§c Akses ditolak."));
          return;
        }
        system.run(() => showTaxAdmin(player));
        return { status: 0 };
      }
    );
  } catch (e) {
    console.warn("[WealthTax] Command reg gagal:", e);
  }
});

// ── Cleanup notif expired ───────────────────────────────────
// Tidak perlu — notif di-drain saat spawn dan di-cap max 5 per player.
// DP key hanya dibuat saat offline kena pajak, jadi tidak bisa grow tanpa batas.
