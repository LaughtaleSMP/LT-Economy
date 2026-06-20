// ============================================================
// store/main.js — Entry point Store module
//
// REGISTRATION:
// - Command /lt:store
// - Command alias /store (via item trigger opsional di masa depan)
// - Event cleanup saat player leave
// - Flush loop (batched DP write setiap 20s)
// ============================================================

import { world, system, CommandPermissionLevel, ItemStack } from "@minecraft/server";
import { CFG, isStoreEnabled, setStoreEnabled } from "./config.js";
import { openStoreMenu } from "./ui.js";
import {
  checkCooldown, setCooldown, activeSessions, onPlayerLeave as onLeaveHelpers,
} from "./helpers.js";
import { startFlushLoop, flushOnLeave, invalidateStorageCache } from "./storage.js";
import { validateCatalog } from "./catalog.js";
import { isPurgeActive } from "../purge_gate.js";

// ═══════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name:            "lt:store",
        description:     "Buka Store (bahan build)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(async () => {
          try {
            const { isFeatureOnNPC } = await import("../npc/market.js");
            if (isFeatureOnNPC("store")) {
              player.sendMessage("§8[Sistem]§c Fitur ini tersedia lewat NPC.\n§7Kunjungi NPC di spawn untuk mengakses Store.");
              return;
            }
          } catch {}
          // Fallback: jika tidak ada NPC, buka langsung
          if (isPurgeActive()) { player.sendMessage("§8[Sistem] §cPilar Energi offline — store tidak tersedia."); return; }
          const { openStoreMenu } = await import("./ui.js");
          openStoreMenu(player).catch(() => {});
        });
        return { status: 0 };
      }
    );

    // ── ADMIN: Kill switch toggle ──
    init.customCommandRegistry.registerCommand(
      {
        name:            "lt:store_toggle",
        description:     "Aktifkan/nonaktifkan Store (Admin)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(CFG.ADMIN_TAG)) {
          system.run(() => player.sendMessage("§8[§cStore§8]§c Akses ditolak."));
          return;
        }
        const cur = isStoreEnabled();
        setStoreEnabled(!cur);
        const newState = !cur;
        system.run(() => {
          player.sendMessage(
            `§8[§aStore§8]§a Store sekarang §f${newState ? "§aAKTIF" : "§cNONAKTIF"}§a.\n` +
            `§7 Player ${newState ? "§abisa" : "§ctidak bisa"} §7buka /store.`
          );
          if (!newState) {
            try { world.sendMessage("§8[§eStore§8]§e Toko sementara ditutup oleh admin."); } catch {}
          }
        });
        return { status: 0 };
      }
    );

    // ── ADMIN: Reset semua data Store (untuk testing) ──
    init.customCommandRegistry.registerCommand(
      {
        name:            "lt:store_reset",
        description:     "Hapus semua data Store (Admin, irreversible)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag(CFG.ADMIN_TAG)) {
          system.run(() => player.sendMessage("§8[§cStore§8]§c Akses ditolak."));
          return;
        }
        system.run(() => resetAllStoreData(player));
        return { status: 0 };
      }
    );
  } catch (e) {
    console.warn("[Store] Command registration failed:", e);
  }
});

// ═══════════════════════════════════════════════════════════
// CLEANUP ON LEAVE
// ═══════════════════════════════════════════════════════════

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  try { onLeaveHelpers(playerId); } catch {}
  try { flushOnLeave(playerId); } catch {}
});

// ═══════════════════════════════════════════════════════════
// START FLUSH LOOP — batched DP writes
// ═══════════════════════════════════════════════════════════
startFlushLoop();

// ═══════════════════════════════════════════════════════════
// VALIDATE CATALOG — hapus item ID invalid agar tidak crash runtime
// Delay startup sedikit agar ItemStack constructor ready.
// ═══════════════════════════════════════════════════════════
system.runTimeout(() => {
  try {
    const { valid, invalid } = validateCatalog(ItemStack);
    if (invalid.length > 0) {
      console.warn(`[Store] ${invalid.length} item ID invalid (skipped): ${invalid.join(", ")}`);
    }
  } catch (e) {
    console.warn("[Store] Catalog validation failed:", e);
  }
}, 40); // 2 detik setelah load


// ═══════════════════════════════════════════════════════════
// ADMIN UTILITY: Reset all Store data
// Hapus SEMUA data Store (worldDP + playerDP untuk semua online player).
// Berguna untuk testing di dev server atau emergency rollback.
// ═══════════════════════════════════════════════════════════
function resetAllStoreData(admin) {
  try {
    // 1. World DP — store:audit dan legacy fallback keys
    try { world.setDynamicProperty("store:audit", undefined); } catch {}
    // NOTE: store:enabled SENGAJA TIDAK DIHAPUS (preservasi kill switch state)

    // 2. Scan world DP untuk legacy fallback keys (format: "store:daily<playerId>")
    // pSet() di player_dp.js fallback ke world DP jika player DP gagal.
    let worldLegacy = 0;
    try {
      for (const id of world.getDynamicPropertyIds()) {
        if (id === "store:audit" || id === "store:enabled") continue;
        if (id.startsWith("store:daily") || id.startsWith("store:stats")) {
          try { world.setDynamicProperty(id, undefined); worldLegacy++; } catch {}
        }
      }
    } catch {}

    // 3. Player DP — iterate semua player online, hapus store:daily & store:stats
    let cleaned = 0;
    for (const p of world.getPlayers()) {
      try {
        p.setDynamicProperty("store:daily", undefined);
        p.setDynamicProperty("store:stats", undefined);
        cleaned++;
      } catch {}
    }

    // 4. Invalidate in-memory cache (cegah flush ulang data lama)
    try { invalidateStorageCache(); } catch {}

    admin.sendMessage(
      `§8[§aStore§8]§a Reset selesai.\n` +
      `§7 Player DP      : §f${cleaned} player online dibersihkan\n` +
      `§7 World DP audit : §fdibersihkan\n` +
      `§7 World DP legacy: §f${worldLegacy} key fallback dibersihkan\n` +
      `§7 In-mem cache   : §fdiinvalidate\n` +
      `§7 Kill switch    : §fTIDAK disentuh (${isStoreEnabled() ? "§aAKTIF" : "§cNONAKTIF"}§7)\n` +
      `§c§l NOTE: §cplayer offline akan auto-clean saat login lagi (period check).`
    );
  } catch (e) {
    admin.sendMessage(`§8[§cStore§8]§c Reset gagal: ${e.message || e}`);
    console.warn("[Store] resetAllStoreData:", e);
  }
}
