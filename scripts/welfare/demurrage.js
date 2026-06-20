// ============================================================
// welfare/demurrage.js — Carrying cost untuk koin idle
//
// REFERENSI: Silvio Gesell (1916), endorsed by Keynes (General Theory, 1936)
// Demurrage = biaya memegang uang. Dipuji ekonom modern untuk memaksa
// velocity tanpa menghukum kesuksesan.
//
// MEKANIK:
//   - Trigger: saldo > THRESHOLD (50.000) DAN tidak ada "activity"
//     (transfer, auction, gacha, buy land, buy store) dalam N hari.
//   - Rate: hari 8-14 sejak inaktif = 1%/hari, hari 15+ = 2%/hari.
//   - Auto-reset saat ada activity → ini yang memaksa spending.
//   - Piggyback pada wealth tax collection (1x/hari) — ZERO interval tambahan.
//
// PERFORMA:
//   - Storage: 1 Player DP "wlf:act" per player yang pernah aktif — {lastTs}
//   - Tidak perlu scan scoreboard ekstra — digabung dengan wealth tax scan.
//   - CPU: O(1) per player saat daily collection.
//   - RAM: in-memory activity map diperbolehkan (small, auto-clean on leave).
//   - DP writes: hanya saat activity benar-benar terjadi, di-debounce 60 detik.
//
// ANTI-ABUSE:
//   - Self-transfer (ke alt account) TIDAK me-reset activity — cek di
//     pointActivity() untuk menolak jika receiver.id == sender.id (mustahil)
//     atau lewat rule di Bank: self-transfer sudah diblokir (target.id != player.id).
//   - Activity minimum amount: transfer ≥10, buy ≥10, gacha 1x. Cukup realistis.
//
// ============================================================

import { world, system } from "@minecraft/server";
import { pGet, pSet, getOnlinePlayer } from "../player_dp.js";
import { trackFlow } from "../eco_flow.js";

// ── Konstanta ────────────────────────────────────────────────
const COIN_OBJ          = "coin";
const ACT_KEY           = "wlf:act";     // Player DP: {lastTs}
const MS_PER_DAY        = 86_400_000;
const THRESHOLD         = 50_000;        // saldo minimum untuk kena demurrage
const GRACE_DAYS        = 7;             // 7 hari pertama bebas
const RATE_LOW          = 0.010;         // hari 8-14 — 1%/hari
const RATE_HIGH         = 0.020;         // hari 15+ — 2%/hari
const RATE_HIGH_DAY     = 14;            // switch day (sejak lastActive)
const DEBOUNCE_MS       = 60_000;        // minimum gap antar pSet activity
const ADMIN_TAG         = "mimi";

function fmt(n) { return Math.floor(n).toLocaleString("id-ID"); }

// ── In-memory debounce cache (tidak persist, auto-cleanup on leave) ──
const _lastWriteTs = new Map();  // playerId → Date.now()

/**
 * Tandai player melakukan aktivitas ekonomi. Debounced 60 detik.
 * Dipanggil dari bank transfer, auction buy/sell, gacha pull, land buy, store buy.
 *
 * @param {Player|string} playerOrId — Player object atau playerId string (kalau offline)
 */
export function pointActivity(playerOrId) {
  try {
    const now = Date.now();
    const isPlayer = playerOrId && typeof playerOrId === "object" && playerOrId.id;
    const pid = isPlayer ? playerOrId.id : playerOrId;
    if (!pid) return;

    // Debounce
    const last = _lastWriteTs.get(pid) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    _lastWriteTs.set(pid, now);

    // Write (hanya kalau player online — offline activity tidak mungkin secara semantik)
    if (isPlayer) {
      try { pSet(playerOrId, ACT_KEY, { lastTs: now }); }
      catch (e) { console.warn("[Demurrage] pSet fail:", e); }
    } else {
      const p = getOnlinePlayer(pid);
      if (p) {
        try { pSet(p, ACT_KEY, { lastTs: now }); } catch {}
      }
    }
  } catch {}
}

/**
 * Init activity stamp saat player spawn pertama kali — 
 * jaga agar player baru tidak langsung kena demurrage.
 */
