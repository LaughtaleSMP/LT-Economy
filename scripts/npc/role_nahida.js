// npc/role_nahida.js — Nahida: Si Bijak (Info Hub + Daily Wisdom)
import { world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { getCoin, addCoin, fmt } from "../store/helpers.js";
import { pGet, pSet } from "../player_dp.js";
import { trackFlow } from "../eco_flow.js";
import { getStreakInfo } from "../daily/login.js";

const K_WISDOM = "npc:nahida_wisdom";
const MS_PER_DAY = 86400000;
const WISDOM_COIN_MIN = 10;
const WISDOM_COIN_MAX = 30;
const COIN_OBJ = "coin";

function getCurrentDay() { return Math.floor(Date.now() / MS_PER_DAY); }

const WISDOM_TIPS = [
  { tip: "Jual item langka di Auction — harga lebih baik dari Store!", cat: "Ekonomi" },
  { tip: "Streak login 7 hari = bonus koin besar di hari ke-7!", cat: "Daily" },
  { tip: "Kunjungi Alice untuk healing gratis sebelum farming!", cat: "Tips" },
  { tip: "Furina punya Lucky Wheel gratis setiap hari!", cat: "Tips" },
  { tip: "Kasih makan Gugugaga tiap hari — mood happy = 2x reward!", cat: "Tips" },
  { tip: "Simpan koin di bank agar aman dari PvP.", cat: "Ekonomi" },
  { tip: "Gacha punya pity system — semakin dekat ke jackpot.", cat: "Gacha" },
  { tip: "Kill Effect didapat dari Gacha — show di PvP!", cat: "Combat" },
  { tip: "Harga Store dinamis — berubah sesuai ekonomi server.", cat: "Ekonomi" },
  { tip: "Quest harian ada 3 tier: Harian, Mingguan, Bulanan.", cat: "Daily" },
  { tip: "UBI bisa diklaim kalau saldo rendah.", cat: "Ekonomi" },
  { tip: "Hologram spawn punya info penting. Baca dulu!", cat: "Info" },
];

function getLeaderboardText() {
  try {
    const obj = world.scoreboard.getObjective(COIN_OBJ);
    if (!obj) return "  §7Tidak ada data.";
    const scores = obj.getScores().sort((a, b) => b.score - a.score).slice(0, 5);
    if (!scores.length) return "  §7Belum ada data.";
    return scores.map((s, i) =>
      `  §${i === 0 ? "6" : i < 3 ? "e" : "7"}#${i + 1} §f${s.displayName} §8· §e${fmt(s.score)}⛃`
    ).join("\n");
  } catch { return "  §7Gagal memuat."; }
}

export async function openNahidaMenu(player, greeting) {
  const day = getCurrentDay();
  const wd = pGet(player, K_WISDOM, { lastDay: -1 });
  const wisdomReady = wd.lastDay !== day;

  const form = new ActionFormData()
    .title("§8« §aNahida §8»")
    .body(
      `  §f§o"${greeting}"§r\n\n` +
      `  §8Wisdom  ${wisdomReady ? "§aSiap" : "§cDiklaim"}`
    )
    .button("§e  Leaderboard\n§r§8Top 5 koin server", "textures/items/map_filled")
    .button("§b  Statistik Saya\n§r§8Progress & data", "textures/items/compass_item")
    .button(`§a  Daily Wisdom\n§r§8Tips + koin ${wisdomReady ? "§a[Klaim]" : "§c[Sudah]"}`, "textures/items/book_enchanted")
    .button("§c  Tutup", "textures/items/barrier");

  const res = await form.show(player);
  if (res.canceled || res.selection === 3) return;

  if (res.selection === 0) {
    const lb = getLeaderboardText();
    await new ActionFormData()
      .title("§8« §eLeaderboard §8»")
      .body(`  §6Top 5 Terkaya\n\n${lb}`)
      .button("§c Tutup")
      .show(player);
    return;
  }

  if (res.selection === 1) {
    const bal = getCoin(player);
    const si = getStreakInfo(player);
    await new ActionFormData()
      .title("§8« §bStatistik §8»")
      .body(
        `  §f${player.name}\n\n` +
        `  §8Koin      §e${fmt(bal)}⛃\n` +
        `  §8Streak    §f${si.streak} hari\n` +
        `  §8Total     §f${si.totalDays} hari\n` +
        `  §8Klaim     ${si.claimedToday ? "§aSudah" : "§cBelum"}`
      )
      .button("§c Tutup")
      .show(player);
    return;
  }

  if (res.selection === 2) {
    if (!wisdomReady) {
      player.sendMessage("§8[§aNahida§8]§c Sudah diklaim hari ini. Besok lagi~");
      return;
    }
    const tip = WISDOM_TIPS[Math.floor(Math.random() * WISDOM_TIPS.length)];
    const coin = WISDOM_COIN_MIN + Math.floor(Math.random() * (WISDOM_COIN_MAX - WISDOM_COIN_MIN + 1));

    addCoin(player, coin);
    trackFlow("daily_wisdom", coin);
    pSet(player, K_WISDOM, { lastDay: day });

    player.sendMessage(
      `\n§8[§aNahida§8]§a Daily Wisdom:\n` +
      `  §7[${tip.cat}] §f${tip.tip}\n` +
      `  §e+ ${fmt(coin)}⛃ §7bonus wisdom\n`
    );
    try { player.playSound("random.orb", { pitch: 1.4, volume: 0.8 }); } catch {}
  }
}
