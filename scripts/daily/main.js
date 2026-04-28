// daily/main.js — Entry point: commands, events, accumulator flush
import { world, system, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { DAILY_CFG as CFG } from "./config.js";
import { processLogin } from "./login.js";
import { updateAllQuestProgress, flushQuestCache, clearQuestCache } from "./quest.js";
import { updateStat, setStat, flushStatsCache, clearStatsCache, queueAchNotif, drainAchNotifs } from "./achievement.js";
import { openDailyMenu } from "./ui.js";

function addCoin(player, amount) {
  try { player.runCommand(`scoreboard players add @s ${CFG.COIN_OBJ} ${amount}`); }
  catch (e) { console.warn("[Daily] addCoin:", e); }
}
function fmt(n) { return n.toLocaleString("id-ID"); }

// Tier label colors for chat messages
const TIER_CHAT = {
  daily: { tag: "§b[Quest]§r", name: "Harian" },
  weekly: { tag: "§3[Quest Minggu]§r", name: "Mingguan" },
  monthly: { tag: "§5[Quest Bulan]§r", name: "Bulanan" },
};

// Command /lt:daily
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand({
    name: "lt:daily",
    description: "Buka menu Daily Login, Quest & Achievement",
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
  }, ({ sourceEntity: player }) => {
    if (!player || player.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Hanya player." };
    system.run(() => openDailyMenu(player).catch(e => { if (!e?.isUIClose) console.warn("[Daily] UI:", e); }));
    return { status: CustomCommandStatus.Success, message: "" };
  });
});

// Auto login reward on first spawn
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      const result = processLogin(player);
      if (!result) return;
      addCoin(player, result.coin);
      setStat(player.id, "loginDays", result.totalDays);

      const isDay7 = result.streak === 7;
      const streakLine = isDay7
        ? `§6HARI KE-7! §r§e★ Bonus Besar!`
        : `§fHari ke-§e${result.streak}`;

      player.sendMessage(
        `\n§8═══════════════════` +
        `\n§6  ✦ DAILY LOGIN ✦` +
        `\n§r§8═══════════════════` +
        `\n§r  §aSelamat datang, §f${player.name}§a!` +
        `\n` +
        `\n  §6✦ §eStreak §8── ${streakLine}` +
        `\n  §e❖ §eReward §8── §e+${fmt(result.coin)} Koin` +
        `\n  §b◆ §eTotal  §8── §b${result.totalDays} hari` +
        `\n` +
        `\n  §8Ketik §f/daily §8untuk Quest & Achievement` +
        `\n§8═══════════════════\n`
      );

      const newAch = updateStat(player.id, "loginDays", 0);
      for (const ach of newAch)
        player.sendMessage(`\n§d[Achievement]§r §f${ach.label} §eterbuka!\n§f  Klaim di §e/lt:daily\n`);
      updateStat(player.id, "earned", result.coin);

      // Drain pending achievement notifications from previous offline session
      const pending = drainAchNotifs(player.id);
      if (pending.length > 0) {
        player.sendMessage(`\n§d[Achievement]§r §eSaat kamu offline, ada achievement baru:`);
        for (const label of pending)
          player.sendMessage(`  §d★ §f${label} §eterbuka! §fKlaim di §e/lt:daily`);
        player.sendMessage("");
      }
    } catch (e) { console.warn("[Daily] login:", e); }
  }, 40);
});

// Accumulator — O(1) event handlers, batch processing every 1s
const accum = new Map();
function getAccum(pid) {
  if (!accum.has(pid)) accum.set(pid, { kills: new Map(), mined: new Map(), placed: 0 });
  return accum.get(pid);
}

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const k = ev.damageSource?.damagingEntity;
    if (!k || k.typeId !== "minecraft:player") return;
    const t = ev.deadEntity?.typeId;
    if (t) { const a = getAccum(k.id); a.kills.set(t, (a.kills.get(t) || 0) + 1); }
  } catch { }
});

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    const t = ev.brokenBlockPermutation?.type?.id;
    if (ev.player && t) { const a = getAccum(ev.player.id); a.mined.set(t, (a.mined.get(t) || 0) + 1); }
  } catch { }
});

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  try { if (ev.player) getAccum(ev.player.id).placed++; } catch { }
});

// Send quest completion messages with tier labels
function notifyQuestDone(player, results) {
  if (!player) return;
  for (const { tier, label } of results) {
    const chat = TIER_CHAT[tier];
    player.sendMessage(`\n${chat.tag} §f${label} §aselesai!\n§f  Klaim di §e/lt:daily\n`);
  }
}

// Process accumulated events for one player
function handleAchNotif(pid, player, achList) {
  for (const ach of achList) {
    if (player) player.sendMessage(`\n§d[Achievement]§r §f${ach.label} §eterbuka!\n§f  Klaim di §e/lt:daily\n`);
    else queueAchNotif(pid, ach.label);
  }
}

function processAccum(pid, a, player) {
  if (a.kills.size > 0) {
    let total = 0;
    for (const [mob, count] of a.kills) {
      const done = updateAllQuestProgress(pid, "kill", mob, count);
      notifyQuestDone(player, done);
      total += count;
    }
    if (total > 0) handleAchNotif(pid, player, updateStat(pid, "kills", total));
    a.kills.clear();
  }

  if (a.mined.size > 0) {
    let total = 0;
    for (const [block, count] of a.mined) {
      const done = updateAllQuestProgress(pid, "mine", block, count);
      notifyQuestDone(player, done);
      total += count;
    }
    if (total > 0) handleAchNotif(pid, player, updateStat(pid, "mined", total));
    a.mined.clear();
  }

  if (a.placed > 0) {
    const done = updateAllQuestProgress(pid, "place", "*", a.placed);
    notifyQuestDone(player, done);
    handleAchNotif(pid, player, updateStat(pid, "placed", a.placed));
    a.placed = 0;
  }
}

// Flush accumulators every ~1 second
system.runInterval(() => {
  if (accum.size === 0) return;
  const pMap = new Map();
  for (const p of world.getPlayers()) pMap.set(p.id, p);
  for (const [pid, a] of accum) processAccum(pid, a, pMap.get(pid) ?? null);
}, 20);

// DP flush every ~10 seconds
system.runInterval(() => { flushQuestCache(); flushStatsCache(); }, 200);

// Cleanup on leave — process remaining events first
world.afterEvents.playerLeave.subscribe((ev) => {
  try {
    const a = accum.get(ev.playerId);
    if (a) { processAccum(ev.playerId, a, null); accum.delete(ev.playerId); }
    clearQuestCache(ev.playerId);
    clearStatsCache(ev.playerId);
  } catch { }
});
