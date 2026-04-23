// daily/ui.js — UI forms for Daily Login, Quest & Achievement
// Premium UI Design v2.0 — Multi-tier Quest System
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { world } from "@minecraft/server";
import { DAILY_CFG as CFG } from "./config.js";
import { getStreakInfo } from "./login.js";
import {
  getQuests, submitQuestItems, claimQuestReward, claimTierBonus,
  getTierSummary, getResetCountdown, TIER_KEYS, TIER_META,
} from "./quest.js";
import { getAchievements, getAchievementSummary, claimAchievement, getStats, updateStat } from "./achievement.js";

// ═══════════════════════════════════════════════════════════
// UI DESIGN TOKENS
// ═══════════════════════════════════════════════════════════
const fmt = (n) => Math.floor(n).toLocaleString("id-ID");
const LINE = "§8═══════════════════";
const LINE_THIN = "§8───────────────────";
const SP = "";

function progressBar(cur, max, w = 10) {
  if (max <= 0) return "§8" + "░".repeat(w);
  const ratio = Math.min(cur / max, 1);
  const filled = Math.floor(ratio * w);
  const empty = w - filled;
  if (ratio >= 1) return "§a" + "█".repeat(w);
  if (ratio >= 0.5) return "§2" + "█".repeat(filled) + "§8" + "░".repeat(empty);
  return "§6" + "█".repeat(filled) + "§8" + "░".repeat(empty);
}

function miniBar(cur, max) {
  if (max <= 0) return "§8--";
  const pct = Math.floor(Math.min(cur / max, 1) * 100);
  if (pct >= 100) return "§a■ SELESAI";
  if (pct >= 75) return `§2${pct}%`;
  if (pct >= 50) return `§e${pct}%`;
  return `§6${pct}%`;
}

function addCoin(player, amount) {
  try { player.runCommand(`scoreboard players add @s ${CFG.COIN_OBJ} ${amount}`); return true; }
  catch (e) { console.warn("[Daily] addCoin:", e); return false; }
}

// ═══════════════════════════════════════════════════════════
// MAIN MENU — Dashboard
// ═══════════════════════════════════════════════════════════
export async function openDailyMenu(player) {
  while (true) {
    const loginInfo = getStreakInfo(player.id);
    const achSummary = getAchievementSummary(player.id);

    // Aggregate quest stats across all tiers
    let totalQuests = 0, totalDone = 0, totalClaimable = 0;
    for (const tier of TIER_KEYS) {
      const s = getTierSummary(player.id, tier);
      totalQuests += s.total;
      totalDone += s.done;
      totalClaimable += s.claimable + (s.bonusReady ? 1 : 0);
    }

    let body = `${LINE}\n`;
    body += `§6§l  D A I L Y   S Y S T E M\n`;
    body += `${LINE}\n${SP}\n`;

    // Login
    const sClr = loginInfo.claimedToday ? "§a" : "§e";
    const sIco = loginInfo.claimedToday ? "§a✔" : "§c⚠";
    body += `  §6✦ §eLogin Streak\n`;
    body += `  §8├ ${sClr}${loginInfo.streak} hari\n`;
    body += `  §8└ ${sIco} ${loginInfo.claimedToday ? "§aDiklaim" : "§eBelum!"}\n`;
    body += `${SP}\n`;

    // Quest combined
    body += `  §b✎ §eQuest\n`;
    body += `  §8├ §f${totalDone}§8/${totalQuests}  ${progressBar(totalDone, totalQuests, 8)}\n`;
    if (totalClaimable > 0)
      body += `  §8└ §e${totalClaimable} reward!\n`;
    else
      body += `  §8└ §8Tidak ada reward\n`;
    body += `${SP}\n`;

    // Achievement
    body += `  §d✿ §eAchievement\n`;
    body += `  §8├ §f${achSummary.claimed}§8/${achSummary.total}  ${progressBar(achSummary.claimed, achSummary.total, 8)}\n`;
    if (achSummary.claimable > 0)
      body += `  §8└ §e${achSummary.claimable} baru!\n`;
    else
      body += `  §8└ §8${achSummary.unlocked} terbuka\n`;

    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title("§l§8 ♦ §6DAILY§r§l §8♦ §r")
      .body(body);
    const btns = [];

    // Login button
    if (loginInfo.claimedToday) {
      form.button(`§8§l  Login Reward\n§r  §8✔ Sudah diklaim`);
    } else {
      const nextDay = (loginInfo.streak % 7) + 1;
      const nextCoin = CFG.LOGIN_REWARDS[loginInfo.streak % 7].coin;
      form.button(`§a§l  ✦ Klaim Login!\n§r  §eHari ke-${nextDay} §8| §e${nextCoin} Koin`);
    }
    btns.push("login");

    // Quest button
    const qBadge = totalClaimable > 0 ? ` §c(${totalClaimable})` : "";
    form.button(`§b§l  ✎ Quest${qBadge}\n§r  §e${totalDone}/${totalQuests} selesai`);
    btns.push("quest");

    // Achievement button
    const aBadge = achSummary.claimable > 0 ? ` §c(${achSummary.claimable})` : "";
    form.button(`§d§l  ✿ Achievement${aBadge}\n§r  §e${achSummary.claimed}/${achSummary.total} diklaim`);
    btns.push("achievement");

    form.button("§6§l  ◀ Kembali");
    btns.push("back");

    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "back") return;
    if (btns[res.selection] === "login") await uiLoginDetail(player);
    else if (btns[res.selection] === "quest") await uiQuestTierSelector(player);
    else if (btns[res.selection] === "achievement") await uiAchievementCategories(player);
  }
}

