import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { LB_CFG as CFG } from "./config.js";
import { UIClose } from "../ui_close.js";
import { syncLeaderboard, pollTopupQueue, pollRecoveryQueue, microSyncPositions } from "./sync.js";
import "./sync_boot_pricing.js";  // Auto-seed production pricing on boot
import { trackFlow } from "../eco_flow.js";

const dp = {
  get: (k, def) => {
    try { return JSON.parse(world.getDynamicProperty(k) ?? "null") ?? def; }
    catch { return def; }
  },
  set: (k, v) => {
    try { world.setDynamicProperty(k, JSON.stringify(v)); }
    catch (e) { console.warn("[LB] dp.set:", k, e); }
  },
  del: (k) => { try { world.setDynamicProperty(k, undefined); } catch {} },
};

const fmt = n => Math.floor(n).toLocaleString("id-ID");

// [PERF] Cache coin objective — resolve once, refresh periodically
let _lbCoinObj = null;
let _lbObjTick = -1;

function getLBCoinObj() {
  const now = system.currentTick;
  if (_lbCoinObj && now - _lbObjTick < 6000) return _lbCoinObj;
  try { _lbCoinObj = world.scoreboard.getObjective(CFG.COIN_OBJ); } catch {}
  _lbObjTick = now;
  return _lbCoinObj;
}

function addCoin(player, amount) {
  // [PERF] Scoreboard API first — no command parsing overhead
  const obj = getLBCoinObj();
  if (obj) {
    try { obj.addScore(player, amount); return true; } catch {}
  }
  try {
    player.runCommand(`scoreboard players add @s ${CFG.COIN_OBJ} ${amount}`);
    return true;
  } catch (e) {
    console.warn("[LB] addCoin:", e);
    return false;
  }
}

let weekCache = null;

function getWeekData() {
  if (weekCache) return weekCache;
  const data = dp.get(CFG.K_WEEK, null);
  if (!data || typeof data.start !== "number" || !data.players
      || data.start <= 0 || data.start > Date.now() + 86400000) {
    // Invalid or corrupt data — start fresh
    weekCache = { start: Date.now(), players: {} };
    dp.set(CFG.K_WEEK, weekCache);
  } else {
    weekCache = data;
  }
  return weekCache;
}

function saveWeekData() {
  if (!weekCache) return;
  const players = weekCache.players;
  const keys = Object.keys(players);
  if (keys.length > 80) {
    // Keep top 60 by score, remove the rest entirely to prevent DP bloat
    const scored = keys.map(k => ({ k, s: calcScore(players[k]) })).sort((a, b) => b.s - a.s);
    const keep = new Set(scored.slice(0, 60).map(e => e.k));
    for (const k of keys) {
      if (!keep.has(k)) delete players[k];
    }
  }
  dp.set(CFG.K_WEEK, weekCache);
}

function ensurePlayer(pid, name) {
  const data = getWeekData();
  if (!data.players[pid])
    data.players[pid] = { name, kills: 0, mined: 0, placed: 0, pvp: 0 };
  else
    data.players[pid].name = name;
  return data.players[pid];
}

function calcScore(p) {
  return ((p.kills || 0) * CFG.SCORE.kill) +
         ((p.mined || 0) * CFG.SCORE.mine) +
         ((p.placed || 0) * CFG.SCORE.place) +
         ((p.pvp || 0) * CFG.SCORE.pvp);
}

