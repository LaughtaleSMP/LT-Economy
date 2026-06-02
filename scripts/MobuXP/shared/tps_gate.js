import { getTPSAverageLast } from "../monitor/tps_tracker.js";

export function shouldSkipHeavy() {
  try { return getTPSAverageLast(4) < 15; } catch { return false; }
}

export function isEmergencyMode() {
  try { return getTPSAverageLast(4) < 10; } catch { return false; }
}