// ═══════════════════════════════════════════════════════════
// LOGIN DETAIL — 7-Day Calendar
// ═══════════════════════════════════════════════════════════
async function uiLoginDetail(player) {
  const info = getStreakInfo(player.id);
  const claimedIdx = (info.streak - 1) % 7;

  let body = `${LINE}\n`;
  body += `§6§l  L O G I N   R E W A R D\n`;
  body += `${LINE}\n${SP}\n`;
  body += `  §6✦ §eStreak §8── §6${info.streak} hari\n`;
  body += `  §b◆ §eTotal  §8── §b${info.totalDays} hari\n`;
  body += `${SP}\n${LINE_THIN}\n`;
  body += `  §6§l REWARD CALENDAR\n`;
  body += `${LINE_THIN}\n${SP}\n`;

  for (let i = 0; i < 7; i++) {
    const r = CFG.LOGIN_REWARDS[i];
    const isBonus = i === 6;
    let isPast = false, isCurrent = false;

    if (info.claimedToday) {
      isPast = (i <= claimedIdx);
    } else {
      isPast = (i < claimedIdx + 1) && info.streak > 0;
      isCurrent = (i === (claimedIdx + 1) % 7);
      if (info.streak === 0) { isPast = false; isCurrent = (i === 0); }
    }

    if (isCurrent) body += `  §e▸ §6§lHari ${i + 1} §r§e${fmt(r.coin)} Koin §6◀\n`;
    else if (isPast) body += `  §a✔ §8Hari ${i + 1} §8${fmt(r.coin)} Koin\n`;
    else if (isBonus) body += `  §8■ §dHari ${i + 1} §d§l${fmt(r.coin)} Koin §r§d★\n`;
    else body += `  §8■ §8Hari ${i + 1} §8${fmt(r.coin)} Koin\n`;
  }

  body += `${SP}\n${LINE_THIN}\n`;
  body += info.claimedToday ? `  §a✔ §aKembali besok!\n` : `  §c⚠ §cStreak reset jika skip!\n`;
  body += `${LINE}`;

  const form = new ActionFormData().title("§l§8 ♦ §eLOGIN§r§l §8♦ §r").body(body);
  if (info.claimedToday) form.button("§8§l  ✔ Sudah Diklaim\n§r  §8Kembali besok");
  form.button("§6§l  ◀ Kembali");
  await form.show(player);
}

