// npc/role_sakura.js — Alice: Penyembuh (Buff Station)
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { getCoin, addCoin, fmt } from "../store/helpers.js";
import { trackFlow } from "../eco_flow.js";

const HEAL_CD_MS = 10 * 60 * 1000;
const ENHANCED_COST = 300;
const _healCooldown = new Map();

export function cleanupAlice(playerId) { _healCooldown.delete(playerId); }

export async function openAliceMenu(player, greeting) {
  const now = Date.now();
  const cdEnd = _healCooldown.get(player.id) ?? 0;
  const cdLeft = Math.max(0, cdEnd - now);
  const cdReady = cdLeft <= 0;
  const cdText = cdReady ? "§aSiap" : `§c${Math.ceil(cdLeft / 1000)}s`;

  const form = new ActionFormData()
    .title("§8« §dAlice §8»")
    .body(
      `  §f§o"${greeting}"§r\n\n` +
      `  §8Cooldown  ${cdText}`
    )
    .button(`§a  Healing Gratis\n§r§8Regen II + Resist I §7[${cdText}§7]`, "textures/items/potion_bottle_heal")
    .button(`§b  Enhanced Buff\n§r§8Regen III + Resist II §7· §e${fmt(ENHANCED_COST)}⛃`, "textures/items/potion_bottle_healTwo")
    .button("§c  Tutup", "textures/items/barrier");

  const res = await form.show(player);
  if (res.canceled || res.selection === 2) return;

  if (res.selection === 0) {
    if (!cdReady) {
      player.sendMessage(`§8[§dAlice§8]§c Tunggu §e${Math.ceil(cdLeft / 1000)} detik§c lagi.`);
      return;
    }
    try {
      player.addEffect("regeneration", 600, { amplifier: 1, showParticles: true });
      player.addEffect("resistance", 1200, { amplifier: 0, showParticles: true });
    } catch (e) { player.sendMessage("§cGagal memberi efek."); return; }
    _healCooldown.set(player.id, now + HEAL_CD_MS);
    player.sendMessage(
      `§8[§dAlice§8]§d Semoga cepat pulih!\n` +
      `  §a+ Regeneration II §7(30 detik)\n` +
      `  §b+ Resistance I §7(60 detik)`
    );
    try { player.playSound("random.orb", { pitch: 1.2, volume: 0.8 }); } catch {}
  }

  if (res.selection === 1) {
    const bal = getCoin(player);
    if (bal < ENHANCED_COST) {
      player.sendMessage(`§8[§dAlice§8]§c Butuh §e${fmt(ENHANCED_COST)}⛃§c, punya §e${fmt(bal)}⛃§c.`);
      return;
    }
    const confirm = new MessageFormData()
      .title("§8« §dEnhanced Buff §8»")
      .body(`§7Bayar §e${fmt(ENHANCED_COST)}⛃ §7untuk:\n§a Regen III §7+ §bResist II §7(3 menit)\n\n§8Saldo: §e${fmt(bal)} §8-> §e${fmt(bal - ENHANCED_COST)}`)
      .button1("§a Beli")
      .button2("§c Batal");
    const c = await confirm.show(player);
    if (c.canceled || c.selection === 1) return;

    const realBal = getCoin(player);
    if (realBal < ENHANCED_COST) { player.sendMessage("§cSaldo berubah, dibatalkan."); return; }

    addCoin(player, -ENHANCED_COST);
    trackFlow("alice_buff", -ENHANCED_COST);
    try {
      player.addEffect("regeneration", 3600, { amplifier: 2, showParticles: true });
      player.addEffect("resistance", 3600, { amplifier: 1, showParticles: true });
    } catch {}
    _healCooldown.set(player.id, now + HEAL_CD_MS);
    player.sendMessage(
      `§8[§dAlice§8]§d Berkah penuh!\n` +
      `  §a+ Regeneration III §7(3 menit)\n` +
      `  §b+ Resistance II §7(3 menit)\n` +
      `  §7-${fmt(ENHANCED_COST)}⛃`
    );
    try { player.playSound("random.levelup", { pitch: 1.4, volume: 0.9 }); } catch {}
  }

  if (_healCooldown.size > 100) _healCooldown.clear();
}
