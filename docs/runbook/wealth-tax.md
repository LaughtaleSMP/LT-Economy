# Runbook: Wealth Tax & Treasury

**Owner:** server admin · **SLO:** collect runs exactly once per UTC day

---

## Apa fitur ini

Pemotongan koin harian dari player kaya (>5k/20k/50k tier), masuk ke treasury, otomatis didistribusikan ke bottom 50% saldo. File: `scripts/Tax/wealth*.js`.

## Symptom yang user lihat

| Symptom | Kemungkinan penyebab |
|---|---|
| Player kaya tidak kena potong | Period sudah marked hari ini, atau scoreboard `coin` tidak ada |
| Treasury tidak terdistribusi | Treasury < AUTO_DIST_THRESHOLD (500), atau tidak ada player di scoreboard |
| Notif offline tidak muncul saat login | Spawn handler delay 80 ticks, kemungkinan player relog cepat |
| Player kena pajak 2× hari yang sama | DP write gagal, period tidak ter-mark — **kritikal** |

## Cara verify

1. **Cek period DP:**
   - Run `/lt:tax` (admin) → menu menampilkan "Status: Sudah/Belum (hari ini)".
   - DP key: `tax:wealth_period`. Value = hari sekarang (lihat `getCurrentPeriod()` di `wealth_state.js`).
2. **Cek treasury:**
   - DP key: `tax:treasury`. Value = total koin terkumpul.
3. **Cek BDS log saat collection berjalan:**
   ```
   [WealthTax] Scan: total=N, taxed=K, skip(name)=A, skip(zero)=B, skip(tier)=C, collected=X
   [WealthTax] Koleksi selesai: X koin dari K player. Treasury: Y
   ```

## Mitigation

### Pajak tidak collect saat scheduler trigger

1. Cek scoreboard `coin` exists: `/scoreboard objectives list`.
2. Cek period DP: `/lt:tax` → kalau "Sudah", admin bisa "Paksa Kumpulkan Sekarang" (akan reset period DP).
3. Kalau scoreboard ada tapi tidak ada player di-tax: kemungkinan tidak ada saldo > 5000. Itu valid.

### Player kena pajak 2× (data corruption)

**Kritikal — investigate dulu sebelum action.**

1. Cek BDS log untuk `[WealthTax] DP write mismatch! Expected ... got ...` — itu sinyal DP storage corruption.
2. Cek apakah ada 2 instance BDS/world running secara bersamaan (split-brain).
3. Manual rollback: kembalikan koin player via scoreboard add. Treasury tidak perlu di-rollback (immutable hingga distribute).

### Auto-distribute tidak jalan

1. Treasury < 500 (AUTO_DIST_THRESHOLD) → expected, tidak ada bug.
2. Treasury cukup tapi tidak distribute → cek log `[WealthTax] auto-dist post-collect:`. Kalau `_autoDistRunning` flag stuck, restart BDS akan reset (in-memory).
3. Manual force: admin pakai `/lt:tax` → "Auto Subsidi Kalangan Bawah".

### Notif offline hilang

- TTL: 30 hari. Kalau player offline > 30 hari, notif di-prune.
- Cap: 5 notif terbaru per player. Kalau > 5, yang lama dibuang.
- DP key: `tax:notif:<player_name>`. Bisa di-inspect manual untuk debug.

## Rollback / disable

Tidak ada flag disable global. Untuk skip 1 hari, manual set DP `tax:wealth_period` ke value besok (`getCurrentPeriod() + 1`):
- Tidak ada in-game command. Pakai `/script` debugger atau direct DP edit (advanced).
- Alternative: kosongkan tier list (set `TAX_TIERS = []` di `wealth_state.js`, redeploy).

## Related

- Demurrage piggyback: `scripts/welfare/demurrage.js` — koin dari hoarder pasif juga masuk treasury.
- Subsidy: kill mob / quest reward → bonus dari treasury (lihat `applySubsidy()` di `wealth_state.js`).
- Cross-pack: treasury di-export via DP, hanya readable dari Economy pack (DP scoped).