export function initActivityOnSpawn(player) {
  try {
    const existing = pGet(player, ACT_KEY, null);
    if (existing && existing.lastTs > 0) return; // sudah ada
    pSet(player, ACT_KEY, { lastTs: Date.now() });
  } catch {}
}

/**
 * Hitung demurrage untuk single player. Tidak mengubah scoreboard.
 * Return {rate, charge, daysInactive} atau null jika tidak kena.
 *
 * @param {number} balance — saldo koin terkini
 * @param {number} lastActivityTs — timestamp ms
 */
export function calcDemurrage(balance, lastActivityTs) {
  if (!Number.isFinite(balance) || balance <= THRESHOLD) return null;
  if (!Number.isFinite(lastActivityTs) || lastActivityTs <= 0) return null;

  const now = Date.now();
  const daysInactive = Math.floor((now - lastActivityTs) / MS_PER_DAY);
  if (daysInactive < GRACE_DAYS) return null;

  const rate = daysInactive >= RATE_HIGH_DAY ? RATE_HIGH : RATE_LOW;
  const charge = Math.max(1, Math.floor(balance * rate));
  return { rate, charge, daysInactive };
}

/**
 * Bersihkan cache debounce saat player leave. Dipanggil dari main.js.
 */
export function cleanupActivityCache(playerId) {
  _lastWriteTs.delete(playerId);
}

/**
 * Peek demurrage status untuk UI. Tidak mengubah state.
 */
export function getDemurrageStatus(player) {
  try {
    const obj = world.scoreboard.getObjective(COIN_OBJ);
    const bal = obj?.getScore(player) ?? 0;
    const data = pGet(player, ACT_KEY, null);
    const lastTs = data?.lastTs ?? 0;
    const preview = calcDemurrage(bal, lastTs);
    return {
      balance: bal,
      lastActiveTs: lastTs,
      daysInactive: lastTs > 0 ? Math.floor((Date.now() - lastTs) / MS_PER_DAY) : -1,
      atRisk: preview !== null,
      previewCharge: preview?.charge ?? 0,
      previewRate: preview?.rate ?? 0,
      threshold: THRESHOLD,
      graceDays: GRACE_DAYS,
    };
  } catch { return null; }
}

/**
 * Batch-proses demurrage untuk semua player (online + offline).
 * Dipanggil dari Tax/wealth.js `collectWealthTax()` — 1x/hari, bersamaan dengan
 * wealth tax scan. Tidak menambah loop scoreboard baru.
 *
 * @returns {{totalCollected, affectedCount, toTreasury}}
 */
