// npc/role_luffy.js — Luffy: Kapten (Daily Quest Hub + Streak Blessing)
import { ActionFormData } from "@minecraft/server-ui";
import { openDailyMenu } from "../daily/ui.js";
import { getStreakInfo } from "../daily/login.js";
import { pGet, pSet } from "../player_dp.js";

const K_BLESS = "npc:luffy_bless";
const MS_PER_DAY = 86400000;
const STREAK_MIN = 3;
const BUFF_DUR = 6000;

function getCurrentDay() { return Math.floor(Date.now() / MS_PER_DAY); }

export async function openLuffyMenu(player, greeting) {
  const si = getStreakInfo(player);
  const day = getCurrentDay();
  const blessData = pGet(player, K_BLESS, { lastDay: -1 });
  const blessReady = si.streak >= STREAK_MIN && blessData.lastDay !== day;
  const blessText = si.streak < STREAK_MIN
    ? `§7Streak §e${STREAK_MIN}+ §7diperlukan`
    : blessReady ? "§aSiap" : "§cDiklaim";

  const form = new ActionFormData()
    .title("§8« §cLuffy §8»")
    .body(
      `  §f§o"${greeting}"§r\n\n` +
      `  §8Streak §f${si.streak} hari §8· §8Total §f${si.totalDays} hari\n` +
      `  §8Blessing  ${blessText}`
    )
    .button("§b  Daily Quest\n§r§8Quest & Achievement", "textures/items/book_writable")
    .button(`§6  Streak Blessing\n§r§8Speed I 5min ${blessReady ? "§a[Gratis]" : `§7[${blessText}§7]`}`, "textures/items/blaze_powder")
    .button("§c  Tutup", "textures/items/barrier");

  const res = await form.show(player);
  if (res.canceled || res.selection === 2) return;

  if (res.selection === 0) {
    await openDailyMenu(player);
    return;
  }

  if (res.selection === 1) {
    if (si.streak < STREAK_MIN) {
      player.sendMessage(`§8[§cLuffy§8]§c Streak minimal §e${STREAK_MIN} hari§c. Sekarang §e${si.streak}§c.`);
      return;
    }
    if (!blessReady) {
      player.sendMessage("§8[§cLuffy§8]§c Sudah diklaim hari ini. Besok ya!");
      return;
    }

    try {
      player.addEffect("speed", BUFF_DUR, { amplifier: 0, showParticles: true });
    } catch { player.sendMessage("§cGagal memberi efek."); return; }

    pSet(player, K_BLESS, { lastDay: day });
    player.sendMessage(
      `§8[§cLuffy§8]§6 Berkah Kapten!\n` +
      `  §a+ Speed I §7(5 menit)\n` +
      `  §7Streak §e${si.streak} hari §8- §7"Terus login, nakama!"`
    );
    try { player.playSound("random.totem", { pitch: 1.6, volume: 0.7 }); } catch {}
  }
}
