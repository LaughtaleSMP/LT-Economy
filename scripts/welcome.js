// welcome.js — Welcome Guide System (orchestrator)
// Login handler + /guide command + main menu router.
// Guide pages dipisah ke folder welcome/ supaya patuh iron rule ≤500 baris.

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { UIClose } from "./ui_close.js";
import { pGetRaw, pSetRaw } from "./player_dp.js";
import { bumpMetric } from "./welcome_metrics.js";
import {
  isEidActive, getEidTimeLeft,
  getEidQuestInfo, getToken, getEidQuestReset, getQuestDayLabel,
} from "./eid_quest.js";
import { getKillFx } from "./kill_fx.js";
import { CFG } from "./Combat/config.js";
import { HR } from "./welcome/_shared.js";
import {
  TOPUP_URL,
  FIRST_TOPUP_DISPLAY_PCT,
  FIRST_TOPUP_MULTIPLIER,
} from "./topup_info.js";
import {
  guideBank, guideAuction, guideDaily, guideStore, guideEconomy,
} from "./welcome/economy.js";
import {
  guideGacha, guideTreecap, guideLand, guideCombat, guideLeaderboard, guideDragon, guideEvent,
} from "./welcome/systems.js";
import { guideCommands } from "./welcome/commands.js";
import { guideGem } from "./welcome/gem.js";
import { getChatVerifiedInfo } from "./leaderboard/sync_chat.js";
import { getCoin } from "./auction/utils/helpers.js";

// ═══════════════════════════════════════════════════════════
// KONFIGURASI
// ═══════════════════════════════════════════════════════════
const K_WELCOME_SEEN = "welcome:seen:";    // legacy timestamp (v1)
const K_WELCOME_VER = "welcome:ver:";     // current seen version (v2+)
const WIB_OFFSET_MS = 7 * 3_600_000;      // UTC+7

// Bump nilai ini setiap rilis fitur besar. Player yang punya version lama
// (atau hanya legacy K_WELCOME_SEEN tanpa K_WELCOME_VER) akan dapat re-trigger
// welcome guide sekali untuk lihat fitur baru.
//
// Changelog versi:
//   2 — 2026-05: Gem Premium panel (diskon land 99%, first-topup bonus +50%)
//   3 — 2026-05: First-topup bonus naik ke +100% (Gem ×2, promo permanen)
//   4 — 2026-05: Event Eid Adha — Quest Token + KillFX syarat token
const WELCOME_VER = 4;

