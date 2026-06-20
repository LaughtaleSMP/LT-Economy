// welcome/commands.js — Daftar command lengkap.
import { ActionFormData } from "@minecraft/server-ui";
import { HR, HR_THIN } from "./_shared.js";

export async function guideCommands(player) {
  let body = `${HR}\n`;
  body += `§f  ★ DAFTAR COMMAND\n`;
  body += `${HR}\n\n`;
  body += `  §eCOMMAND UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §e/bank      §8── §fBuka Bank Koin\n`;
  body += `  §8├ §8/auction   §8── §7Via NPC Market di spawn\n`;
  body += `  §8├ §8/store     §8── §7Via NPC Market di spawn\n`;
  body += `  §8├ §e/daily     §8── §fBuka Daily System\n`;
  body += `  §8├ §8/gacha     §8── §7Via NPC Market di spawn\n`;
  body += `  §8├ §e/guide     §8── §fBuka panduan ini\n`;
  body += `  §8├ §8/lt:lb     §8── §7Lihat hologram spawn\n`;
  body += `  §8├ §e/lt:stats  §8── §fStatistik Pribadi\n`;
  body += `  §8├ §e/lt:stagflation §8── §fStatus stimulus ekonomi\n`;
  body += `  §8├ §e/monitor   §8── §fServer Monitor §c(Admin)\n\n`;
  body += `  §eCHAT COMMAND\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §c/pvp       §8── §fBuka Combat PvP Menu\n`;
  body += `  §8  §c/pvpon     §8── §fAktifkan PvP langsung\n`;
  body += `  §8  §c/pvpoff    §8── §fNonaktifkan PvP\n\n`;
  body += `  §eITEM TRIGGER\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §2Mimi Land Item §8── §fBuka Land Menu\n\n`;
  body += `  §eTIPS\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fLogin setiap hari untuk streak reward\n`;
  body += `  §8├ §fSelesaikan quest untuk koin extra\n`;
  body += `  §8├ §fGunakan Auction untuk jual item\n`;
  body += `  §8├ §fKlaim land untuk proteksi bangunan\n`;
  body += `  §8└ §fAktifkan PvP untuk earn koin dari kill\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §fCOMMAND§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}
