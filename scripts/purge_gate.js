// purge_gate.js — Cross-pack purge bridge reader.
// Uses Dynamic Property (primary) + scoreboard 'lt_purge' (fallback).
// NOTE: Identical copy exists in LT-Mimi Land. Keep in sync.

import { world } from "@minecraft/server";

const BRIDGE_DP = "lt:purge_active";
const BRIDGE_OBJ = "lt_purge";

/**
 * Returns true if The Purge event is currently active.
 * Reads Dynamic Property first (instant), falls back to scoreboard.
 */
export function isPurgeActive() {
    // Primary: Dynamic Property — reliable, no participant issues
    try {
        const dp = world.getDynamicProperty(BRIDGE_DP);
        if (dp === 1) return true;
        if (dp === 0) return false;
    } catch {}
    // Fallback: Scoreboard
    try {
        const obj = world.scoreboard.getObjective(BRIDGE_OBJ);
        if (!obj) return false;
        try { return obj.getScore("state") === 1; } catch { return false; }
    } catch {
        return false;
    }
}
