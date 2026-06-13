// purge_gate.js — Cross-pack purge bridge reader.
// Uses scoreboard 'lt_purge' set by LT-Purge addon (§8.5 cross-pack bridge).
// NOTE: Identical copy exists in LT-Mimi Land. Keep in sync.

import { world } from "@minecraft/server";

const BRIDGE_OBJ = "lt_purge";

/**
 * Returns true if The Purge event is currently active.
 * Reads live scoreboard every call — no cache for reliability.
 */
export function isPurgeActive() {
    try {
        const obj = world.scoreboard.getObjective(BRIDGE_OBJ);
        if (!obj) return false;
        try { return obj.getScore("state") === 1; } catch { return false; }
    } catch {
        return false;
    }
}