// ═══════════════════════════════════════════════════════════
// QUEST TIER SELECTOR — Choose daily/weekly/monthly
// ═══════════════════════════════════════════════════════════
async function uiQuestTierSelector(player) {
  while (true) {
    let body = `${LINE}\n`;
    body += `§b§l  Q U E S T\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §ePilih kategori quest:\n`;
    body += `${SP}\n`;

    // Show tier summaries in body
    for (const tier of TIER_KEYS) {
      const m = TIER_META[tier];
      const s = getTierSummary(player.id, tier);
      const cd = getResetCountdown(tier);
      body += `  ${m.color}${m.icon} §e${m.label}\n`;
      body += `  §8├ §f${s.done}§8/${s.total}  ${progressBar(s.done, s.total, 6)}\n`;
      body += `  §8└ §8Reset: §f${cd}\n`;
      body += `${SP}\n`;
    }
    body += `${LINE}`;

    const form = new ActionFormData()
      .title("§l§8 ♦ §bQUEST§r§l §8♦ §r")
      .body(body);
    const btns = [];

    for (const tier of TIER_KEYS) {
      const m = TIER_META[tier];
      const s = getTierSummary(player.id, tier);
      const claimable = s.claimable + (s.bonusReady ? 1 : 0);
      const badge = claimable > 0 ? ` §c(${claimable})` : "";
      const cd = getResetCountdown(tier);

      form.button(`${m.color}§l  ${m.icon} ${m.label}${badge}\n§r  §e${s.done}/${s.total} §8| §f${cd}`);
      btns.push(tier);
    }

    form.button("§6§l  ◀ Kembali");
    btns.push("back");

    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "back") return;
    await uiQuestList(player, btns[res.selection]);
  }
}

