// daily/ui.js — UI forms for Daily Login, Quest & Achievement
// Premium UI Design v2.0 — Multi-tier Quest System
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { world } from "@minecraft/server";
import { DAILY_CFG as CFG, SFX } from "./config.js";
import { getStreakInfo } from "./login.js";
import { trackFlow } from "../eco_flow.js";
import {
  getQuests, submitQuestItems,
  claimQuestReward, claimTierBonus,           // legacy (unused after fix)
  peekQuestReward, commitQuestClaim,
  peekTierBonus, commitTierBonus,
  getTierSummary, getResetCountdown, TIER_KEYS, TIER_META,
} from "./quest.js";
import { getAchievements, getAchievementSummary, peekAchievement, commitAchievement, claimAchievement, getStats, updateStat } from "./achievement.js";
import { UIClose } from "../ui_close.js";
import { applySubsidy, SUBSIDY_CFG } from "../Tax/wealth.js";
import { isEidActive, getEidTimeLeft, getEidQuestInfo, getEidQuestReset } from "../eid_quest.js";

// ═══════════════════════════════════════════════════════════
// SFX HELPER — wrap supaya 1-line di call site & error-tolerant
// (sound effect adalah polish; gagal play tidak boleh ganggu UX).
// ═══════════════════════════════════════════════════════════
function playSfx(player, s) {
  try { player.playSound(s.id, { pitch: s.pitch, volume: s.vol }); } catch { }
}

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
  if (pct >= 75) return `§2${pct}%%`;
  if (pct >= 50) return `§e${pct}%%`;
  return `§6${pct}%%`;
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
    const loginInfo = getStreakInfo(player);
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
    body += `§6  ★ D A I L Y   S Y S T E M\n`;
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

    // Event Quest (Shard) — only show when event is active
    const eventActive = isEidActive();
    let eventQuestCount = 0, eventDoneCount = 0;
    if (eventActive) {
      try {
        const eInfo = getEidQuestInfo(player);
        eventQuestCount = eInfo.quests.length;
        eventDoneCount = eInfo.quests.filter(q => q.done).length;
        body += `  §6◆ §eEvent Shard\n`;
        body += `  §8├ §f${eventDoneCount}§8/${eventQuestCount}  ${progressBar(eventDoneCount, eventQuestCount, 8)}\n`;
        body += `  §8├ §6Shard: §f${eInfo.token} ◆\n`;
        const timeLeft = getEidTimeLeft();
        body += `  §8└ §8Event: §a${timeLeft ?? "Aktif"}\n`;
      } catch { }
      body += `${SP}\n`;
    }

    // Achievement
    body += `  §d✿ §eAchievement\n`;
    body += `  §8├ §f${achSummary.claimed}§8/${achSummary.total}  ${progressBar(achSummary.claimed, achSummary.total, 8)}\n`;
    if (achSummary.claimable > 0)
      body += `  §8└ §e${achSummary.claimable} baru!\n`;
    else
      body += `  §8└ §8${achSummary.unlocked} terbuka\n`;

    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title("§8 ♦ §6DAILY§r §8♦ §r")
      .body(body);
    const btns = [];

    // Login button
    if (loginInfo.claimedToday) {
      form.button(`§8  Login Reward\n§r  §8Sudah diklaim`, "textures/items/clock_item");
    } else {
      const nextDay = (loginInfo.streak % 7) + 1;
      const nextCoin = CFG.LOGIN_REWARDS[loginInfo.streak % 7].coin;
      form.button(`§a  Klaim Login!\n§r  §eHari ke-${nextDay} §8| §e${nextCoin} Koin`, "textures/items/clock_item");
    }
    btns.push("login");

    // Quest button
    const qBadge = totalClaimable > 0 ? ` §c(${totalClaimable})` : "";
    form.button(`§b  Quest${qBadge}\n§r  §e${totalDone}/${totalQuests} selesai`, "textures/items/book_writable");
    btns.push("quest");

    // Achievement button
    const aBadge = achSummary.claimable > 0 ? ` §c(${achSummary.claimable})` : "";
    form.button(`§d  Achievement${aBadge}\n§r  §e${achSummary.claimed}/${achSummary.total} diklaim`, "textures/items/nether_star");
    btns.push("achievement");

    // Event Quest button — only when active
    if (eventActive) {
      form.button(`§6  Event Shard\n§r  §e${eventDoneCount}/${eventQuestCount} quest`, "textures/items/gold_nugget");
      btns.push("event");
    }

    form.button("§6  Kembali", "textures/items/arrow");
    btns.push("back");

    playSfx(player, SFX.OPEN);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "back") return;
    if (btns[res.selection] === "login") await uiLoginDetail(player);
    else if (btns[res.selection] === "quest") await uiQuestTierSelector(player);
    else if (btns[res.selection] === "achievement") await uiAchievementCategories(player);
    else if (btns[res.selection] === "event") await uiEventQuest(player);
  }
}

