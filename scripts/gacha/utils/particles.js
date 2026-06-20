// ═══════════════════════════════════════════════════════════
// GACHA PARTICLE FX — Golden Rain theme
// Lava drips + crit stars. Warm & treasure-like.
// [PERF] Auto-cleanup, max 2-3 partikel/frame.
// ═══════════════════════════════════════════════════════════
import { system } from "@minecraft/server";

const PI2 = Math.PI * 2;

function sp(dim, id, pos) {
  try { dim.spawnParticle(id, pos); } catch {}
}

// ── Rolling: crit stars berputar menyusut ──
export function fxRollingSpiral(dim, chestLoc, type, durationTicks) {
  const cx = chestLoc.x + 0.5, cy = chestLoc.y + 1.2, cz = chestLoc.z + 0.5;
  let frame = 0;
  const total = Math.floor(durationTicks / 4);

  const id = system.runInterval(() => {
    if (frame >= total) { system.clearRun(id); return; }
    const prog = frame / total;
    const r = 0.8 - prog * 0.5;
    const ang = frame * 0.3;

    sp(dim, "minecraft:basic_crit_particle", {
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(frame * 0.1) * 0.1,
      z: cz + Math.sin(ang) * r,
    });
    frame++;
  }, 4);

  return { clear: () => { try { system.clearRun(id); } catch {} } };
}

// ── Reveal burst ──
const BURST = {
  COMMON:    { pid: "minecraft:basic_crit_particle",  n: 3, r: 0.5,  frames: 3 },
  UNCOMMON:  { pid: "minecraft:basic_crit_particle",  n: 4, r: 0.6,  frames: 3 },
  RARE:      { pid: "minecraft:basic_crit_particle",  n: 5, r: 0.8,  frames: 4 },
  EPIC:      { pid: "minecraft:lava_particle",        n: 6, r: 1.0,  frames: 5 },
  LEGENDARY: { pid: "minecraft:totem_particle",       n: 8, r: 1.3,  frames: 7 },
};

export function fxRevealBurst(dim, chestLoc, rarity) {
  const cx = chestLoc.x + 0.5, cy = chestLoc.y + 1.1, cz = chestLoc.z + 0.5;
  const cfg = BURST[rarity] ?? BURST.COMMON;
  let frame = 0;

  const id = system.runInterval(() => {
    if (frame >= cfg.frames) { system.clearRun(id); return; }
    const r = (frame / cfg.frames) * cfg.r;
    for (let i = 0; i < cfg.n; i++) {
      const ang = (i / cfg.n) * PI2 + frame * 0.25;
      sp(dim, cfg.pid, {
        x: cx + Math.cos(ang) * r,
        y: cy,
        z: cz + Math.sin(ang) * r,
      });
    }
    frame++;
  }, 3);
}

// ── Legendary: lava rain + totem burst ──
export function fxLegendaryStorm(dim, chestLoc) {
  const cx = chestLoc.x + 0.5, cy = chestLoc.y + 1.0, cz = chestLoc.z + 0.5;
  let frame = 0;

  const id = system.runInterval(() => {
    if (frame >= 18) { system.clearRun(id); return; }

    // Lava rain from high above
    sp(dim, "minecraft:lava_particle", {
      x: cx + (Math.random() - 0.5) * 1.0,
      y: cy + 3.0 + Math.random(),
      z: cz + (Math.random() - 0.5) * 1.0,
    });

    // Totem burst at end
    if (frame >= 15) {
      const br = (frame - 15) * 0.5;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * PI2;
        sp(dim, "minecraft:totem_particle", {
          x: cx + Math.cos(a) * br, y: cy + 0.5, z: cz + Math.sin(a) * br,
        });
      }
    }
    frame++;
  }, 3);
}

// ── Slot pop ──
export function fxSlotPop(dim, chestLoc, rarity) {
  const cx = chestLoc.x + 0.5, cy = chestLoc.y + 1.1, cz = chestLoc.z + 0.5;
  const a = Math.random() * PI2;
  sp(dim, "minecraft:basic_crit_particle", {
    x: cx + Math.cos(a) * 0.35,
    y: cy,
    z: cz + Math.sin(a) * 0.35,
  });
}

// ── Payment sparkle ──
export function fxPaySparkle(dim, chestLoc) {
  const cx = chestLoc.x + 0.5, cy = chestLoc.y + 1.0, cz = chestLoc.z + 0.5;
  let frame = 0;
  const id = system.runInterval(() => {
    if (frame >= 3) { system.clearRun(id); return; }
    sp(dim, "minecraft:basic_crit_particle", {
      x: cx + (Math.random() - 0.5) * 0.3,
      y: cy + frame * 0.2,
      z: cz + (Math.random() - 0.5) * 0.3,
    });
    frame++;
  }, 3);
}
