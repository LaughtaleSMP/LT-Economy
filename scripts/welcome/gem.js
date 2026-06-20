// welcome/gem.js — Panel "Gem Premium" untuk /lt:guide.
// Tujuan: angkat awareness gem (P0). Read-only.

import { ActionFormData } from "@minecraft/server-ui";
import { HR, HR_THIN, readPricing } from "./_shared.js";
import {
  TOPUP_URL,
  FIRST_TOPUP_DISPLAY_PCT,
  FIRST_TOPUP_MULTIPLIER,
} from "../topup_info.js";

// Single source of truth (mirror dari Mimi Land + gacha config existing).
// Kalau angka berubah, sync di sini juga.
const LAND_GEM_DISCOUNT_PCT = 99;   // Mimi Land/scripts/config.js
const GACHA_PARTIKEL_1X     = 10;   // gacha hub (existing guideGacha)
const GACHA_PARTIKEL_10X    = 90;
const GACHA_DUP_REFUND_GEM  = 5;    // existing guideGacha refund

/** Hitung harga land contoh (10×10, 20×20, 30×30) dalam koin & gem. */
function _calcLandExamples() {
  const pr = readPricing();
  const basis = pr?.iph ?? 57;
  // Pendekatan: harga land scale dengan luas × basis. Angka multiplier ini
  // approximation kasar untuk display contoh — bukan source of truth
  // (live calculation tetap di Mimi Land).
  const sizes = [
    { dims: "10×10", area: 100  },
    { dims: "20×20", area: 400  },
    { dims: "30×30", area: 900  },
  ];
  return sizes.map(s => {
    const coin = Math.ceil(s.area * basis * 0.55);   // approximate
    const gem  = Math.ceil(coin * (100 - LAND_GEM_DISCOUNT_PCT) / 100);
    return { dims: s.dims, coin, gem };
  });
}

function _fmt(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

export async function guideGem(player) {
  const examples = _calcLandExamples();

  let body = `${HR}\n`;
  body += `§d  ★ GEM PREMIUM\n`;
  body += `${HR}\n\n`;
  body += `  §fMata uang premium server.\n`;
  body += `  §fBeli sekali, untung jangka panjang.\n\n`;

  body += `  §eKEUNTUNGAN\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §dDiskon Land §b${LAND_GEM_DISCOUNT_PCT}%%\n`;
  body += `  §8│ §8  + bebas PPN saat klaim\n`;
  body += `  §8├ §dGacha Partikel §8── §fskin eksklusif\n`;
  body += `  §8│ §8  1x=§b${GACHA_PARTIKEL_1X} gem§8, 10x=§b${GACHA_PARTIKEL_10X} gem §8(tetap)\n`;
  body += `  §8├ §dDuplikat §8── §brefund §b${GACHA_DUP_REFUND_GEM} gem\n`;
  body += `  §8└ §dHarga §atetap §f(tidak naik saat inflasi)\n\n`;

  body += `  §eCONTOH HEMAT LAND\n`;
  body += `${HR_THIN}\n`;
  for (const e of examples) {
    const hemat = e.coin - e.gem;
    body += `  §8├ §f${e.dims} §8── §e${_fmt(e.coin)}⛃ §8atau §b${_fmt(e.gem)}✦\n`;
    body += `  §8│   §7hemat §a${_fmt(hemat)} koin\n`;
  }
  body += `  §8└ §8(approx. — final price hitung in-game)\n\n`;

  body += `  §eKONVERSI GACHA\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §b10 gem  §8── §f1x partikel\n`;
  body += `  §8├ §b90 gem  §8── §f10x partikel §8(hemat 10)\n`;
  body += `  §8└ §b900 gem §8── §f100 pull §8(≈ pity Legend)\n\n`;

  body += `  §eCARA DAPAT GEM\n`;
  body += `${HR_THIN}\n`;
  body += `  §8├ §fTopup §8── §b${TOPUP_URL}\n`;
  body += `  §8├ §fGacha duplikat §8── §brefund ${GACHA_DUP_REFUND_GEM} gem\n`;
  body += `  §8└ §fEvent server §8(ad-hoc)\n\n`;

  body += `  §a✦ §lTOPUP PERTAMA = GEM ×${FIRST_TOPUP_MULTIPLIER}!\n`;
  body += `  §8├ §fBayar 1× §8── §fterima §a${FIRST_TOPUP_MULTIPLIER}× §fgem (sekali, gem only)\n`;
  body += `  §8├ §fBonus +${FIRST_TOPUP_DISPLAY_PCT}%% §8(promo permanen)\n`;
  body += `  §8└ §fBuka §b${TOPUP_URL}\n`;
  body += `\n${HR}`;

  await new ActionFormData()
    .title("§8 ♦ §dGEM PREMIUM§r §8♦ §r")
    .body(body)
    .button("§6  Kembali", "textures/items/arrow")
    .show(player);
}