// ═══════════════════════════════════════════════════════════
// LOGIN DETAIL — 7-Day Calendar
// ═══════════════════════════════════════════════════════════
async function uiLoginDetail(player) {
  const info = getStreakInfo(player);
  const claimedIdx = (info.streak - 1) % 7;

  let body = `${LINE}\n`;
  body += `§6  ★ L O G I N   R E W A R D\n`;
  body += `${LINE}\n${SP}\n`;
  body += `  §6✦ §eStreak §8── §6${info.streak} hari\n`;
  body += `  §b◆ §eTotal  §8── §b${info.totalDays} hari\n`;
  body += `${SP}\n${LINE_THIN}\n`;
  body += `  §6 REWARD CALENDAR\n`;
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

    if (isCurrent) body += `  §e▸ §6Hari ${i + 1} §r§e${fmt(r.coin)} Koin §6◀\n`;
    else if (isPast) body += `  §a✔ §8Hari ${i + 1} §8${fmt(r.coin)} Koin\n`;
    else if (isBonus) body += `  §8■ §dHari ${i + 1} §d${fmt(r.coin)} Koin §r§d★\n`;
    else body += `  §8■ §8Hari ${i + 1} §8${fmt(r.coin)} Koin\n`;
  }

  body += `${SP}\n${LINE_THIN}\n`;
  body += info.claimedToday ? `  §a✔ §aKembali besok!\n` : `  §c⚠ §cStreak reset jika skip!\n`;
  body += `${LINE}`;

  const form = new ActionFormData().title("§8 ♦ §eLOGIN§r §8♦ §r").body(body);
  if (info.claimedToday) form.button("§8  Sudah Diklaim\n§r  §8Kembali besok", "textures/items/clock_item");
  form.button("§6  Kembali", "textures/items/arrow");
  playSfx(player, SFX.PAGE);
  await form.show(player);
}

