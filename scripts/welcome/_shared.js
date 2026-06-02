// welcome/_shared.js — Shared constants & DP readers untuk guide pages.
import { world } from "@minecraft/server";

export const HR      = "§8═══════════════════";
export const HR_THIN = "§8───────────────────";

function _readDP(key) {
  try {
    const raw = world.getDynamicProperty(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function readPricing() { return _readDP("eco:pricing"); }
export function readPolicyAdj() { const p = _readDP("eco:policy"); return p?.adj || 0; }
