// npc/role_furina.js — Furina: Lucky Wheel + Gacha exclusive
import { system, world } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { getCoin, addCoin, fmt } from "../store/helpers.js";
import { openGachaNPC } from "../gacha/main.js";
import { trackFlow } from "../eco_flow.js";
import { pGet, pSet } from "../player_dp.js";

const EXTRA_SPIN_COST = 200;
const MS_PER_DAY = 86400000;
const K_WHEEL = "npc:furina_wheel";

const WHEEL_REWARDS = [
  { w: 40, type: "coin", min: 10,  max: 30,  label: "§e{n} Koin",            tier: "§7" },
  { w: 25, type: "coin", min: 50,  max: 100, label: "§e{n} Koin",            tier: "§a" },
  { w: 15, type: "buff", effect: "speed",      amp: 0, dur: 3600, label: "§bSpeed I §7(3 mnt)",       tier: "§b" },
  { w: 8,  type: "buff", effect: "haste",      amp: 0, dur: 3600, label: "§6Haste I §7(3 mnt)",       tier: "§d" },
  { w: 7,  type: "coin", min: 200, max: 500, label: "§e{n} Koin",            tier: "§d" },
  { w: 3,  type: "buff", effect: "jump_boost", amp: 1, dur: 6000, label: "§aJump II §7(5 mnt)",       tier: "§6" },
  { w: 2,  type: "coin", min: 1000,max: 2000,label: "§6{n} JACKPOT!",         tier: "§6" },
];
const TOTAL_W = WHEEL_REWARDS.reduce((s, r) => s + r.w, 0);

function rollWheel() {
  let roll = Math.random() * TOTAL_W;
  for (const r of WHEEL_REWARDS) { roll -= r.w; if (roll <= 0) return r; }
  return WHEEL_REWARDS[0];
}

function getWheelData(player) {
  return pGet(player, K_WHEEL, { lastDay: -1, freeUsed: false });
}

function getCurrentDay() { return Math.floor(Date.now() / MS_PER_DAY); }

function applyReward(player, reward) {
  if (reward.type === "coin") {
    const n = reward.min + Math.floor(Math.random() * (reward.max - reward.min + 1));
    addCoin(player, n);
    trackFlow("lucky_wheel", n);
    return { label: reward.label.replace("{n}", fmt(n)), n, isJackpot: reward.min >= 1000 };
  }
  if (reward.type === "buff") {
    try { player.addEffect(reward.effect, reward.dur, { amplifier: reward.amp, showParticles: true }); } catch {}
    return { label: reward.label, n: 0, isJackpot: false };
  }
  return { label: "???", n: 0, isJackpot: false };
}

export async function openFurinaMenu(player, greeting) {
  const day = getCurrentDay();
  const wd = getWheelData(player);
  if (wd.lastDay !== day) { wd.freeUsed = false; wd.lastDay = day; }
  const freeAvail = !wd.freeUsed;

  const form = new ActionFormData()
    .title("§8« §9Furina §8»")
    .body(
      `  §f§o"${greeting}"§r\n\n` +
      `  §8Free spin  ${freeAvail ? "§aTersedia" : "§cTerpakai"}`
    )
    .button(`§e  Lucky Wheel\n§r§8Putar roda ${freeAvail ? "§a[Gratis]" : `§7[${fmt(EXTRA_SPIN_COST)}⛃]`}`, "textures/items/nether_star")
    .button("§d  Gacha Hub\n§r§8Partikel & peralatan", "textures/items/nether_star")
    .button("§c  Tutup", "textures/items/barrier");

  const res = await form.show(player);
  if (res.canceled || res.selection === 2) return;

  if (res.selection === 1) {
    await openGachaNPC(player);
    return;
  }

  // Lucky Wheel
  if (!freeAvail) {
    const bal = getCoin(player);
    if (bal < EXTRA_SPIN_COST) {
      player.sendMessage(`§8[§9Furina§8]§c Spin habis. Extra §e${fmt(EXTRA_SPIN_COST)}⛃§c, punya §e${fmt(bal)}⛃§c.`);
      return;
    }
    const c = new MessageFormData()
      .title("§8« §9Extra Spin §8»")
      .body(`§7Bayar §e${fmt(EXTRA_SPIN_COST)}⛃ §7untuk spin?\n\n§8Saldo: §e${fmt(bal)} §8-> §e${fmt(bal - EXTRA_SPIN_COST)}`)
      .button1("§a Spin!")
      .button2("§c Batal");
    const cr = await c.show(player);
    if (cr.canceled || cr.selection === 1) return;
    const realBal = getCoin(player);
    if (realBal < EXTRA_SPIN_COST) { player.sendMessage("§cSaldo berubah."); return; }
    addCoin(player, -EXTRA_SPIN_COST);
    trackFlow("lucky_wheel_fee", -EXTRA_SPIN_COST);
  } else {
    wd.freeUsed = true;
    pSet(player, K_WHEEL, wd);
  }

  // Animasi
  player.sendMessage("§8[§9Furina§8]§9 Roda berputar...");
  try { player.playSound("note.pling", { pitch: 0.8, volume: 0.7 }); } catch {}
  await new Promise(r => system.runTimeout(r, 30));
  try { player.playSound("note.pling", { pitch: 1.0, volume: 0.8 }); } catch {}
  await new Promise(r => system.runTimeout(r, 20));
  try { player.playSound("note.pling", { pitch: 1.4, volume: 0.9 }); } catch {}
  await new Promise(r => system.runTimeout(r, 10));

  if (!player?.isValid) return;

  const reward = rollWheel();
  const result = applyReward(player, reward);

  player.sendMessage(
    `\n§8[§9Furina§8]§9 Hasil Lucky Wheel:\n` +
    `  ${reward.tier} * ${result.label}\n`
  );
  try { player.playSound(result.isJackpot ? "random.totem" : "random.levelup", { pitch: 1.2, volume: 1.0 }); } catch {}

  if (result.isJackpot) {
    try { world.sendMessage(`§8[§6Lucky§8]§6 * ${player.name} §fmendapat ${result.label} §fdari Lucky Wheel!`); } catch {}
  }
}
