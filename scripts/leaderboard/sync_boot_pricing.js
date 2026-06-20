/* ══════════════════════════════════════════════════════════════
   leaderboard/sync_boot_pricing.js — Boot-time pricing seed

   Tujuan: Saat server start (bahkan OFFLINE_MODE=true), fetch
   pricing terakhir dari Supabase agar gacha + land pakai harga
   production, bukan fallback default.

   ⚠ Hanya dijalankan SEKALI saat boot (runTimeout).
   ⚠ Jika fetch gagal (no internet), silent fail — pakai DP cache
     yang sudah ada atau fallback default.
   ⚠ Tidak depend pada OFFLINE_MODE — selalu attempt.

   Budget: 1 HTTP GET saat boot, 0 ongoing cost.
   ══════════════════════════════════════════════════════════════ */

import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod, HttpHeader } from "@minecraft/server-net";
import { SUPABASE_URL, SUPABASE_KEY, ENDPOINT } from "./sync_http.js";

const BOOT_DELAY_TICKS = 60;  // 3 detik setelah startup (biar world ready)
const TIMEOUT_TICKS    = 200; // 10 detik timeout

system.runTimeout(() => {
    _fetchProductionPricing();
}, BOOT_DELAY_TICKS);

async function _fetchProductionPricing() {
    try {
        // Cek apakah DP sudah punya pricing yang fresh (< 30 menit)
        const existing = _readExistingPricing();
        if (existing && (Date.now() - (existing.t || 0)) < 30 * 60_000) {
            // Cached pricing fresh — skip silently
            _writeBridge(existing); // Tetap pastikan scoreboard bridge ter-seed
            return;
        }

        // Fetch dari Supabase: GET leaderboard_sync?id=eq.current → gacha_lb column
        const req = new HttpRequest(`${ENDPOINT}?id=eq.current&select=gacha_lb`);
        req.method = HttpRequestMethod.Get;
        req.headers = [
            new HttpHeader("apikey", SUPABASE_KEY),
            new HttpHeader("Authorization", `Bearer ${SUPABASE_KEY}`),
            new HttpHeader("Accept", "application/json"),
        ];

        const res = await _httpTimeout(req, TIMEOUT_TICKS);

        if (res.status < 200 || res.status >= 300) {
            console.warn(`[BootPricing] Fetch failed HTTP ${res.status}`);
            return;
        }

        const rows = JSON.parse(res.body);
        if (!rows || !rows.length || !rows[0].gacha_lb) {
            console.warn("[BootPricing] No gacha_lb data in Supabase.");
            return;
        }

        const gachaLb = typeof rows[0].gacha_lb === "string"
            ? JSON.parse(rows[0].gacha_lb)
            : rows[0].gacha_lb;

        // Extract pricing dari guide
        const guide = gachaLb?.guide;
        if (!guide) {
            console.warn("[BootPricing] No guide in gacha_lb.");
            return;
        }

        // Reconstruct pricing object dari guide data
        const pricing = _extractPricing(guide);
        if (!pricing) {
            console.warn("[BootPricing] Could not extract pricing from guide.");
            return;
        }

        // Tulis ke DP agar gacha config bisa baca
        world.setDynamicProperty("eco:pricing", JSON.stringify(pricing));

        // Tulis ke scoreboard bridge agar Mimi Land bisa baca harga land
        _writeBridge(pricing);

        console.log(
            `[BootPricing] Production pricing seeded! ` +
            `eq1=${pricing.eq1} eq10=${pricing.eq10} ` +
            `landRates=[${pricing.lr.map(t => t.r).join(",")}] ` +
            `basis=${pricing.iph}`
        );
    } catch (e) {
        // Silent fail — tidak ada internet atau Supabase down
        console.warn("[BootPricing] Could not fetch:", e?.message || e);
    }
}

/** Extract/reconstruct pricing object dari guide data. */
function _extractPricing(guide) {
    try {
        const gacha = guide.gacha;
        const land  = guide.land;

        if (!gacha && !land) return null;

        const eq1  = gacha?.eq1  || 50;
        const eq10 = gacha?.eq10 || 450;
        const iph  = guide.basis || 25;

        // Reconstruct land rate tiers
        const lr = [];
        if (land?.tiers && Array.isArray(land.tiers)) {
            for (const t of land.tiers) {
                lr.push({
                    mx: t.maxArea || t.mx || 999999,
                    r:  t.rate    || t.r  || 0.10,
                });
            }
        }

        // Fallback: jika tidak ada land tiers di guide, hitung dari basis
        if (lr.length === 0) {
            lr.push(
                { mx: 225,  r: Math.max(0.10, +(iph * 0.002).toFixed(2)) },
                { mx: 900,  r: Math.max(0.25, +(iph * 0.003).toFixed(2)) },
                { mx: 2500, r: Math.max(0.50, +(iph * 0.004).toFixed(2)) },
                { mx: 1e9,  r: Math.max(0.80, +(iph * 0.0045).toFixed(2)) },
            );
        }

        return { t: Date.now(), iph, eq1, eq10, lr, _src: "boot" };
    } catch {
        return null;
    }
}

/** Baca pricing DP yang sudah ada. */
function _readExistingPricing() {
    try {
        const raw = world.getDynamicProperty("eco:pricing");
        if (typeof raw === "string" && raw.length > 0) return JSON.parse(raw);
    } catch {}
    return null;
}

/** Tulis pricing ke scoreboard bridge (cross-pack, sama persis dengan sync_pricing.js). */
function _writeBridge(pricing) {
    try {
        let sb = world.scoreboard.getObjective("_eco_pricing");
        if (!sb) sb = world.scoreboard.addObjective("_eco_pricing", "eco pricing bridge");

        if (pricing.lr) {
            for (let i = 0; i < pricing.lr.length; i++) {
                sb.setScore("_lr" + i, Math.round(pricing.lr[i].r * 100));
                sb.setScore("_mx" + i, pricing.lr[i].mx >= 1e8 ? 999999 : pricing.lr[i].mx);
            }
            sb.setScore("_n", pricing.lr.length);
        }
        if (pricing.eq1)  sb.setScore("_eq1", pricing.eq1);
        if (pricing.eq10) sb.setScore("_eq10", pricing.eq10);
        if (pricing.iph)  sb.setScore("_iph", Math.round(pricing.iph * 100));
    } catch (e) {
        console.warn("[BootPricing] Bridge write:", e);
    }
}

/** Timeout wrapper sederhana (tidak pakai circuit breaker — hanya 1 request). */
function _httpTimeout(req, timeoutTicks) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = system.runTimeout(() => {
            if (!settled) { settled = true; reject(new Error("Boot pricing timeout")); }
        }, timeoutTicks);

        http.request(req).then(
            res => {
                if (settled) return;
                settled = true;
                try { system.clearRun(timer); } catch {}
                resolve(res);
            },
            err => {
                if (settled) return;
                settled = true;
                try { system.clearRun(timer); } catch {}
                reject(err);
            }
        );
    });
}