// ═══════════════════════════════════════════════════════════
// QUEST LIST — Per tier with bonus
// ═══════════════════════════════════════════════════════════
async function uiQuestList(player, tier) {
  const m = TIER_META[tier];

  while (true) {
    const quests = getQuests(player.id, tier);
    const summary = getTierSummary(player.id, tier);
    const cd = getResetCountdown(tier);

    let body = `${LINE}\n`;
    body += `${m.color}§l  ${m.icon} Q U E S T   ${m.label.toUpperCase()}\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §e◷ §eReset: §f${cd}\n`;
    body += `  ${m.color}${m.icon} §f${summary.done}§8/${summary.total} §8| ${progressBar(summary.done, summary.total, 8)}\n`;
    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title(`§l§8 ♦ ${m.color}${m.label.toUpperCase()}§r§l §8♦ §r`)
      .body(body);
    const btns = [];

    for (let i = 0; i < quests.length; i++) {
      const q = quests[i];
      const bar = progressBar(q.progress, q.amount, 6);
      let label;

      if (q.claimed) {
        label = `§8§l  ✔ ${q.label}\n§r  §8Diklaim | +${fmt(q.reward)}`;
      } else if (q.completed) {
        label = `§a§l  ★ ${q.label}\n§r  §e▸ Klaim §e${fmt(q.reward)} Koin!`;
      } else if (q.type === "submit") {
        label = `${m.color}§l  ✎ ${q.label}\n§r  ${bar} §f${q.progress}/${q.amount} §8| §e${fmt(q.reward)}⛃ ${m.color}| Serahkan`;
      } else {
        label = `§e§l  ✎ ${q.label}\n§r  ${bar} §f${q.progress}/${q.amount} §8| §e${fmt(q.reward)}⛃`;
      }
      form.button(label);
      btns.push({ action: "quest", idx: i });
    }

    // Completion bonus button
    if (summary.bonusReady) {
      form.button(`§6§l  ★ BONUS KOMPLIT!\n§r  §e▸ Klaim §e${fmt(summary.bonus)} Koin!`);
      btns.push({ action: "bonus" });
    } else if (summary.bonusClaimed) {
      form.button(`§8§l  ✔ Bonus Diklaim\n§r  §8+${fmt(summary.bonus)} Koin`);
      btns.push({ action: "none" });
    } else {
      const remain = summary.total - summary.claimed;
      form.button(`§8§l  ★ Bonus Komplit\n§r  §8Selesaikan ${remain} lagi | §e${fmt(summary.bonus)}⛃`);
      btns.push({ action: "none" });
    }

    form.button("§6§l  ◀ Kembali");
    btns.push({ action: "back" });

    const res = await form.show(player);
    if (res.canceled) return;

    const btn = btns[res.selection];
    if (btn.action === "back") return;
    if (btn.action === "none") continue;

    if (btn.action === "bonus") {
      const coin = claimTierBonus(player.id, tier);
      if (coin > 0) {
        addCoin(player, coin);
        const achA = updateStat(player.id, "questsDone", 1);
        const achB = updateStat(player.id, "earned", coin);
        player.sendMessage(
          `\n§6§l[BONUS]§r §6${m.label} komplit!\n` +
          `§8  Bonus: §e+${fmt(coin)} Koin\n`
        );
        for (const ach of [...achA, ...achB])
          player.sendMessage(`\n§d§l[Achievement]§r §f${ach.label} §eterbuka!\n§8  Klaim di §f/lt:daily\n`);
      }
      continue;
    }

    // Quest interaction
    const q = quests[btn.idx];
    if (q.claimed) continue;

    if (q.completed && !q.claimed) {
      const coin = claimQuestReward(player.id, tier, btn.idx);
      if (coin > 0) {
        addCoin(player, coin);
        const achA = updateStat(player.id, "questsDone", 1);
        const achB = updateStat(player.id, "earned", coin);
        player.sendMessage(
          `\n§a§l[${m.label}]§r §a${q.label} §fselesai!\n` +
          `§8  Reward: §e+${fmt(coin)} Koin\n`
        );
        for (const ach of [...achA, ...achB])
          player.sendMessage(`\n§d§l[Achievement]§r §f${ach.label} §eterbuka!\n§8  Klaim di §f/lt:daily\n`);
      }
      continue;
    }

    if (q.type === "submit" && !q.completed) {
      const result = submitQuestItems(player, tier, btn.idx);
      if (result.success) {
        player.sendMessage(
          `\n${m.color}§l[${m.label}]§r §fDiserahkan ${m.color}${result.taken}x\n` +
          `§8  Progress: §f${result.progress}/${result.total} ${miniBar(result.progress, result.total)}\n`
        );
        if (result.completed)
          player.sendMessage(`§e§l[${m.label}]§r §e${result.label} §fselesai! Klaim di menu.\n`);
      } else {
        player.sendMessage(`§c§l[${m.label}]§r §cItem tidak ditemukan!\n`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ACHIEVEMENT CATEGORIES
// ═══════════════════════════════════════════════════════════
const CAT_ICON = {
  Combat: "⚔", Mining: "◆", Building: "⬛",
  Economy: "❖", Login: "✦", Quest: "✎",
};
const CAT_COLOR = {
  Combat: "§c", Mining: "§b", Building: "§a",
  Economy: "§e", Login: "§d", Quest: "§6",
};

async function uiAchievementCategories(player) {
  while (true) {
    const cats = getAchievements(player.id);
    const stats = getStats(player.id);

    let body = `${LINE}\n`;
    body += `§d§l  A C H I E V E M E N T\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §6§l STATISTIK\n`;
    body += `${LINE_THIN}\n`;
    body += `  §c⚔ §eKills  §8── §f${fmt(stats.kills)}\n`;
    body += `  §b◆ §eMined  §8── §f${fmt(stats.mined)}\n`;
    body += `  §a⬛ §ePlaced §8── §f${fmt(stats.placed)}\n`;
    body += `  §e❖ §eEarned §8── §e${fmt(stats.earned)}\n`;
    body += `  §d✦ §eLogin  §8── §f${fmt(stats.loginDays)}\n`;
    body += `  §6✎ §eQuests §8── §f${fmt(stats.questsDone)}\n`;
    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title("§l§8 ♦ §dACHIEVEMENT§r§l §8♦ §r")
      .body(body);
    const catKeys = Object.keys(cats);
    const btns = [];

    for (const catName of catKeys) {
      const list = cats[catName];
      const cc = list.filter(a => a.claimed).length;
      const cl = list.filter(a => a.unlocked && !a.claimed).length;
      const color = CAT_COLOR[catName] || "§f";
      const icon = CAT_ICON[catName] || "■";
      const bar = progressBar(cc, list.length, 6);
      let badge = cl > 0 ? ` §c(${cl})` : "";

      form.button(`${color}§l  ${icon} ${catName}${badge}\n§r  ${bar} §e${cc}/${list.length}`);
      btns.push(catName);
    }

    form.button("§6§l  ◀ Kembali");
    btns.push("back");

    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "back") return;
    await uiAchievementList(player, btns[res.selection]);
  }
}

// ═══════════════════════════════════════════════════════════
// ACHIEVEMENT LIST — Per Category
// ═══════════════════════════════════════════════════════════
async function uiAchievementList(player, catName) {
  while (true) {
    const cats = getAchievements(player.id);
    const list = cats[catName] || [];
    const color = CAT_COLOR[catName] || "§f";
    const icon = CAT_ICON[catName] || "■";
    const cc = list.filter(a => a.claimed).length;

    let body = `${LINE}\n`;
    body += `${color}§l  ${icon} ${catName.toUpperCase()}\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §eProgress: §f${cc}§8/${list.length}  ${progressBar(cc, list.length, 8)}\n`;
    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title(`§l§8 ♦ ${color}${catName.toUpperCase()}§r§l §8♦ §r`)
      .body(body);
    const btns = [];

    for (const ach of list) {
      const bar = progressBar(ach.current, ach.target, 6);
      let label;

      if (ach.claimed) {
        label = `§8§l  ✔ §m${ach.label}§r\n  §8Diklaim | +${fmt(ach.reward)}`;
      } else if (ach.unlocked) {
        label = `§a§l  ★ ${ach.label}\n§r  §e▸ Klaim §e${fmt(ach.reward)} Koin!`;
      } else {
        label = `§e§l  ${ach.label}\n§r  ${bar} §f${fmt(ach.current)}/${fmt(ach.target)} §8| §e${fmt(ach.reward)}⛃`;
      }
      form.button(label);
      btns.push(ach.id);
    }

    form.button("§6§l  ◀ Kembali");
    btns.push("back");

    const res = await form.show(player);
    if (res.canceled || btns[res.selection] === "back") return;

    const achId = btns[res.selection];
    const ach = list.find(a => a.id === achId);
    if (ach && ach.unlocked && !ach.claimed) {
      const coin = claimAchievement(player.id, achId);
      if (coin > 0) {
        addCoin(player, coin);
        const newAch = updateStat(player.id, "earned", coin);
        player.sendMessage(
          `\n§a§l[Achievement]§r §a${ach.label} §fdiklaim!\n` +
          `§8  Reward: §e+${fmt(coin)} Koin\n`
        );
        for (const a of newAch)
          player.sendMessage(`\n§d§l[Achievement]§r §f${a.label} §eterbuka!\n§8  Klaim di §f/lt:daily\n`);
        if (ach.target >= CFG.BROADCAST_THRESHOLD) {
          world.sendMessage(
            `\n§6§l[Achievement]§r §e${player.name} §fmembuka §6§l${ach.label}§r\n` +
            `§8  ${ach.desc}\n`
          );
        }
      }
    }
  }
}
