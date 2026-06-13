// daily/main.js — Entry point: commands, events, accumulator flush
import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { DAILY_CFG as CFG, SFX } from "./config.js";
import { processLogin } from "./login.js";
import { updateAllQuestProgress, flushQuestCache, clearQuestCache } from "./quest.js";
import { updateStat, setStat, flushStatsCache, clearStatsCache, queueAchNotif, drainAchNotifs } from "./achievement.js";
import { openDailyMenu } from "./ui.js";
import { getPlayerLBSummary } from "../leaderboard/main.js";
import { claimUbiIfEligible, buildUbiMessage } from "../welfare/ubi.js";
import { initActivityOnSpawn, cleanupActivityCache } from "../welfare/demurrage.js";
import { trackFlow } from "../eco_flow.js";
import { isPurgeActive } from "../purge_gate.js";

function addCoin(player, amount) {
  try {
    player.runCommand(`scoreboard players add @s ${CFG.COIN_OBJ} ${amount}`);
    return true;
  } catch (e) {
    console.warn("[Daily] addCoin:", e);
    return false;
  }
}
function fmt(n) { return n.toLocaleString("id-ID"); }
function playSfx(player, s) {
  if (!player) return;
  try { player.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch {}
}

// Tier label colors for chat messages
const TIER_CHAT = {
  daily: { tag: "§8[§bQuest§8]§b§r", name: "Harian" },
  weekly: { tag: "§8[§3Quest Minggu§8]§3§r", name: "Mingguan" },
  monthly: { tag: "§8[§5Quest Bulan§8]§5§r", name: "Bulanan" },
};

// Command /lt:daily
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand({
    name: "lt:daily",
    description: "Buka menu Daily Login, Quest & Achievement",
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
  }, (origin) => {
    const player = origin.sourceEntity;
    if (!player || typeof player.sendMessage !== "function") return;
    if (isPurgeActive()) {
      system.run(() => player.sendMessage("§8[§cDaily§8]§c Dinonaktifkan selama Purge!"));
      return;
    }
    system.run(() => openDailyMenu(player).catch(e => { if (!e?.isUIClose) console.warn("[Daily] UI:", e); }));
    return { status: 0 };
  });
});