function getSortedLeaderboard() {
  const data = getWeekData();
  return Object.entries(data.players)
    .map(([id, p]) => ({ id, ...p, score: calcScore(p) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

function getSortedByKey(key) {
  const data = getWeekData();
  return Object.entries(data.players)
    .map(([id, p]) => ({ id, ...p, score: calcScore(p) }))
    .filter(e => (key === "score" ? e.score : (e[key] || 0)) > 0)
    .sort((a, b) => key === "score" ? b.score - a.score : (b[key] || 0) - (a[key] || 0));
}

function getTop(n) { return getSortedLeaderboard().slice(0, n); }

export function getPlayerLBSummary(pid) {
  const sorted = getSortedLeaderboard();
  const idx = sorted.findIndex(e => e.id === pid);
  if (idx < 0) return null;
  const streak = dp.get(CFG.K_STREAK + pid, { count: 0 });
  return { rank: idx + 1, total: sorted.length, score: sorted[idx].score, streak: streak.count };
}

function getLandLeaderboard() {
  try {
    const areaObj = world.scoreboard.getObjective("lb_land_area");
    const countObj = world.scoreboard.getObjective("lb_land_count");
    const valObj = world.scoreboard.getObjective("lb_land_value");
    if (!areaObj) return [];
    const owners = new Map();
    for (const p of areaObj.getParticipants()) {
      const name = p.displayName;
      owners.set(name, {
        name,
        totalArea: areaObj.getScore(p) || 0,
        count: countObj ? (countObj.getScore(p) || 0) : 0,
        totalValue: valObj ? (valObj.getScore(p) || 0) : 0,
      });
    }
    return Array.from(owners.values()).sort((a, b) => b.totalArea - a.totalArea);
  } catch (e) { console.warn("[LB] getLandLeaderboard:", e); return []; }
}

const accum = new Map();
function getAccum(pid) {
  if (!accum.has(pid)) accum.set(pid, { name: "", kills: 0, mined: 0, placed: 0, pvp: 0 });
  return accum.get(pid);
}

function flushAccum() {
  if (accum.size === 0) return false;
  // [§2] Two-phase: snapshot accum delta, mutate weekCache, persist.
  // If persist fails, rollback weekCache mutation; accum stays dirty for retry.
  const snapshot = [];
  for (const [pid, a] of accum) {
    if (a.kills === 0 && a.mined === 0 && a.placed === 0 && a.pvp === 0) continue;
    snapshot.push({ pid, name: a.name, kills: a.kills, mined: a.mined, placed: a.placed, pvp: a.pvp });
  }
  if (snapshot.length === 0) return false;

  // Apply forward
  for (const s of snapshot) {
    const p = ensurePlayer(s.pid, s.name);
    p.kills += s.kills; p.mined += s.mined; p.placed += s.placed; p.pvp += s.pvp;
  }

  try {
    saveWeekData();
  } catch (e) {
    // Rollback in-memory weekCache; keep accum so next flush retries cleanly.
    for (const s of snapshot) {
      const p = weekCache?.players?.[s.pid];
      if (p) { p.kills -= s.kills; p.mined -= s.mined; p.placed -= s.placed; p.pvp -= s.pvp; }
    }
    console.warn("[LB] flushAccum saveWeekData failed, kept accum dirty for retry:", e);
    return false;
  }

  // Persisted — now safe to zero accum.
  for (const [pid, a] of accum) {
    a.kills = 0; a.mined = 0; a.placed = 0; a.pvp = 0;
  }
  return true;
}

function flushPlayer(pid) {
  const a = accum.get(pid);
  if (!a) return;
  if (a.kills > 0 || a.mined > 0 || a.placed > 0 || a.pvp > 0) {
    const p = ensurePlayer(pid, a.name);
    p.kills += a.kills;
    p.mined += a.mined;
    p.placed += a.placed;
    p.pvp += a.pvp;
    saveWeekData();
  }
  accum.delete(pid);
}

// ── Last-attacker tracking untuk fire/indirect kill attribution ──
const _lbLastAttacker = new Map();

world.afterEvents.entityHurt.subscribe(ev => {
  try {
    const victim = ev.hurtEntity;
    const attacker = ev.damageSource?.damagingEntity;
    if (!victim || !attacker) return;
    if (victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player") return;
    if (victim.id === attacker.id) return;
    _lbLastAttacker.set(victim.id, { id: attacker.id, name: attacker.name, tick: system.currentTick });
    // [PERF] Bound Map size to prevent memory leak from many PvP encounters
    if (_lbLastAttacker.size > 50) {
      const oldest = [..._lbLastAttacker.entries()].sort((a, b) => a[1].tick - b[1].tick);
      for (let i = 0; i < oldest.length - 30; i++) _lbLastAttacker.delete(oldest[i][0]);
    }
  } catch {}
});

world.afterEvents.entityDie.subscribe(ev => {
  try {
    const dead = ev.deadEntity;
    if (!dead) return;

    let k = ev.damageSource?.damagingEntity;

    // Fallback: fire tick / indirect damage — resolve dari lastAttacker
    if ((!k || k.typeId !== "minecraft:player") && dead.typeId === "minecraft:player") {
      const tracked = _lbLastAttacker.get(dead.id);
      if (tracked && (system.currentTick - tracked.tick) <= 200) {
        // Cari attacker yang masih online
        for (const p of world.getPlayers()) {
          if (p.id === tracked.id) { k = p; break; }
        }
      }
      _lbLastAttacker.delete(dead.id);
    } else if (dead.typeId === "minecraft:player") {
      _lbLastAttacker.delete(dead.id);
    }

    if (!k || k.typeId !== "minecraft:player") return;
    if (dead.id === k.id) return;
    const a = getAccum(k.id);
    a.name = k.name;
    if (dead.typeId === "minecraft:player") a.pvp++;
    else a.kills++;
  } catch {}
});

world.afterEvents.playerBreakBlock.subscribe(ev => {
  try {
    if (!ev.player) return;
    const a = getAccum(ev.player.id);
    a.name = ev.player.name;
    a.mined++;
  } catch {}
});

world.afterEvents.playerPlaceBlock.subscribe(ev => {
  try {
    if (!ev.player) return;
    const a = getAccum(ev.player.id);
    a.name = ev.player.name;
    a.placed++;
  } catch {}
});

// [PERF] Flush accum every ~20 seconds (doubled from 10s to reduce DP writes)
system.runInterval(() => { try { flushAccum(); } catch {} }, 400);

world.afterEvents.playerLeave.subscribe(ev => {
  try { flushPlayer(ev.playerId); } catch {}
  _lbLastAttacker.delete(ev.playerId);
  for (const [vid, data] of _lbLastAttacker) {
    if (data.id === ev.playerId) _lbLastAttacker.delete(vid);
  }
});

function getStreakMult(count) {
  let m = 1;
  for (const t of CFG.STREAK_MULT) { if (count >= t.min) m = t.mult; }
  return m;
}

let resetInProgress = false;

function distributeRewards() {
  if (resetInProgress) return;
  resetInProgress = true;
  try {
    flushAccum();
    const data = getWeekData();

    // ── Crash guard: if already distributed but week not yet reset, just reset ──
    if (data.distributed) {
      weekCache = { start: Date.now(), players: {} };
      dp.set(CFG.K_WEEK, weekCache);
      console.warn("[LB] Crash recovery: week was distributed but not reset. Resetting now.");
      return;
    }

    const lb = getTop(CFG.MAX_ENTRIES);

    // ── Mark as distributed FIRST to prevent double-reward on crash ──
    data.distributed = true;
    dp.set(CFG.K_WEEK, data);

    // Save previous week snapshot (read old prev for streak validation)
    const oldPrev = dp.get(CFG.K_PREV, null);
    dp.set(CFG.K_PREV, { start: data.start, end: Date.now(), entries: lb });

    const onlineMap = new Map(world.getPlayers().map(p => [p.id, p]));
    const top3Ids = new Set();

    for (const reward of CFG.REWARDS) {
      const entry = lb[reward.rank - 1];
      if (!entry) continue;
      top3Ids.add(entry.id);

      // ── Streak: validate consecutive weeks via lastWeekStart ──
      const streakData = dp.get(CFG.K_STREAK + entry.id, { count: 0, lastWeekStart: 0 });
      const isConsecutive = oldPrev && streakData.lastWeekStart === oldPrev.start;
      streakData.count = isConsecutive ? streakData.count + 1 : 1;
      streakData.lastWeekStart = data.start;
      dp.set(CFG.K_STREAK + entry.id, streakData);

      const mult = getStreakMult(streakData.count);
      const finalCoin = Math.floor(reward.coin * mult);
      const streakTag = streakData.count >= 2 ? ` §6(${streakData.count}x streak! ${mult}x bonus)` : "";

      // ── Save reward as pending for ALL winners (crash-safe) ──
      dp.set(CFG.K_PENDING + entry.id, { rank: reward.rank, coin: finalCoin, name: entry.name, streak: streakData.count });

      // ── Deliver immediately to online players ──
      const player = onlineMap.get(entry.id);
      if (player) {
        // [§2] Only delete pending if scoreboard write succeeded — else
        // reward survives in pending for next login claim.
        if (addCoin(player, finalCoin)) {
          trackFlow("weekly_reward", finalCoin);
          dp.del(CFG.K_PENDING + entry.id);
          player.sendMessage(
            `§8[§6Leaderboard§8]§6 §eMinggu berakhir! Peringkat §f#${reward.rank}§e!` +
            `\n§6  Reward: §e+${fmt(finalCoin)}⛃ Koin${streakTag}`
          );
          // Pitch berdasarkan rank — top 1 paling tinggi (epic), top 3 sedang.
          try {
            const pitch = reward.rank === 1 ? 1.4 : reward.rank === 2 ? 1.2 : 1.0;
            player.playSound("random.levelup", { pitch, volume: 1.0 });
          } catch {}
        } else {
          console.warn(`[LB] online reward delivery failed, kept in pending: ${entry.name} ${finalCoin}`);
          player.sendMessage(
            `§8[§6Leaderboard§8]§6 §eReward minggu ini siap! §e+${fmt(finalCoin)}⛃ Koin${streakTag}` +
            `\n§7  Klaim ulang dengan logout & login.`
          );
          try { player.playSound("note.pling", { pitch: 1.0, volume: 0.8 }); } catch {}
        }
      }
    }

    // ── Reset streak for non-top-3 active players ──
    for (const [id] of Object.entries(data.players)) {
      if (!top3Ids.has(id)) {
        const s = dp.get(CFG.K_STREAK + id, null);
        if (s && s.count > 0) { s.count = 0; s.lastWeekStart = 0; dp.set(CFG.K_STREAK + id, s); }
      }
    }

    // ── Broadcast results ──
    if (lb.length > 0) {
      let msg = `\n§8[§6Leaderboard§8]§6 §eMinggu berakhir! Top 3:`;
      for (let i = 0; i < Math.min(3, lb.length); i++) {
        const e = lb[i];
        const r = CFG.REWARDS[i];
        const sd = dp.get(CFG.K_STREAK + e.id, { count: 0, lastWeekStart: 0 });
        const finalC = Math.floor((r?.coin ?? 0) * getStreakMult(sd.count));
        msg += `\n  ${r?.label ?? `§f${i+1}.`} §f${e.name} §8── §e${fmt(e.score)} pts §6+${fmt(finalC)}⛃`;
      }
      world.sendMessage(msg);
    }

    // ── Reset week ──
    weekCache = { start: Date.now(), players: {} };
    dp.set(CFG.K_WEEK, weekCache);
  } catch (e) {
    console.error("[LB] distributeRewards:", e);
  } finally {
    resetInProgress = false;
  }
}

system.runInterval(() => {
  try {
    const data = getWeekData();
    if (Date.now() - data.start >= CFG.WEEK_MS) distributeRewards();
  } catch (e) { console.warn("[LB] Reset check:", e); }
}, CFG.CHECK_INTERVAL);

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      const pend = dp.get(CFG.K_PENDING + player.id, null);
      if (!pend || typeof pend.coin !== "number") return;
      // [§2] Add coin first; only del pending if successful — survive retry on next login.
      if (!addCoin(player, pend.coin)) {
        console.warn(`[LB] pending claim failed, keeping for retry: ${player.name} ${pend.coin}`);
        return;
      }
      dp.del(CFG.K_PENDING + player.id);
      trackFlow("weekly_reward", pend.coin);
      const streakTag = (pend.streak ?? 0) >= 2 ? ` §6(${pend.streak}x streak!)` : "";
      player.sendMessage(
        `§8[§6Leaderboard§8]§6 §eSelamat! Minggu lalu peringkat §f#${pend.rank}§e!` +
        `\n§6  Reward: §e+${fmt(pend.coin)}⛃ Koin${streakTag}`
      );
      try {
        const pitch = pend.rank === 1 ? 1.4 : pend.rank === 2 ? 1.2 : 1.0;
        player.playSound("random.levelup", { pitch, volume: 1.0 });
      } catch {}
    } catch (e) { console.warn("[LB] Pending reward:", e); }
  }, 60);
});