export function runDemurrageBatch() {
  const result = { totalCollected: 0, affectedCount: 0, toTreasury: 0 };

  let obj;
  try { obj = world.scoreboard.getObjective(COIN_OBJ); } catch {}
  if (!obj) return result;

  // Build map online players untuk notification + Player DP access
  const onlineMap = new Map();
  for (const p of world.getPlayers()) onlineMap.set(p.id, p);

  // Build map name→id via p_reg (global gacha registry) untuk offline player DP lookup
  // Kita tidak sentuh Player DP offline player (Bedrock API tidak support stable offline PDP
  // untuk player yang belum pernah login sejak restart). Demurrage offline player dilewati.
  //
  // Ini trade-off sadar: player yang sengaja tidak pernah login untuk hindari demurrage
  // tetap akan terdeteksi saat akhirnya login (Player DP ACT_KEY tidak ter-update selama
  // offline → kena hukum saat kembali).

  for (const ident of obj.getParticipants()) {
    try {
      const name = ident.displayName;
      if (!name || name.startsWith("command.") || name.includes(".scoreboard.")) continue;
      const balance = obj.getScore(ident) ?? 0;
      if (!Number.isFinite(balance) || balance <= THRESHOLD) continue;

      // Cari online player berdasarkan name match (scoreboardIdentity tidak expose id)
      let playerObj = null;
      for (const [pid, p] of onlineMap) {
        if (p.name === name) { playerObj = p; break; }
      }
      if (!playerObj) continue; // offline — skip (akan dievaluasi saat login)

      const data = pGet(playerObj, ACT_KEY, null);
      const lastTs = data?.lastTs ?? 0;
      if (lastTs <= 0) continue; // belum pernah stamp — init saat spawn seharusnya jalan

      const calc = calcDemurrage(balance, lastTs);
      if (!calc) continue;

      // Potong saldo
      const newBal = Math.max(0, balance - calc.charge);
      const actualCharge = balance - newBal;
      if (actualCharge <= 0) continue;

      // [§2] Track only if scoreboard write succeeded — else flow diverges from balance.
      try {
        obj.setScore(ident, newBal);
      } catch (e) {
        console.warn(`[Demurrage] setScore fail for ${name}:`, e);
        continue;
      }
      result.totalCollected += actualCharge;
      result.affectedCount++;

      const msg =
        `§8[§dDemurrage§8]§d §fSaldo §e${fmt(balance)} §fkoin tidak aktif §c${calc.daysInactive} hari§f.\n` +
        `  §7Tarif §c${(calc.rate * 100).toFixed(1)}%%§7/hari — dipotong §c-${fmt(actualCharge)} Koin§7.\n` +
        `  §7Sisa: §e${fmt(newBal)} Koin. Lakukan transaksi untuk reset aktivitas.`;
      try { playerObj.sendMessage(msg); } catch {}
      try { playerObj.playSound("note.bass", { pitch: 0.5, volume: 0.8 }); } catch {}
    } catch (e) { console.warn("[Demurrage] participant error:", e); }
  }

  // Clean up onlineMap after use — GC-friendly
  onlineMap.clear();

  if (result.totalCollected > 0) {
    trackFlow("demurrage", -result.totalCollected);
    console.log(
      `[Demurrage] Batch selesai: ${fmt(result.totalCollected)} koin dari ` +
      `${result.affectedCount} hoarder. Akan masuk ke treasury.`
    );
  }
  return result;
}

/**
 * Ambil activity Map in-memory — dipakai main.js untuk cleanup on leave.
 */
export function getActivityCache() { return _lastWriteTs; }

// ── Admin command: /lt:demurrage — preview status ──
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  try {
    customCommandRegistry.registerCommand(
      {
        name:            "lt:demurrage",
        description:     "Preview demurrage status kamu",
        permissionLevel: 0,
        cheatsRequired:  false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        system.run(() => {
          const st = getDemurrageStatus(player);
          if (!st) { player.sendMessage("§8[§cDemurrage§8]§c Gagal memuat status."); return; }
          if (st.daysInactive < 0) {
            player.sendMessage("§8[§aDemurrage§8]§a Belum ada stempel aktivitas. Lakukan transaksi dulu.");
            return;
          }
          if (st.balance <= st.threshold) {
            player.sendMessage(
              `§8[§aDemurrage§8]§a Aman. Saldo §e${fmt(st.balance)} §abelum melewati ambang §f${fmt(st.threshold)} koin.`
            );
            return;
          }
          if (!st.atRisk) {
            const left = Math.max(0, st.graceDays - st.daysInactive);
            player.sendMessage(
              `§8[§eDemurrage§8]§e Saldo §f${fmt(st.balance)}§e koin. Tidak aktif §f${st.daysInactive} hari§e. ` +
              `§aGrace §f${left} hari §alagi sebelum dikenakan potongan.`
            );
          } else {
            player.sendMessage(
              `§8[§cDemurrage§8]§c §fSaldo §e${fmt(st.balance)} §fkoin tidak aktif §c${st.daysInactive} hari§f.\n` +
              `§7 Preview potongan besok: §c-${fmt(st.previewCharge)} Koin §7(${(st.previewRate * 100).toFixed(1)}%%/hari).\n` +
              `§a Lakukan transaksi (transfer, gacha, auction, land) untuk reset aktivitas.`
            );
          }
        });
        return { status: 0 };
      }
    );
  } catch (e) { console.warn("[Demurrage] cmd reg:", e); }
});

export const DEMURRAGE_CFG = Object.freeze({
  THRESHOLD,
  GRACE_DAYS,
  RATE_LOW,
  RATE_HIGH,
  RATE_HIGH_DAY,
});
