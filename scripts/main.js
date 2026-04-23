// ============================================================
// EconomyAddon — scripts/main.js
// ============================================================

import { world, system } from "@minecraft/server";
import { trackPlayer, startMonitoring } from "./dp_manager.js";

import "./MobuXP/main.js";
import "./gacha/main.js";
import "./Bank/main.js";
import "./auction/main.js";
import "./daily/main.js";
import "./Combat/main.js";
import { handleWelcome } from "./welcome.js";

startMonitoring();

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try { trackPlayer(player.id); } catch {}
  }, 10);

  // Welcome guide — delay lebih lama agar muncul setelah daily login & notif lain
  system.runTimeout(() => {
    try {
      const live = world.getPlayers().find(p => p.id === player.id);
      if (live) handleWelcome(live);
    } catch {}
  }, 160);
});

console.log("[Economy] Loaded | MobuXP, Gacha, Bank, Auction, Daily, Combat, Welcome");