const MEDALS = ["§6#1", "§f#2", "§e#3"];

function timeLeft(start) {
  const rem = Math.max(0, CFG.WEEK_MS - (Date.now() - start));
  const d = Math.floor(rem / 86400000);
  const h = Math.floor((rem % 86400000) / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} mnt`;
  return `${m} mnt`;
}

async function showLeaderboard(player) {
  while (true) {
    flushAccum();
    const data = getWeekData();
    const allSorted = getSortedLeaderboard();
    const lb = allSorted.slice(0, CFG.MAX_ENTRIES);

    let body = `${CFG.HR}\n`;
    body += `§6  ★ L E A D E R B O A R D\n`;
    body += `${CFG.HR}\n\n`;
    body += `  §fReset: §e${timeLeft(data.start)}\n\n`;

    const myIdx = allSorted.findIndex(e => e.id === player.id);
    if (myIdx >= 0) {
      const me = allSorted[myIdx];
      const sd = dp.get(CFG.K_STREAK + player.id, { count: 0 });
      body += `  §ePeringkat: §f#${myIdx + 1}§8/${allSorted.length} §8── §e${fmt(me.score)} pts\n`;
      body += `  §8  K:${me.kills}  M:${me.mined}  B:${me.placed}  P:${me.pvp}\n`;
      if (sd.count > 0) body += `  §6  Streak: ${sd.count}x §8(${getStreakMult(sd.count)}x bonus)\n`;
    } else {
      body += `  §8Kamu belum tercatat minggu ini\n`;
    }

    body += `\n${CFG.HR_THIN}\n`;
    body += `  §6 TOP 10 MINGGU INI\n`;
    body += `${CFG.HR_THIN}\n\n`;

    if (lb.length === 0) {
      body += `  §8Belum ada aktivitas.\n`;
    } else {
      for (let i = 0; i < lb.length; i++) {
        const e = lb[i];
        const medal = i < 3 ? MEDALS[i] : `§8${i + 1}.`;
        const clr = i < 3 ? "§f" : "§7";
        body += `  ${medal} ${clr}${e.name}  §e${fmt(e.score)} pts\n`;
        body += `  §8  K:${e.kills}  M:${e.mined}  B:${e.placed}  P:${e.pvp}\n`;
      }
    }
    body += `${CFG.HR}`;

    const form = new ActionFormData().title("§8 ♦ §6LEADERBOARD§r §8♦ §r").body(body);
    const btns = [];

    form.button("§f  Kategori\n§r  §8Top Killer, Miner, dll", "textures/items/nether_star");
    btns.push("cat");
    form.button("§f  Stats Saya\n§r  §8Statistik pribadi", "textures/items/compass_item");
    btns.push("stats");
    form.button("§f  Reward Info\n§r  §8Hadiah & streak", "textures/items/gold_ingot");
    btns.push("rewards");
    form.button("§f  Minggu Lalu\n§r  §8Hasil sebelumnya", "textures/items/book_writable");
    btns.push("prev");
    form.button("§6  Tutup", "textures/items/redstone_dust");
    btns.push("close");

    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "close") return;
    if (btns[res.selection] === "cat") await showCategorySelect(player);
    if (btns[res.selection] === "stats") await showPersonalStats(player);
    if (btns[res.selection] === "rewards") await showRewardInfo(player);
    if (btns[res.selection] === "prev") await showPrevWeek(player);
  }
}