// Auto login reward on first spawn
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      // ── Init demurrage activity stamp (free player baru dari demurrage) ──
      try { initActivityOnSpawn(player); } catch {}

      const result = processLogin(player);
      if (!result) return;
      // [§2] Iron rule: addCoin must succeed. If fails, log — DP already marked
      // but reward lost. This is a BDS scoreboard error path (extremely rare).
      if (!addCoin(player, result.coin)) {
        console.error(`[Daily] LOGIN REWARD LOST: ${player.name} ${result.coin} coin (scoreboard write failed but DP claimed)`);
      } else {
        trackFlow("login_reward", result.coin);
      }
      setStat(player.id, "loginDays", result.totalDays);

      // ── UBI claim (bypass daily login requirement — jalan tiap hari 1-7) ──
      let ubi = null;
      try { ubi = claimUbiIfEligible(player); } catch (e) { console.warn("[UBI]", e); }

      // ── Label streak baris ──────────────────────────────────────
      let streakLine;
      if (result.isMilestone30) {
        streakLine = `§6HARI KE-30! §r§d✦ LEGENDA SERVER! §eHadiah besar!`;
      } else if (result.isMilestone7) {
        streakLine = `§b★ STREAK ${result.totalDays} HARI! §r§e✦ Milestone bonus!`;
      } else if (result.streak === 7 && result.totalDays === 7) {
        streakLine = `§6HARI KE-7! §r§e★ Bonus Besar!`;
      } else if (result.totalDays > 7) {
        streakLine = `§fHari ke-§e${result.totalDays} §8(streak §e${result.streak}§8)`;
      } else {
        streakLine = `§fHari ke-§e${result.streak}`;
      }

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
        (() => {
          try {
            const lb = getPlayerLBSummary(player.id);
            if (lb) return `\n  §6★ §eLeaderboard §8── §f#${lb.rank}§8/${lb.total} §e${fmt(lb.score)} pts` + (lb.streak > 0 ? ` §6(${lb.streak}x streak)` : "");
          } catch {}
          return "";
        })() +
        `\n  §8Ketik §f/daily §8untuk Quest & Achievement` +
        `\n§8═══════════════════\n`
      );

      // Sound: milestone = epic chime, biasa = levelup biasa.
      // Pakai timeout supaya tidak overlap dengan possible UBI sound di bawah.
      playSfx(player, (result.isMilestone7 || result.isMilestone30) ? SFX.MILESTONE : SFX.CLAIM_BIG);

      // Broadcast milestone ke seluruh server
      if (result.isMilestone30) {
        world.sendMessage(`§8[§6Daily§8]§6 §d★ ${player.name} §ftelah login §e30 hari berturut-turut! §6LEGENDA SERVER!`);
      } else if (result.isMilestone7) {
        world.sendMessage(`§8[§6Daily§8]§6 §b★ ${player.name} §ftelah login §e${result.totalDays} hari§f! §b+${fmt(result.coin - 50)} koin milestone bonus!`);
      }

      // ── UBI message (jika ada) — dikirim setelah daily message supaya keduanya terlihat ──
      if (ubi) {
        try { player.sendMessage(buildUbiMessage(ubi)); } catch {}
        try { player.playSound("random.levelup", { pitch: 1.1, volume: 0.9 }); } catch {}
      }

      const newAch = updateStat(player.id, "loginDays", 0);
      for (const ach of newAch)
        player.sendMessage(`§8[§fAchievement§8]§f ${ach.label} terbuka!`);
      updateStat(player.id, "earned", result.coin);

      // Drain pending achievement notifications from previous offline session
      const pending = drainAchNotifs(player.id);
      if (pending.length > 0) {
        player.sendMessage(`§8[§fAchievement§8]§f Saat kamu offline, ada achievement baru:`);
        for (const label of pending)
          player.sendMessage(`§f  ★ ${label} terbuka!`);
        playSfx(player, SFX.ACH_UNLOCK);
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

// ── Last-attacker tracking untuk fire/indirect kill attribution ──
const _dailyLastAttacker = new Map();

world.afterEvents.entityHurt.subscribe(ev => {
  try {
    const victim = ev.hurtEntity;
    const attacker = ev.damageSource?.damagingEntity;
    if (!victim || !attacker) return;
    if (attacker.typeId !== "minecraft:player") return;
    if (victim.id === attacker.id) return;
    _dailyLastAttacker.set(victim.id, { id: attacker.id, tick: system.currentTick });
  } catch {}
});

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    let k = ev.damageSource?.damagingEntity;
    const dead = ev.deadEntity;
    const deadType = dead?.typeId;
    if (!deadType) return;

    // Fallback: fire tick / indirect damage — resolve dari lastAttacker
    if (!k || k.typeId !== "minecraft:player") {
      const tracked = _dailyLastAttacker.get(dead.id);
      if (tracked && (system.currentTick - tracked.tick) <= 200) {
        for (const p of world.getPlayers()) {
          if (p.id === tracked.id) { k = p; break; }
        }
      }
      _dailyLastAttacker.delete(dead.id);
      if (!k || k.typeId !== "minecraft:player") return;
    } else {
      _dailyLastAttacker.delete(dead.id);
    }

    if (dead.id === k.id) return;
    const a = getAccum(k.id);
    a.kills.set(deadType, (a.kills.get(deadType) || 0) + 1);
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
  if (!player || results.length === 0) return;
  for (const { tier, label } of results) {
    const chat = TIER_CHAT[tier];
    player.sendMessage(`\n${chat.tag} §f${label} §aselesai!\n§f  Klaim di §e/lt:daily\n`);
  }
  // Single sound per batch — kalau player kill 30 zombie sekaligus &
  // multiple tier completed di tick yang sama, jangan spam pling.
  playSfx(player, SFX.QUEST_DONE);
}

// Process accumulated events for one player
function handleAchNotif(pid, player, achList) {
  if (achList.length === 0) return;
  for (const ach of achList) {
    if (player) player.sendMessage(`§8[§fAchievement§8]§f ${ach.label} terbuka!`);
    else queueAchNotif(pid, ach.label);
  }
  // Single chime per batch (player online only — offline akan kena pas login).
  if (player) playSfx(player, SFX.ACH_UNLOCK);
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

// DP flush every ~20 seconds — [PERF] doubled from 10s to reduce DP write pressure
system.runInterval(() => { flushQuestCache(); flushStatsCache(); }, 400);

// Cleanup on leave — process remaining events first
world.afterEvents.playerLeave.subscribe((ev) => {
  try {
    const a = accum.get(ev.playerId);
    if (a) { processAccum(ev.playerId, a, null); accum.delete(ev.playerId); }
    clearQuestCache(ev.playerId);
    clearStatsCache(ev.playerId);
  } catch { }
  _dailyLastAttacker.delete(ev.playerId);
  for (const [vid, data] of _dailyLastAttacker) {
    if (data.id === ev.playerId) _dailyLastAttacker.delete(vid);
  }
  // Demurrage debounce cache cleanup
  try { cleanupActivityCache(ev.playerId); } catch {}
});