// ═══════════════════════════════════════════════════════════
// EVENT QUEST — Shard quest progress detail
// [§4.1] Color consistency, formatted numbers, gem upsell CTA
// [Designer] Funnel: Quest progress → Shard earned → Show premium items → /pvp
// ═══════════════════════════════════════════════════════════
async function uiEventQuest(player) {
  const info = getEidQuestInfo(player);
  const timeLeft = getEidTimeLeft();
  const resetIn = getEidQuestReset();
  const doneCount = info.quests.filter(q => q.done).length;

  let body = `${LINE}\n`;
  body += `§6  ◆ E V E N T   S H A R D\n`;
  body += `${LINE}\n${SP}\n`;
  body += `  §6◆ §eShard Kamu §8── §6${fmt(info.token)} ◆\n`;
  body += `  §e◷ §eEvent Berakhir §8── §a${timeLeft ?? "Aktif"}\n`;
  body += `  §e◷ §eQuest Reset §8── §f${resetIn}\n`;
  body += `${SP}\n${LINE_THIN}\n`;
  body += `  §6 QUEST HARIAN §8(max 3 Shard/hari)\n`;
  body += `${LINE_THIN}\n${SP}\n`;

  for (const q of info.quests) {
    const bar = progressBar(q.current, q.target, 8);
    if (q.done) {
      body += `  §a✔ ${q.label} §a${q.target}/${q.target} §8── §a+1 ◆\n`;
    } else {
      body += `  §e▸ ${q.label} §f${q.current}§8/${q.target}  ${bar}\n`;
    }
  }

  body += `${SP}\n${LINE_THIN}\n`;
  if (doneCount >= info.quests.length) {
    body += `  §a✔ §aSemua quest selesai hari ini!\n`;
    body += `  §8  Kembali besok untuk kumpul lagi.\n`;
  } else {
    body += `  §7Kill hewan di peternakan/liar.\n`;
    body += `  §7Setiap quest selesai = §6+1 Shard ◆\n`;
  }

  // ── Gem Sales Funnel: Show what Shards unlock ──
  body += `${SP}\n${LINE_THIN}\n`;
  body += `  §d★ BELI KILL EFFECT DENGAN SHARD\n`;
  body += `${LINE_THIN}\n`;
  body += `  §8├ §dHacker RGB    §8── §b15 Gem §8+ §65 ◆\n`;
  body += `  §8├ §dDragon Fire   §8── §b20 Gem §8+ §610 ◆\n`;
  body += `  §8├ §dIce Blizzard  §8── §b25 Gem §8+ §612 ◆\n`;
  body += `  §8├ §dCrystal Geode §8── §b30 Gem §8+ §615 ◆\n`;
  body += `  §8│\n`;
  body += `  §8├ §eToxic         §8── §e15.000 ⛃ §8+ §63 ◆\n`;
  body += `  §8└ §eGravity Hammer§8── §e50.000 ⛃ §8+ §67 ◆\n`;
  body += `${SP}\n`;
  body += `  §7Buka §c/pvp §7→ §dKill Effect §7untuk beli!\n`;
  body += `  §bGem §7bisa dibeli di §e§ntopup.laughtale.id\n`;
  body += `${LINE}`;

  const form = new ActionFormData()
    .title("§8 ♦ §6EVENT◆§r §8♦ §r")
    .body(body);
  form.button(`§c  Buka Kill Effect\n§r  §eBeli di /pvp`, "textures/items/diamond_sword");
  form.button("§6  Kembali", "textures/items/arrow");
  playSfx(player, SFX.PAGE);
  const res = await form.show(player);
  if (res.canceled) throw new UIClose();
  // Button 0 = open PvP menu
  if (res.selection === 0) {
    player.sendMessage(`\n§8═══════════════════\n§d  ★ KILL EFFECT\n§8═══════════════════\n§7Ketik §c/pvp §7di chat untuk\n§7membuka menu Kill Effect!\n§8═══════════════════\n`);
  }
}
// ═══════════════════════════════════════════════════════════
// QUEST TIER SELECTOR — Choose daily/weekly/monthly
// ═══════════════════════════════════════════════════════════
async function uiQuestTierSelector(player) {
  while (true) {
    let body = `${LINE}\n`;
    body += `§b  ★ Q U E S T\n`;
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
      .title("§8 ♦ §bQUEST§r §8♦ §r")
      .body(body);
    const btns = [];

    for (const tier of TIER_KEYS) {
      const m = TIER_META[tier];
      const s = getTierSummary(player.id, tier);
      const claimable = s.claimable + (s.bonusReady ? 1 : 0);
      const badge = claimable > 0 ? ` §c(${claimable})` : "";
      const cd = getResetCountdown(tier);

      form.button(`${m.color}  ${m.label}${badge}\n§r  §e${s.done}/${s.total} §8| §f${cd}`, m.texture);
      btns.push(tier);
    }

    form.button("§6  Kembali", "textures/items/arrow");
    btns.push("back");

    playSfx(player, SFX.PAGE);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "back") return;
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
    body += `${m.color}  ${m.icon} Q U E S T   ${m.label.toUpperCase()}\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §e◷ §eReset: §f${cd}\n`;
    body += `  ${m.color}${m.icon} §f${summary.done}§8/${summary.total} §8| ${progressBar(summary.done, summary.total, 8)}\n`;
    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title(`§8 ♦ ${m.color}${m.label.toUpperCase()}§r §8♦ §r`)
      .body(body);
    const btns = [];

    for (let i = 0; i < quests.length; i++) {
      const q = quests[i];
      const bar = progressBar(q.progress, q.amount, 6);
      let label;

      if (q.claimed) {
        label = `§8  ${q.label}\n§r  §8Diklaim | +${fmt(q.reward)}`;
      } else if (q.completed) {
        label = `§a  ${q.label}\n§r  §eKlaim §e${fmt(q.reward)} Koin!`;
      } else if (q.type === "submit") {
        label = `${m.color}  ${q.label}\n§r  ${bar} §f${q.progress}/${q.amount} §8| §e${fmt(q.reward)}⛃ ${m.color}| Serahkan`;
      } else {
        label = `§e  ${q.label}\n§r  ${bar} §f${q.progress}/${q.amount} §8| §e${fmt(q.reward)}⛃`;
      }
      form.button(label, q.claimed ? "textures/items/book_normal" : q.completed ? "textures/items/book_writable" : "textures/items/book_writable");
      btns.push({ action: "quest", idx: i });
    }

    // Completion bonus button
    if (summary.bonusReady) {
      form.button(`§6  BONUS KOMPLIT!\n§r  §eKlaim §e${fmt(summary.bonus)} Koin!`, "textures/items/nether_star");
      btns.push({ action: "bonus" });
    } else if (summary.bonusClaimed) {
      form.button(`§8  Bonus Diklaim\n§r  §8+${fmt(summary.bonus)} Koin`, "textures/items/nether_star");
      btns.push({ action: "none" });
    } else {
      const remain = summary.total - summary.claimed;
      form.button(`§8  Bonus Komplit\n§r  §8Selesaikan ${remain} lagi | §e${fmt(summary.bonus)}⛃`, "textures/items/nether_star");
      btns.push({ action: "none" });
    }

    form.button("§6  Kembali", "textures/items/arrow");
    btns.push({ action: "back" });

    playSfx(player, SFX.PAGE);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();

    const btn = btns[res.selection];
    if (btn.action === "back") return;
    if (btn.action === "none") continue;

    if (btn.action === "bonus") {
      // [§2] Peek-then-commit: pay first, mark claimed only on success.
      const coin = peekTierBonus(player.id, tier);
      if (coin > 0) {
        if (!addCoin(player, coin)) {
          player.sendMessage("§8[§cQuest§8]§c Gagal kasih reward, coba lagi sebentar.");
          playSfx(player, SFX.FAIL);
          continue;
        }
        commitTierBonus(player.id, tier);
        trackFlow("quest_reward", coin);
        const sub = applySubsidy(player, coin * SUBSIDY_CFG.QUEST_MULT);
        const achA = updateStat(player.id, "questsDone", 1);
        const achB = updateStat(player.id, "earned", coin + sub);
        player.sendMessage(`§8[§fBONUS§8]§f ${m.label} komplit! §e+${fmt(coin)} Koin` + (sub > 0 ? ` §a(+${fmt(sub)} subsidi)` : ``));
        playSfx(player, SFX.BONUS);
        for (const ach of [...achA, ...achB]) {
          player.sendMessage(`§8[§fAchievement§8]§f ${ach.label} terbuka!`);
          playSfx(player, SFX.ACH_UNLOCK);
        }
      }
      continue;
    }

    // Quest interaction
    const q = quests[btn.idx];
    if (q.claimed) continue;

    if (q.completed && !q.claimed) {
      // [§2] Peek-then-commit: pay first, mark claimed only on success.
      const coin = peekQuestReward(player.id, tier, btn.idx);
      if (coin > 0) {
        if (!addCoin(player, coin)) {
          player.sendMessage("§8[§cQuest§8]§c Gagal kasih reward, coba lagi sebentar.");
          playSfx(player, SFX.FAIL);
          continue;
        }
        commitQuestClaim(player.id, tier, btn.idx);
        trackFlow("quest_reward", coin);
        const sub = applySubsidy(player, coin * SUBSIDY_CFG.QUEST_MULT);
        const achA = updateStat(player.id, "questsDone", 1);
        const achB = updateStat(player.id, "earned", coin + sub);
        player.sendMessage(`§f[${m.label}] ${q.label} selesai! §e+${fmt(coin)} Koin` + (sub > 0 ? ` §a(+${fmt(sub)} subsidi)` : ``));
        playSfx(player, SFX.CLAIM);
        for (const ach of [...achA, ...achB]) {
          player.sendMessage(`§8[§fAchievement§8]§f ${ach.label} terbuka!`);
          playSfx(player, SFX.ACH_UNLOCK);
        }
      }
      continue;
    }

    if (q.type === "submit" && !q.completed) {
      const result = submitQuestItems(player, tier, btn.idx);
      if (result.success) {
        player.sendMessage(
          `\n${m.color}[${m.label}]§r §fDiserahkan ${m.color}${result.taken}x\n` +
          `§8  Progress: §f${result.progress}/${result.total} ${miniBar(result.progress, result.total)}\n`
        );
        playSfx(player, result.completed ? SFX.QUEST_DONE : SFX.SUBMIT);
        if (result.completed)
          player.sendMessage(`§e[${m.label}]§r §e${result.label} §fselesai! Klaim di menu.\n`);
      } else {
        player.sendMessage(`§c[${m.label}]§r §cItem tidak ditemukan!\n`);
        playSfx(player, SFX.FAIL);
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
const CAT_TEXTURE = {
  Combat: "textures/items/diamond_sword", Mining: "textures/items/diamond_pickaxe",
  Building: "textures/items/brick", Economy: "textures/items/gold_ingot",
  Login: "textures/items/clock_item", Quest: "textures/items/book_writable",
};

async function uiAchievementCategories(player) {
  while (true) {
    const cats = getAchievements(player.id);
    const stats = getStats(player.id);

    let body = `${LINE}\n`;
    body += `§d  ★ A C H I E V E M E N T\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §6 STATISTIK\n`;
    body += `${LINE_THIN}\n`;
    body += `  §c⚔ §eKills  §8── §f${fmt(stats.kills)}\n`;
    body += `  §b◆ §eMined  §8── §f${fmt(stats.mined)}\n`;
    body += `  §a⬛ §ePlaced §8── §f${fmt(stats.placed)}\n`;
    body += `  §e❖ §eEarned §8── §e${fmt(stats.earned)}\n`;
    body += `  §d✦ §eLogin  §8── §f${fmt(stats.loginDays)}\n`;
    body += `  §6✎ §eQuests §8── §f${fmt(stats.questsDone)}\n`;
    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title("§8 ♦ §dACHIEVEMENT§r §8♦ §r")
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

      form.button(`${color}  ${catName}${badge}\n§r  ${bar} §e${cc}/${list.length}`, CAT_TEXTURE[catName] || "textures/items/book_normal");
      btns.push(catName);
    }

    form.button("§6  Kembali", "textures/items/arrow");
    btns.push("back");

    playSfx(player, SFX.PAGE);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "back") return;
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
    body += `${color}  ${icon} ${catName.toUpperCase()}\n`;
    body += `${LINE}\n${SP}\n`;
    body += `  §eProgress: §f${cc}§8/${list.length}  ${progressBar(cc, list.length, 8)}\n`;
    body += `${SP}\n${LINE}`;

    const form = new ActionFormData()
      .title(`§8 ♦ ${color}${catName.toUpperCase()}§r §8♦ §r`)
      .body(body);
    const btns = [];

    for (const ach of list) {
      const bar = progressBar(ach.current, ach.target, 6);
      let label;

      if (ach.claimed) {
        label = `§8  ${ach.label}\n§r  §8Diklaim | +${fmt(ach.reward)}`;
      } else if (ach.unlocked) {
        label = `§a  ${ach.label}\n§r  §eKlaim §e${fmt(ach.reward)} Koin!`;
      } else {
        label = `§e  ${ach.label}\n§r  ${bar} §f${fmt(ach.current)}/${fmt(ach.target)} §8| §e${fmt(ach.reward)}⛃`;
      }
      form.button(label, ach.claimed ? "textures/items/book_normal" : ach.unlocked ? "textures/items/nether_star" : "textures/items/book_writable");
      btns.push(ach.id);
    }

    form.button("§6  Kembali", "textures/items/arrow");
    btns.push("back");

    playSfx(player, SFX.PAGE);
    const res = await form.show(player);
    if (res.canceled) throw new UIClose();
    if (btns[res.selection] === "back") return;

    const achId = btns[res.selection];
    const ach = list.find(a => a.id === achId);
    if (ach && ach.unlocked && !ach.claimed) {
      // [§2] Peek-then-commit: pay first, mark claimed only on success.
      const coin = peekAchievement(player.id, achId);
      if (coin > 0) {
        if (!addCoin(player, coin)) {
          player.sendMessage("§8[§cAchievement§8]§c Gagal kasih reward, coba lagi sebentar.");
          playSfx(player, SFX.FAIL);
          continue;
        }
        commitAchievement(player.id, achId);
        trackFlow("achievement_reward", coin);
        const sub = applySubsidy(player, coin * SUBSIDY_CFG.QUEST_MULT);
        const newAch = updateStat(player.id, "earned", coin + sub);
        player.sendMessage(`§8[§fAchievement§8]§f ${ach.label} diklaim! §e+${fmt(coin)} Koin` + (sub > 0 ? ` §a(+${fmt(sub)} subsidi)` : ``));
        playSfx(player, SFX.CLAIM_BIG);
        for (const a of newAch) {
          player.sendMessage(`§8[§fAchievement§8]§f ${a.label} terbuka!`);
          playSfx(player, SFX.ACH_UNLOCK);
        }
        if (ach.target >= CFG.BROADCAST_THRESHOLD) {
          world.sendMessage(`§8[§fAchievement§8]§f ${player.name} membuka ${ach.label}`);
        }
      }
    }
  }
}