async function showCategorySelect(player) {
  while (true) {
    let body = `${CFG.HR}\n`;
    body += `§6  ★ K A T E G O R I\n`;
    body += `${CFG.HR}\n\n`;
    body += `  §ePilih kategori leaderboard:\n`;
    body += `${CFG.HR}`;

    const form = new ActionFormData().title("§8 ♦ §6KATEGORI§r §8♦ §r").body(body);
    const btns = [];
    for (const cat of CFG.CATEGORIES) {
      let myRank = "-";
      if (cat.special && cat.id === "land") {
        const landLB = getLandLeaderboard();
        const li = landLB.findIndex(e => e.name === player.name);
        myRank = li >= 0 ? `#${li + 1}` : "-";
      } else {
        const sorted = getSortedByKey(cat.key);
        const myIdx = sorted.findIndex(e => e.id === player.id);
        myRank = myIdx >= 0 ? `#${myIdx + 1}` : "-";
      }
      form.button(`${cat.color}  ${cat.label}\n§r  §8Peringkat: ${myRank}`, cat.tex);
      btns.push(cat.id);
    }
    form.button("§f  Kembali", "textures/items/arrow");
    btns.push("back");

    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "back") return;
    if (btns[res.selection] === "land") await showLandLB(player);
    else await showCategoryLB(player, btns[res.selection]);
  }
}

