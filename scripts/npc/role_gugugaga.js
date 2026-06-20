// npc/role_gugugaga.js — Gugugaga: Mood System enhancement
import { pGet, pSet } from "../player_dp.js";
import { ActionFormData } from "@minecraft/server-ui";

const K_MOOD = "npc:gugu_mood";
const MS_PER_DAY = 86400000;

function getCurrentDay() { return Math.floor(Date.now() / MS_PER_DAY); }

/**
 * Mood tiers:
 * - happy: fed hari ini → reward 2x
 * - neutral: fed kemarin → reward 1x
 * - hungry: 2+ hari tidak fed → reward 0.5x
 */
export function getGuguMood(player) {
  const data = pGet(player, K_MOOD, { lastFedDay: -1, feedCount: 0 });
  const day = getCurrentDay();
  const diff = day - data.lastFedDay;

  if (diff === 0) return { mood: "happy", mult: 2.0, emoji: "§a:D", label: "§aHappy", data };
  if (diff === 1) return { mood: "neutral", mult: 1.0, emoji: "§e:|", label: "§eNeutral", data };
  return { mood: "hungry", mult: 0.5, emoji: "§c:(", label: "§cHungry", data };
}

export function markFed(player) {
  const day = getCurrentDay();
  const data = pGet(player, K_MOOD, { lastFedDay: -1, feedCount: 0 });
  data.lastFedDay = day;
  data.feedCount = (data.feedCount || 0) + 1;
  pSet(player, K_MOOD, data);
}

export function getMoodMultiplier(player) {
  return getGuguMood(player).mult;
}

export async function openGuguMoodMenu(player, greeting) {
  const { mood, emoji, label, data } = getGuguMood(player);

  const moodDialog = {
    happy:   "§aGugu gugu GAGAA~!!",
    neutral: "§eGugu... gaga.",
    hungry:  "§cGu...gu...ga...ga...",
  };

  const moodHint = {
    happy:   "§8Reward §e2x",
    neutral: "§8Reward §fnormal",
    hungry:  "§8Reward §c0.5x §8· kasih makan!",
  };

  const form = new ActionFormData()
    .title("§8« §eGugugaga §8»")
    .body(
      `  §f§o"${greeting}"§r\n\n` +
      `  §8Mood  ${emoji} ${label}\n` +
      `  ${moodDialog[mood]}\n` +
      `  ${moodHint[mood]}\n\n` +
      `  §8Makan §f${data.feedCount || 0}x §8· §8Pegang ikan, klik NPC`
    )
    .button("§c  Tutup", "textures/items/barrier");

  await form.show(player);
}