// Banner "What's new" — ditampilkan saat re-trigger karena version mismatch.
const WELCOME_VER_HIGHLIGHTS = {
  2: [
    "§dGem Premium §8─ §fdiskon land §b99%%§f & skin gacha",
    "§a✦ §fTopup gem pertama §a+50%% bonus §8(promo permanen)",
  ],
  3: [
    `§a✦ §lTopup pertama §r§a= GEM ×${FIRST_TOPUP_MULTIPLIER}§f §8(promo upgrade dari +50%%)`,
    `§7Bayar §b1× §7gem, terima §a${FIRST_TOPUP_MULTIPLIER}× §7gem — sekali, gem only`,
  ],
  4: [
    `§6◆ §lEvent Eid Adha §r§6— Quest aktif!`,
    `§7Kill §f50 Sapi§7, §f50 Domba§7, §f50 Kambing §7= §6Shard`,
    `§7Shard dibutuhkan untuk beli §dKill Effect§7. Reset jam §e08:00 WIB`,
  ],
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/** Time-aware WIB greeting based on current hour. */
function _getWIBGreeting() {
  const h = new Date(Date.now() + WIB_OFFSET_MS).getUTCHours();
  if (h >= 4 && h < 11) return "Selamat Pagi";
  if (h >= 11 && h < 15) return "Selamat Siang";
  if (h >= 15 && h < 18) return "Selamat Sore";
  return "Selamat Malam";
}

/** Mini 5-segment progress bar for quest display. */
function _miniBar(current, target) {
  const filled = Math.min(5, Math.floor((current / Math.max(1, target)) * 5));
  let bar = "§8[";
  for (let i = 0; i < 5; i++) bar += i < filled ? "§a█" : "§7░";
  return bar + "§8]";
}

/** Build dynamic MENU array — promotes Event when active. */
function _buildMenu(eventActive, shardCount) {
  const eventLabel = eventActive
    ? `§6  Event & Shard §a⚡AKTIF\n§r  §6◆ ${shardCount} Shard §8— §eQuest & Kill Effect`
    : `§6  Event & Shard\n§r  §eQuest - Shard - Kill Effect`;

  const items = [
    { key: "bank", handler: guideBank, icon: "textures/items/gold_ingot", label: "§6  Bank Koin\n§r  §eTransfer, request, leaderboard" },
    { key: "auction", handler: guideAuction, icon: "textures/items/emerald", label: "§e  Auction House\n§r  §eJual beli item antar player" },
    { key: "daily", handler: guideDaily, icon: "textures/items/clock_item", label: "§b  Daily Quest\n§r  §eLogin, quest, achievement" },
  ];

  // Promote event to top-4 when active for maximum visibility
  if (eventActive) {
    items.push({ key: "event", handler: guideEvent, icon: "textures/items/gold_nugget", label: eventLabel });
  }

  items.push(
    { key: "gacha", handler: guideGacha, icon: "textures/items/nether_star", label: "§d  Gacha System\n§r  §ePartikel & peralatan random" },
    { key: "gem", handler: guideGem, icon: "textures/items/diamond", label: "§d  Gem Premium\n§r  §eDiskon land 99% & skin eksklusif", metric: "gem_panel_open" },
    { key: "treecap", handler: guideTreecap, icon: "textures/items/diamond_axe", label: "§a  Tree Capitator\n§r  §eTebang pohon otomatis" },
    { key: "land", handler: guideLand, icon: "textures/items/map_empty", label: "§2  Mimi Land\n§r  §eKlaim & lindungi area" },
    { key: "combat", handler: guideCombat, icon: "textures/items/diamond_sword", label: "§c  Combat PvP\n§r  §ePvP sistem dengan koin" },
    { key: "leaderboard", handler: guideLeaderboard, icon: "textures/items/diamond", label: "§6  Leaderboard\n§r  §eTop mingguan, reward koin" },
    { key: "store", handler: guideStore, icon: "textures/blocks/emerald_block", label: "§6  Store Bahan Build\n§r  §eBeli blok & utility dengan tier harian" },
  );

  // Event at lower position when inactive
  if (!eventActive) {
    items.push({ key: "event", handler: guideEvent, icon: "textures/items/gold_nugget", label: eventLabel });
  }

  items.push(
    { key: "economy", handler: guideEconomy, icon: "textures/items/gold_nugget", label: "§d  Kebijakan Ekonomi\n§r  §ePajak, subsidi, stimulus" },
    { key: "commands", handler: guideCommands, icon: "textures/items/paper", label: "§f  Semua Command\n§r  §eDaftar lengkap command" },
    { key: "dragon", handler: guideDragon, icon: "textures/items/elytra", label: "§5  Dragon Update\n§r  §eElytra, Boss Fight, Cooldown" },
  );

  return items;
}

// ═══════════════════════════════════════════════════════════
// WELCOME CHAT MESSAGE — ditampilkan saat login
// ═══════════════════════════════════════════════════════════
async function sendWelcomeChat(player, mode) {
  const timeGreet = _getWIBGreeting();
  let greeting;
  if (mode === "first") greeting = `§8[§eLaughtale§8] §fSelamat datang, §a${player.name}§f!`;
  else if (mode === "update") greeting = `§8[§eLaughtale§8] §fSelamat datang, §a${player.name}§f! §e(Update Baru)`;
  else greeting = `§8[§eLaughtale§8] §fSelamat datang, §a${player.name}§f!`;

  let updateBanner = "";
  if (mode === "update") {
    const highlights = WELCOME_VER_HIGHLIGHTS[WELCOME_VER] || [];
    if (highlights.length > 0) {
      updateBanner = `\n  §6✦ §lYANG BARU:§r`;
      for (const h of highlights) updateBanner += `\n  §8│  §f${h}`;
      updateBanner += `\n`;
    }
  }

  // Dynamic event section — only show when active
  let eventSection = "";
  if (isEidActive()) {
    const tl = getEidTimeLeft();
    eventSection =
      `\n  §6◆ §lEvent Eid Adha§r §a— AKTIF` +
      `\n  §8├ §7Kill §f50 Sapi §8= §6+1 Shard` +
      `\n  §8├ §7Kill §f50 Domba §8= §6+1 Shard` +
      `\n  §8├ §7Kill §f50 Kambing §8= §6+1 Shard` +
      `\n  §8├ §7Shard → beli §dKill Effect §8(permanen)` +
      `\n  §8└ §eSisa: §f${tl ?? "-"} §8│ §eReset §f08:00 WIB` +
      `\n`;
  }

  // Live Chat verified info (async, non-blocking)
  let chatLine = "";
  try {
    const chatInfo = await getChatVerifiedInfo(player.name);

    const koin = getCoin(player);
    const koinStr = koin.toLocaleString("id-ID");

    chatLine = `\n  §7Saldo: §e${koinStr} Koin`;
    if (chatInfo.verified) {
      chatLine += ` §7| Pesan web: §a${chatInfo.webCount} baru`;
    } else {
      chatLine += ` §7| §eKetik §a/auth §eutk Live Chat`;
    }
  } catch { }

  player.sendMessage(
    `\n§8═══════════════════════` +
    `\n§6    L A U G H T A L E` +
    `\n§7     Survival  M P` +
    `\n§8═══════════════════════` +
    `\n§r  ${greeting}` +
    updateBanner +
    `\n` +
    `\n  §e✦ §lFITUR SERVER§r` +
    `\n  §8├ §6Bank Koin    §8── §f/bank` +
    `\n  §8├ §eAuction House §8── §6NPC Market` +
    `\n  §8├ §6Store Build  §8── §6NPC Market` +
    `\n  §8├ §bDaily Quest   §8── §f/daily` +
    `\n  §8├ §dGacha System  §8── §6NPC Market` +
    `\n  §8├ §dGem Premium   §8── §fDiskon land §b99%%§f & skin` +
    `\n  §8├ §aTree Cap      §8── §fTebang pohon otomatis` +
    `\n  §8├ §2Mimi Land     §8── §fGunakan item §2Mimi Land` +
    `\n  §8├ §cCombat PvP    §8── §fKetik §c/pvp` +
    `\n  §8└ §6Leaderboard   §8── §fLihat hologram spawn` +
    eventSection +
    `\n` +
    `\n  §a✦ §fTopup pertama §a= GEM ×${FIRST_TOPUP_MULTIPLIER} §f(promo permanen)` +
    `\n  §8└ §eTopup §8── §b${TOPUP_URL}` +
    chatLine +
    `\n  §8Ketik §e/guide §8untuk panduan lengkap.` +
    `\n§8═══════════════════════\n`
  );
}

// ═══════════════════════════════════════════════════════════
// WELCOME GUIDE UI — main menu router
// ═══════════════════════════════════════════════════════════
async function openWelcomeGuide(player) {
  bumpMetric("guide_open");
  while (true) {
    // Fetch live data for personalization
    const eventActive = isEidActive();
    let shardCount = 0;
    try { shardCount = getToken(player); } catch { }

    const timeGreet = _getWIBGreeting();
    let body = `${HR}\n`;
    body += `§6  ★ P A N D U A N   S E R V E R\n`;
    body += `${HR}\n\n`;
    body += `  §f${timeGreet}, §6${player.name}§f!\n`;
    body += `  §fServer ini dilengkapi berbagai\n`;
    body += `  §ffitur premium untuk pengalaman\n`;
    body += `  §fbermain yang lebih seru.\n\n`;

    // Live event status in guide body
    if (eventActive) {
      const tl = getEidTimeLeft();
      body += `  §6◆ §aEvent Eid Adha §8— §aAKTIF\n`;
      body += `  §8  Sisa: §e${tl ?? "-"} §8│ §6Shard: §f${shardCount}\n\n`;
    }

    body += `  §8Pilih topik di bawah untuk\n`;
    body += `  §8mempelajari setiap fitur.\n`;
    body += `\n${HR}`;

    const menu = _buildMenu(eventActive, shardCount);
    const form = new ActionFormData()
      .title("§8 ♦ §6PANDUAN§r §8♦ §r")
      .body(body);

    for (const item of menu) form.button(item.label, item.icon);
    form.button("§6  Tutup", "textures/items/redstone_dust");

    try { player.playSound("random.click", { pitch: 1.3, volume: 0.7 }); } catch { }
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();

    if (res.selection === menu.length) return; // tutup
    const item = menu[res.selection];
    if (!item) return;
    if (item.metric) bumpMetric(item.metric);
    await item.handler(player);
  }
}

// ═══════════════════════════════════════════════════════════
// ON LOGIN — kirim welcome chat sesuai status player
// ═══════════════════════════════════════════════════════════
//
// Mode resolution:
//   - Belum pernah lihat (no SEEN, no VER)        → "first"  + auto-open guide
//   - Pernah lihat, version < WELCOME_VER         → "update" + auto-open guide
//   - Pernah lihat, version == WELCOME_VER        → skip silent (returning)
//
// Player lama (legacy K_WELCOME_SEEN tanpa K_WELCOME_VER) akan dianggap
// version 1 → otomatis dapat re-trigger sekali ke version 2.
export function handleWelcome(player) {
  try {
    const seenLegacy = pGetRaw(player, K_WELCOME_SEEN);
    const seenVer = pGetRaw(player, K_WELCOME_VER);
    const currentVer = typeof seenVer === "number" ? seenVer
      : (seenLegacy ? 1 : 0);

    // -- Event notification on every login (regardless of welcome version) --
    _sendEventNotification(player);

    // Live Chat status for returning players (non-blocking)
    if (currentVer >= WELCOME_VER) {
      _sendChatStatusLine(player);
      return; // up-to-date, no full welcome
    }

    const mode = currentVer === 0 ? "first" : "update";
    sendWelcomeChat(player, mode).catch(() => { });

    bumpMetric(mode === "first" ? "welcome_first" : "welcome_update");
    if (mode === "update") {
      console.log(`[Welcome] re-trigger v${currentVer}->v${WELCOME_VER} for ${player.name}`);
    }

    // Tandai sudah lihat versi sekarang. Tetap tulis legacy key untuk
    // backward compat (kalau ada code lain yang baca SEEN).
    try {
      pSetRaw(player, K_WELCOME_SEEN, Date.now());
      pSetRaw(player, K_WELCOME_VER, WELCOME_VER);
    } catch { }

    system.runTimeout(() => {
      try {
        const live = world.getPlayers().find(p => p.id === player.id);
        if (live) openWelcomeGuide(live).catch(e => { if (!e?.isUIClose) console.warn("[Welcome]", e); });
      } catch { }
    }, 80);
  } catch (e) {
    console.warn("[Welcome] error:", e);
  }
}

/**
 * Compact Live Chat status line for returning players.
 * Shows verified status + web message count (non-blocking async).
 */
function _sendChatStatusLine(player) {
  getChatVerifiedInfo(player.name).then(info => {
    try {
      const p = world.getPlayers().find(x => x.name === player.name);
      if (!p) return;

      const koin = getCoin(p);
      const koinStr = koin.toLocaleString("id-ID");

      let line = `§7Saldo: §e${koinStr} Koin`;

      if (info.verified) {
        line += ` §7| Pesan web: §a${info.webCount} baru`;
      } else {
        line += ` §7| §eKetik §a/auth §eutk Live Chat`;
      }
      p.sendMessage(line);
    } catch { }
  }).catch(() => { });
}

/**
 * Send event status notification on every login.
 * Shows active event name, remaining time, and per-quest progress bars.
 */
function _sendEventNotification(player) {
  try {
    if (!isEidActive()) return;
    const timeLeft = getEidTimeLeft();
    const { quests, token, dayLabel } = getEidQuestInfo(player);
    const resetIn = getEidQuestReset();

    // Build per-quest progress lines with mini bars
    let questLines = "";
    for (const q of quests) {
      const status = q.done ? "§a✓ Selesai" : `§e${q.current}§8/§e${q.target}`;
      questLines += `\n  §8│ ${q.label} ${_miniBar(q.current, q.target)} ${status}`;
    }

    player.sendMessage(
      `\n§8══ §6◆ EVENT EID ADHA §8══` +
      `\n  §8│ §aAKTIF §8│ §eSisa: §f${timeLeft ?? "-"}` +
      `\n  §8│ §6Shard: §f${token} §8│ §eReset: §f${resetIn}` +
      `\n  §8├──── Quest: ${dayLabel} §8────` +
      questLines +
      `\n  §8│` +
      `\n  §8└ §7Ketik §c/pvp §7→ Kill Effect` +
      `\n§8══════════════════════\n`
    );
    try { player.playSound("random.orb", { pitch: 1.5, volume: 0.5 }); } catch { }

    // Shard progress notification — personalized CTA (Hooked Model trigger)
    _notifyShardProgress(player);
  } catch { }
}

/**
 * Personalized shard progress notification.
 * Tells the player what KillFX they can buy or how close they are to the next one.
 * Marketing PhD: Cialdini (commitment + goal gradient) + Nir Eyal (trigger).
 */
function _notifyShardProgress(player) {
  try {
    const shard = getToken(player);
    if (shard <= 0) return;

    const fx = getKillFx(player.id);
    const _k = (id) => Array.isArray(id) ? JSON.stringify(id) : id;
    const isOwned = (id) => fx.owned.some(o => _k(o) === _k(id));

    // Find cheapest unowned effect that requires shards
    const affordable = CFG.KILL_EFFECTS
      .filter(e => (e.tokenCost ?? 0) > 0 && !isOwned(e.id))
      .sort((a, b) => a.tokenCost - b.tokenCost);

    if (affordable.length === 0) return; // owns all — no CTA needed

    const next = affordable[0];
    if (shard >= next.tokenCost) {
      // Can afford — strong CTA
      player.sendMessage(
        `\n  §a✦ §fKamu punya §6${shard} Shard§f — cukup untuk §d${next.name}§f!` +
        `\n  §8└ §7Ketik §c/pvp §7→ §eKill Effect §7untuk beli.\n`
      );
    } else {
      // Almost there — goal gradient effect (closer = more motivated)
      const need = next.tokenCost - shard;
      const pct = Math.floor((shard / next.tokenCost) * 100);
      player.sendMessage(
        `\n  §e✦ §fShard: §6${shard}§8/§6${next.tokenCost} §8(§e${pct}%%§8) §7untuk §d${next.name}§7.` +
        `\n  §8└ §7Butuh §e${need} §7lagi! §8Ketik §e/daily §8→ Event Quest.\n`
      );
    }
  } catch { }
}

// ═══════════════════════════════════════════════════════════
// COMMAND REGISTRATION — /lt:guide
// ═══════════════════════════════════════════════════════════
const helpSessions = new Set();

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:guide",
        description: "Buka panduan fitur server",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (helpSessions.has(player.id)) return;
        system.run(async () => {
          if (helpSessions.has(player.id)) return;
          helpSessions.add(player.id);
          try { await openWelcomeGuide(player); }
          catch (e) { if (!e?.isUIClose) console.warn("[Welcome] guide error:", e); }
          finally { helpSessions.delete(player.id); }
        });
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[Welcome] Command registration failed:", e); }
});