async function showLandLB(player) {
  const landLB = getLandLeaderboard().slice(0, CFG.MAX_ENTRIES);
  const allLand = getLandLeaderboard();
  const myIdx = allLand.findIndex(e => e.name === player.name);

  let body = `${CFG.HR}\n`;
  body += `§2  ★ T O P   L A N D\n`;
  body += `${CFG.HR}\n\n`;

  if (myIdx >= 0) {
    const me = allLand[myIdx];
    body += `  §ePeringkatmu: §f#${myIdx + 1}\n`;
    body += `  §8  ${me.count} land §8── §2${fmt(me.totalArea)} §fblok §8── §e${fmt(me.totalValue)}⛃\n\n`;
  } else {
    body += `  §8Kamu belum punya land\n\n`;
  }

  if (landLB.length === 0) {
    body += `  §8Belum ada pemilik land.\n`;
  } else {
    for (let i = 0; i < landLB.length; i++) {
      const e = landLB[i];
      const medal = i < 3 ? MEDALS[i] : `§8${i + 1}.`;
      const clr = i < 3 ? "§f" : "§7";
      body += `  ${medal} ${clr}${e.name}  §2${fmt(e.totalArea)} §fblok\n`;
      body += `  §8  ${e.count} land §8── §enilai ${fmt(e.totalValue)}⛃\n`;
    }
  }
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §2TOP LAND§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function showCategoryLB(player, catId) {
  const cat = CFG.CATEGORIES.find(c => c.id === catId);
  if (!cat) return;

  flushAccum();
  const sorted = getSortedByKey(cat.key).slice(0, CFG.MAX_ENTRIES);
  const allSorted = getSortedByKey(cat.key);
  const myIdx = allSorted.findIndex(e => e.id === player.id);

  let body = `${CFG.HR}\n`;
  body += `${cat.color}  ★ ${cat.label.toUpperCase()}\n`;
  body += `${CFG.HR}\n\n`;

  if (myIdx >= 0) {
    const me = allSorted[myIdx];
    const val = cat.key === "score" ? me.score : (me[cat.key] || 0);
    body += `  §ePeringkatmu: §f#${myIdx + 1} §8── §e${fmt(val)}\n\n`;
  } else {
    body += `  §8Belum tercatat\n\n`;
  }

  if (sorted.length === 0) {
    body += `  §8Belum ada data.\n`;
  } else {
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const medal = i < 3 ? MEDALS[i] : `§8${i + 1}.`;
      const clr = i < 3 ? "§f" : "§7";
      const val = cat.key === "score" ? e.score : (e[cat.key] || 0);
      body += `  ${medal} ${clr}${e.name}  §e${fmt(val)}\n`;
    }
  }
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title(`§8 ♦ ${cat.color}${cat.label.toUpperCase()}§r §8♦ §r`)
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function showPersonalStats(player) {
  flushAccum();
  const data = getWeekData();
  const allSorted = getSortedLeaderboard();
  const myIdx = allSorted.findIndex(e => e.id === player.id);
  const me = myIdx >= 0 ? allSorted[myIdx] : null;
  const streak = dp.get(CFG.K_STREAK + player.id, { count: 0 });
  const combatStats = dp.get("cs:" + player.id, null);

  let body = `${CFG.HR}\n`;
  body += `§b  ★ S T A T S   S A Y A\n`;
  body += `${CFG.HR}\n\n`;

  body += `  §eLeaderboard Minggu Ini\n`;
  body += `${CFG.HR_THIN}\n`;
  if (me) {
    body += `  §8├ §fPeringkat §8── §e#${myIdx + 1}§8/${allSorted.length}\n`;
    body += `  §8├ §fSkor      §8── §e${fmt(me.score)} pts\n`;
    body += `  §8├ §fKills     §8── §e${fmt(me.kills)}\n`;
    body += `  §8├ §fMined     §8── §e${fmt(me.mined)}\n`;
    body += `  §8├ §fPlaced    §8── §e${fmt(me.placed)}\n`;
    body += `  §8└ §fPvP       §8── §e${fmt(me.pvp)}\n`;
  } else {
    body += `  §8└ §8Belum ada aktivitas minggu ini\n`;
  }

  body += `\n  §eStreak Top 3\n`;
  body += `${CFG.HR_THIN}\n`;
  if (streak.count > 0) {
    body += `  §8├ §fMinggu berturut §8── §6${streak.count}x\n`;
    body += `  §8└ §fBonus reward   §8── §6${getStreakMult(streak.count)}x\n`;
  } else {
    body += `  §8└ §8Belum pernah top 3\n`;
  }

  body += `\n  §ePvP Combat\n`;
  body += `${CFG.HR_THIN}\n`;
  if (combatStats) {
    const kd = (combatStats.deaths || 0) > 0
      ? ((combatStats.kills || 0) / combatStats.deaths).toFixed(2)
      : (combatStats.kills || 0).toString();
    body += `  §8├ §fKills   §8── §e${fmt(combatStats.kills || 0)}\n`;
    body += `  §8├ §fDeaths  §8── §e${fmt(combatStats.deaths || 0)}\n`;
    body += `  §8├ §fK/D     §8── §e${kd}\n`;
    body += `  §8├ §fDapat   §8── §a+${fmt(combatStats.earned || 0)} ⛃\n`;
    body += `  §8└ §fHilang  §8── §c-${fmt(combatStats.lost || 0)} ⛃\n`;
  } else {
    body += `  §8└ §8Belum ada data PvP\n`;
  }

  const myLand = getLandLeaderboard();
  const myLandIdx = myLand.findIndex(e => e.name === player.name);
  body += `\n  §eMimi Land\n`;
  body += `${CFG.HR_THIN}\n`;
  if (myLandIdx >= 0) {
    const ml = myLand[myLandIdx];
    body += `  §8├ §fPeringkat §8── §e#${myLandIdx + 1}\n`;
    body += `  §8├ §fLand      §8── §e${ml.count} land\n`;
    body += `  §8├ §fLuas      §8── §e${fmt(ml.totalArea)} blok\n`;
    body += `  §8└ §fNilai     §8── §e${fmt(ml.totalValue)}⛃\n`;
  } else {
    body += `  §8└ §8Belum punya land\n`;
  }

  body += `\n  §eKategori Peringkat\n`;
  body += `${CFG.HR_THIN}\n`;
  for (const cat of CFG.CATEGORIES) {
    let rank = "-";
    if (cat.special && cat.id === "land") {
      rank = myLandIdx >= 0 ? `#${myLandIdx + 1}` : "-";
    } else {
      const catSorted = getSortedByKey(cat.key);
      const ci = catSorted.findIndex(e => e.id === player.id);
      rank = ci >= 0 ? `#${ci + 1}` : "-";
    }
    body += `  §8├ ${cat.color}${cat.label} §8── §e${rank}\n`;
  }

  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §bSTATS§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function showRewardInfo(player) {
  let body = `${CFG.HR}\n`;
  body += `§6  ★ R E W A R D   I N F O\n`;
  body += `${CFG.HR}\n\n`;
  body += `  §eTop 3 tiap minggu dapat reward!\n\n`;

  for (const r of CFG.REWARDS)
    body += `  §8├ ${r.label} §8── §e+${fmt(r.coin)}⛃ Koin\n`;

  body += `\n${CFG.HR_THIN}\n`;
  body += `  §eSTREAK BONUS\n`;
  body += `${CFG.HR_THIN}\n\n`;
  body += `  §8Top 3 berturut-turut = bonus!\n\n`;
  for (const s of CFG.STREAK_MULT)
    body += `  §8├ §f${s.min}+ minggu §8── §6${s.mult}x reward\n`;

  body += `\n${CFG.HR_THIN}\n`;
  body += `  §eCARA DAPAT SKOR\n`;
  body += `${CFG.HR_THIN}\n\n`;
  body += `  §8├ §fKill Mob  §8── §e${CFG.SCORE.kill} pts\n`;
  body += `  §8├ §fMine Blok §8── §e${CFG.SCORE.mine} pts\n`;
  body += `  §8├ §fPasang    §8── §e${CFG.SCORE.place} pts\n`;
  body += `  §8└ §fPvP Kill  §8── §e${CFG.SCORE.pvp} pts\n`;
  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §eREWARD§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

async function showPrevWeek(player) {
  const prev = dp.get(CFG.K_PREV, null);

  let body = `${CFG.HR}\n`;
  body += `§f  ★ M I N G G U   L A L U\n`;
  body += `${CFG.HR}\n\n`;

  if (!prev || !Array.isArray(prev.entries) || prev.entries.length === 0) {
    body += `  §8Belum ada data minggu lalu.\n`;
  } else {
    for (let i = 0; i < prev.entries.length; i++) {
      const e = prev.entries[i];
      if (!e) continue;
      const medal = i < 3 ? MEDALS[i] : `§8${i + 1}.`;
      const r = CFG.REWARDS[i];
      const reward = r ? ` §6+${fmt(r.coin)}⛃` : "";
      body += `  ${medal} §f${e.name}  §e${fmt(e.score ?? 0)} pts${reward}\n`;
      body += `  §8  K:${e.kills ?? 0}  M:${e.mined ?? 0}  B:${e.placed ?? 0}  P:${e.pvp ?? 0}\n`;
    }
  }

  body += `\n${CFG.HR}`;

  await new ActionFormData()
    .title("§8 ♦ §fMINGGU LALU§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand({
    name: "lt:lb",
    description: "Lihat Weekly Leaderboard",
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
  }, (origin) => {
    const player = origin.sourceEntity;
    if (!player || typeof player.sendMessage !== "function") return;
    system.run(() => showLeaderboard(player).catch(e => {
      if (!e?.isUIClose) console.warn("[LB] UI:", e);
    }));
    return { status: 0 };
  });

  customCommandRegistry.registerCommand({
    name: "lt:stats",
    description: "Lihat statistik pribadi",
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
  }, (origin) => {
    const player = origin.sourceEntity;
    if (!player || typeof player.sendMessage !== "function") return;
    system.run(() => showPersonalStats(player).catch(e => {
      if (!e?.isUIClose) console.warn("[LB] Stats UI:", e);
    }));
    return { status: 0 };
  });

  // ── /lt:pricing — Diagnostic: dump semua data pricing ke console & chat ──
  customCommandRegistry.registerCommand({
    name: "lt:pricing",
    description: "§8[Admin] Cek harga land & inflasi saat ini",
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
  }, (origin) => {
    const player = origin.sourceEntity;
    if (!player || typeof player.sendMessage !== "function") return;
    system.run(() => {
      try {
        if (!player.hasTag("mimi")) {
          player.sendMessage("§c[Pricing] Admin only.");
          return;
        }

        // 1. Read eco:pricing DP
        let pricing = null;
        try {
          const raw = world.getDynamicProperty("eco:pricing");
          if (typeof raw === "string") pricing = JSON.parse(raw);
        } catch {}

        // 2. Read eco:policy DP
        let policy = null;
        try {
          const raw = world.getDynamicProperty("eco:policy");
          if (typeof raw === "string") policy = JSON.parse(raw);
        } catch {}

        // 3. Read _eco_pricing scoreboard (bridge)
        let bridge = {};
        try {
          const sb = world.scoreboard.getObjective("_eco_pricing");
          if (sb) {
            bridge.iph = (sb.getScore("_iph") || 0) / 100;
            bridge.eq1 = sb.getScore("_eq1") || 0;
            bridge.eq10 = sb.getScore("_eq10") || 0;
            bridge.n = sb.getScore("_n") || 0;
            bridge.tiers = [];
            for (let i = 0; i < bridge.n; i++) {
              bridge.tiers.push({
                rate: (sb.getScore("_lr" + i) || 0) / 100,
                maxArea: sb.getScore("_mx" + i) || 0,
              });
            }
          }
        } catch {}

        // 4. Calculate example prices with current rates
        const tiers = bridge.tiers || [];
        const calcPrice = (area) => {
          for (const t of tiers) {
            const mx = t.maxArea >= 999999 ? Infinity : t.maxArea;
            if (area <= mx) return Math.round(area * t.rate);
          }
          return tiers.length > 0 ? Math.round(area * tiers[tiers.length - 1].rate) : 0;
        };

        const coinBasis = pricing?.iph || bridge.iph || 0;

        // === Console output (detailed) ===
        console.log("═══════════════════════════════════════");
        console.log("[Pricing Diagnostic] " + new Date().toISOString());
        console.log("═══════════════════════════════════════");
        console.log("coinBasis (iph):", coinBasis);
        console.log("Floor:", 25, "| Ceiling:", 500);
        if (pricing) {
          console.log("Anchors: cA1=" + pricing._a?.[0] + " cA2=" + pricing._a?.[1] + " cA3=" + pricing._a?.[2]);
          console.log("Raw basis:", pricing._raw, "| Prev basis:", pricing._prev);
          console.log("eq1:", pricing.eq1, "| eq10:", pricing.eq10);
          console.log("Last update:", new Date(pricing.t).toISOString());
        }
        console.log("───────────────────────────────────────");
        console.log("LAND RATE TIERS (active):");
        for (let i = 0; i < tiers.length; i++) {
          const labels = ["Small", "Medium", "Large", "Mega"];
          const mx = tiers[i].maxArea >= 999999 ? "∞" : tiers[i].maxArea;
          console.log("  " + (labels[i] || i) + ": rate=" + tiers[i].rate + "/blok² maxArea=" + mx);
        }
        console.log("───────────────────────────────────────");
        console.log("CONTOH HARGA:");
        const examples = [
          { label: "10×10", area: 100 },
          { label: "15×15", area: 225 },
          { label: "20×20", area: 400 },
          { label: "30×30", area: 900 },
          { label: "50×50", area: 2500 },
          { label: "100×100", area: 10000 },
          { label: "129×90", area: 11610 },
        ];
        for (const ex of examples) {
          const p = calcPrice(ex.area);
          const gem = Math.ceil(p * 0.01);
          console.log("  " + ex.label + " (" + ex.area + " blok²) = " + p + "⛃ / " + gem + "✦");
        }
        if (policy) {
          console.log("───────────────────────────────────────");
          console.log("POLICY: adj=" + policy.adj + " income=" + policy.income + " sink=" + policy.sink + " pressure=" + policy.pressure + "%");
        }
        console.log("═══════════════════════════════════════");

        // === Chat output (ringkas) ===
        let msg = "\n§8═══════════════════\n";
        msg += "§6  ★ PRICING DIAGNOSTIC\n";
        msg += "§8═══════════════════\n\n";
        msg += "  §ecoinBasis §8── §f" + coinBasis + "\n";
        msg += "  §eFloor/Ceil §8── §f25 / 500\n";
        if (pricing?._a) {
          msg += "  §eAnchors §8── §f" + pricing._a[0] + " | " + pricing._a[1] + " | " + pricing._a[2] + "\n";
        }
        msg += "\n§8───────────────────\n";
        msg += "  §eTIER RATES AKTIF\n";
        msg += "§8───────────────────\n";
        const tierNames = ["§aSmall ", "§eMedium", "§6Large ", "§cMega  "];
        for (let i = 0; i < tiers.length; i++) {
          const mx = tiers[i].maxArea >= 999999 ? "∞" : fmt(tiers[i].maxArea);
          msg += "  " + (tierNames[i] || "§f?") + " §8── §f" + tiers[i].rate + "§8⛃/blok² §8(≤" + mx + ")\n";
        }
        msg += "\n§8───────────────────\n";
        msg += "  §eCONTOH HARGA\n";
        msg += "§8───────────────────\n";
        for (const ex of examples) {
          const p = calcPrice(ex.area);
          const gem = Math.ceil(p * 0.01);
          msg += "  §f" + ex.label + " §8→ §e" + fmt(p) + "⛃ §8/ §b" + fmt(gem) + "✦\n";
        }
        if (policy) {
          msg += "\n  §ePolicy §8── adj=§f" + policy.adj + " §8pressure=§f" + policy.pressure + "%\n";
        }
        msg += "\n§8═══════════════════";
        player.sendMessage(msg);
      } catch (e) {
        console.warn("[Pricing Diagnostic] Error:", e);
        player.sendMessage("§c[Pricing] Error: " + e);
      }
    });
    return { status: 0 };
  });
});

// ── Sync leaderboard to Supabase ──
// First sync after ~30s, then every ~5 min. Async — does NOT block tick.
const _filterCircuit = (tag) => (e) => { if (!e?.circuitOpen) console.warn(tag, e); };

system.runTimeout(() => {
  try { flushAccum(); } catch {}
  syncLeaderboard().catch(_filterCircuit("[LB-Sync]"));
}, 600);
system.runInterval(() => {
  try { flushAccum(); } catch {}
  syncLeaderboard().catch(_filterCircuit("[LB-Sync]"));
}, 6000);

// ── Poll web topup queue — every ~30s, lightweight GET ──
system.runTimeout(() => {
  pollTopupQueue().catch(_filterCircuit("[Topup-Poll]"));
  pollRecoveryQueue().catch(_filterCircuit("[Recovery-Poll]"));
}, 400);
system.runInterval(() => {
  pollTopupQueue().catch(_filterCircuit("[Topup-Poll]"));
  pollRecoveryQueue().catch(_filterCircuit("[Recovery-Poll]"));
}, 600);

// ── Micro-sync player positions — every ~5s, lightweight PATCH ──
// Delay startup 20s to let full sync initialize the row first.
// Uses ONLY cached data (zero getEntities, zero DP reads).
system.runTimeout(() => {
  microSyncPositions().catch(() => {});
}, 400);
system.runInterval(() => {
  microSyncPositions().catch(() => {});
}, 100); // 100 ticks = 5 seconds