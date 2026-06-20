// Custom Knockback Override — 100% identical to Better & Custom KB v2 by QuantumBE.
// Self-contained: subscribes to afterEvents.entityHurt directly.
// Applies to ALL hits involving at least one Player (PvP + PvE + EvP).
import { world, Player } from "@minecraft/server";

// ── KB values (v2 defaults) ──
const amp = 0.986;
const up  = 0.4018;

// ── Reusable objects (avoid GC, identical to v2) ──
const KB   = { __proto__: null, x: 0, z: 0 };
const impl = { __proto__: null, x: 0, y: up, z: 0 };
const sqrt = Math.sqrt;

// ── v2 identical subscriber ──
world.afterEvents.entityHurt.subscribe(e => {
  const dmg = e.damageSource, att = dmg.damagingEntity;
  if (!att || dmg.cause !== 'entityAttack' || dmg.damagingProjectile) return;
  const hurt = e.hurtEntity;
  if (!(hurt instanceof Player || att instanceof Player)) return;
  const hLoc = hurt.location, aLoc = att.location,
  dx = hLoc.x - aLoc.x, dz = hLoc.z - aLoc.z, len = 1 / sqrt(dx * dx + dz * dz);
  if (len === Infinity) return;
  const nx = (dx * len), nz = (dz * len);
  hurt.clearVelocity();
  try {
    KB.x = nx * amp;
    KB.z = nz * amp;
    hurt.applyKnockback(KB, up);
  } catch (e) {
    console.warn('Error in applyKnockback: ' + e);
    const amp2 = amp * .4;
    impl.x = nx * amp2;
    impl.z = nz * amp2;
    hurt.applyImpulse(impl);
  }
});
