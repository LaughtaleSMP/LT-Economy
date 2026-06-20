// welcome/economy.js — Guide pages untuk fitur ekonomi:
// Bank, Auction, Daily Quest, Store Build, Kebijakan Ekonomi.
import { ActionFormData } from "@minecraft/server-ui";
import { HR, HR_THIN, readPricing, readPolicyAdj } from "./_shared.js";

export async function guideBank(player) {
  const adj = readPolicyAdj();
  const base = 12;
  const eTax = base + adj;
  const adjTxt = adj > 0 ? ` §c(+${adj}%% stab)` : adj < 0 ? ` §a(${adj}%% stab)` : '';

  let body = `${HR}\n`;
  body += `§6  ★ BANK KOIN\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem transfer koin antar player\n`;
  body += `  §fdengan keamanan tinggi.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fTransfer koin ke player lain\n`;
  body += `  §8├ §fMinta koin (request system)\n`;
  body += `  §8├ §fRiwayat mutasi transaksi\n`;
  body += `  §8├ §fLeaderboard saldo tertinggi\n`;
  body += `  §8├ §a5x gratis §ftransfer per hari\n`;
  body += `  §8└ §fPajak progresif setelahnya\n\n`;
  body += `  §ePAJAK PROGRESIF${adjTxt}\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §f1-100    §8── §e${eTax}%%\n`;
  body += `  §8├ §f101-1K   §8── §e${eTax + 3}%%\n`;
  body += `  §8├ §f1K-3K    §8── §e${eTax + 6}%%\n`;
  body += `  §8├ §f3K+      §8── §e${eTax + 10}%%\n`;
  body += `  §8└ §8base ${base}%% + auto-stabilizer\n\n`;
  body += `  §eWEALTH TAX\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fSaldo > P75x3: §e0.5%%/hari\n`;
  body += `  §8├ §fSaldo > P75x10: §e1%%/hari\n`;
  body += `  §8├ §aPlayer online exempt\n`;
  body += `  §8└ §fMencegah penimbunan koin\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fKetik §e/bank §fatau §e/lt:bank\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §6BANK KOIN§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideAuction(player) {
  let body = `${HR}\n`;
  body += `§e  ★ AUCTION HOUSE\n`;
  body += `${HR}\n\n`;
  body += `  §fPasar jual beli item antar\n`;
  body += `  §fplayer dengan sistem aman.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fMode §eBuyout §8── §7harga tetap, beli langsung\n`;
  body += `  §8├ §fMode §bAuction §8── §7bid war, harga naik\n`;
  body += `  §8├ §fTawaran/nego harga §8(offer)\n`;
  body += `  §8├ §fBrowse per kategori item\n`;
  body += `  §8├ §fSorting §8── §7harga/waktu/nama\n`;
  body += `  §8├ §fAnti-snipe protection\n`;
  body += `  §8├ §fPending system §8── §7klaim offline\n`;
  body += `  §8└ §fCrash recovery otomatis\n\n`;
  body += `  §6FEE BERDASARKAN TIER\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §bPemula §8(<5.000 koin) §7── §a0%% fee\n`;
  body += `  §8├ §aMenengah §8(5K-50K) §7── §e1%% fee\n`;
  body += `  §8└ §6Premium §8(50K+) §7── §c3%% fee\n`;
  body += `  §8§oFee progresif mendukung player baru.\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fPergi ke §6NPC Market §fdi spawn\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §eAUCTION§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideDaily(player) {
  let body = `${HR}\n`;
  body += `§b  ★ DAILY QUEST SYSTEM\n`;
  body += `${HR}\n\n`;
  body += `  §fSistem quest & achievement\n`;
  body += `  §funtuk mendapatkan koin harian.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §6✦ §fDaily Login Reward §8(7 hari streak)\n`;
  body += `  §8├ §b◆ §fQuest Harian §8── §f3 quest acak\n`;
  body += `  §8├ §3◆ §fQuest Mingguan §8── §f4 quest\n`;
  body += `  §8├ §5◆ §fQuest Bulanan §8── §f5 quest\n`;
  body += `  §8├ §d★ §fAchievement System\n`;
  body += `  §8│ §8(Combat, Mining, Building, dll)\n`;
  body += `  §8└ §e✦ §fBonus komplit semua quest\n\n`;
  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKetik §e/daily §fatau §e/lt:daily\n`;
  body += `  §8└ §fLogin reward §aotomatis §ftiap masuk\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §bDAILY§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideStore(player) {
  const pr = readPricing();
  const basis = pr?.iph ?? 57;

  let body = `${HR}\n`;
  body += `§6  ★ STORE BAHAN BUILD\n`;
  body += `${HR}\n\n`;
  body += `  §fToko resmi server untuk beli\n`;
  body += `  §fblok, dekorasi, dan utility build.\n\n`;
  body += `  §eFITUR UTAMA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §f6 kategori: Basic, Wool, Decor,\n`;
  body += `  §8│ §f  Glass, Light, Utility\n`;
  body += `  §8├ §fHarga dinamis ikut ekonomi server\n`;
  body += `  §8├ §fTier harian progresif\n`;
  body += `  §8├ §f200 unit/kategori/hari\n`;
  body += `  §8├ §aBeli sedikit §8→ §amurah §8(ramah pemula)\n`;
  body += `  §8├ §cBorong banyak §8→ §cmahal §8(anti-monopoli)\n`;
  body += `  §8└ §fReset limit §f20:00 WIB §8tiap hari\n\n`;

  body += `  §eCARA KERJA TIER\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §a1-5u    §8── §atier ×1.0 §8(normal)\n`;
  body += `  §8├ §e6-20u   §8── §etier ×1.6 §8(+60%%)\n`;
  body += `  §8├ §621-50u  §8── §6tier ×2.8 §8(+180%%)\n`;
  body += `  §8├ §c51-100u §8── §ctier ×4.5 §8(+350%%)\n`;
  body += `  §8└ §4100+u   §8── §4tier ×7.0 §8(+600%%)\n\n`;

  body += `  §eBASIS EKONOMI\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fBasis saat ini §8── §e${basis}⛃/jam\n`;
  body += `  §8├ §fInflasi naik §8→ harga otomatis naik\n`;
  body += `  §8└ §fDeflasi turun §8→ harga otomatis turun\n\n`;

  body += `  §eCONTOH HARGA §8(wool putih)\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fBeli 1 stack awal   §8── §e${Math.ceil(0.55 * basis)}⛃\n`;
  body += `  §8├ §fBeli stack ke-6 §8──    §e${Math.ceil(0.55 * basis * 1.6)}⛃\n`;
  body += `  §8└ §fBeli stack ke-51 §8──   §c${Math.ceil(0.55 * basis * 4.5)}⛃\n\n`;

  body += `  §eCARA BUKA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fPergi ke §6NPC Market §fdi spawn\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §6STORE§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}

export async function guideEconomy(player) {
  let body = `${HR}\n`;
  body += `§d  ★ KEBIJAKAN EKONOMI\n`;
  body += `${HR}\n\n`;
  body += `  §fServer ini pakai sistem ekonomi\n`;
  body += `  §fdinamis agar koin tetap seimbang.\n\n`;

  body += `  §eTIER PLAYER §7(auction fee)\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §bPemula §8(<5.000) §7── §a0%% fee\n`;
  body += `  §8├ §aMenengah §8(5K-50K) §7── §e1%% fee\n`;
  body += `  §8└ §6Premium §8(50K+) §7── §c3%% fee\n`;
  body += `  §8§oFee progresif bantu player baru.\n\n`;

  body += `  §eWEALTH TAX §7(harian 20:00 WIB)\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fSaldo §e5K-20K §7── §c-0.5%%/hari\n`;
  body += `  §8├ §fSaldo §e20K-50K §7── §c-1.0%%/hari\n`;
  body += `  §8└ §fSaldo §e>50K §7── §c-2.0%%/hari\n`;
  body += `  §8§oMasuk treasury, dibagi lagi.\n\n`;

  body += `  §eDEMURRAGE §7(anti-hoarding)\n`;
  body += `${HR_THIN}\n`;
  body += `  §8└ §fSaldo §e>50K §ftidak aktif §e7+ hari\n`;
  body += `  §8  §7── §c-1%% s/d -2%%/hari\n`;
  body += `  §8§oRajin transaksi biar aman.\n\n`;

  body += `  §eSUBSIDI PLAYER MISKIN\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fKill mob: §a+1 koin §7(saldo <5K)\n`;
  body += `  §8├ §fQuest: §a+20%% bonus §7(saldo <5K)\n`;
  body += `  §8└ §fUBI: §a+100 koin/hari §7(7 hari pertama)\n\n`;

  body += `  §eSTIMULUS EKONOMI\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fAuto-aktif saat stagflasi\n`;
  body += `  §8├ §fDurasi §e7 hari §fsaat aktif:\n`;
  body += `  §8│  §8• §aQuest reward ×2\n`;
  body += `  §8│  §8• §aKill mob +2 koin\n`;
  body += `  §8│  §8• §aUBI +50 koin/hari\n`;
  body += `  §8└ §fCek: §e/lt:stagflation\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §dEKONOMI§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}
