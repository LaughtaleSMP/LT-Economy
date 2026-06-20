# Runbook: Leaderboard Sync

**Owner:** server admin · **SLO:** 99% sync success / 24h, p95 ≤ 5s

---

## Apa fitur ini

Push data game ke Supabase tiap 5 menit (full) + 5 detik (micro-sync posisi). Web dashboard ambil data dari Supabase. File: `scripts/leaderboard/sync*.js`.

## Symptom yang user lihat

| Symptom | Kemungkinan penyebab |
|---|---|
| Web dashboard tidak update > 10 menit | Sync gagal, circuit breaker open, atau OFFLINE_MODE=true |
| Posisi player di radar stuck | Micro-sync gagal (TPS gate < 15, atau HTTP timeout) |
| Pricing/policy tidak update | Full sync OK tapi summary kosong (tidak ada player aktif) |
| BDS log spam `Circuit open` | Sudah di-suppress sejak v4.1: scheduler skip silent saat circuit open. Kalau muncul, berarti ada caller baru yang lupa filter `e.circuitOpen`. |
| `[HTTP] circuit recovered after N fail(s)` muncul tanpa Supabase outage | **Sebelum fix timer-leak (pre v4.1)**: race timeout meleset → counter palsu naik. Sudah tidak terjadi sejak `httpWithTimeout` pakai single-promise + `clearRun`. |

## Cara verify

1. **Cek BDS log** untuk pattern:
   - `[LB-Sync] OK (200): N weekly, M gacha, K online.` → healthy
   - `[LB-Sync] FAIL HTTP <code>: ...` → server-side issue, lihat status code
   - `[LB-Sync] Error: HTTP timeout` → network slow / Supabase degraded
   - `[HTTP] circuit OPEN ...` → circuit breaker tripped
2. **Cek OFFLINE_MODE flag** di `sync_http.js`. Kalau `true`, **expected behavior** — bukan bug.
3. **Cek Supabase dashboard** → table `leaderboard_sync` → row `id=current` → `synced_at` kolom.

## Mitigation

### Sync gagal terus-menerus

1. Cek Supabase status page.
2. Verifikasi `SUPABASE_KEY` tidak expired (`exp` di JWT payload, decode di jwt.io).
3. Cek BDS network: `curl <SUPABASE_URL>/rest/v1/` dari host BDS. Kalau gagal di sini = DNS/firewall.
4. Kalau Supabase memang down: tidak ada action, circuit breaker akan handle. Game tetap jalan.

### Circuit breaker open

- Otomatis pulih setelah 5 menit cooldown.
- Untuk force reset: restart BDS (state in-memory, tidak persist).
- Jangan loop manual reset — itu defeats the purpose.

### Posisi radar stuck (micro-sync gagal)

1. Cek `getTPS()` di game (admin /lt:tps). Kalau < 15, micro-sync sengaja skip — **bukan bug**.
2. Kalau TPS OK tapi posisi stuck, cek log untuk `[Pos-Sync] Stuck guard, force reset`. Itu artinya HTTP request sebelumnya hang > 15s. Network issue.

### Pricing tidak update

1. Pricing skip write kalau perubahan < 1% — hemat DP. Itu **expected**.
2. Cek `eco:pricing` DP value: ada `t` (timestamp) dan `iph` (basis). Kalau `iph = 25` (BASIS_FLOOR), berarti tidak ada player aktif (mob_kill flow = 0).

## Rollback / disable

Set `OFFLINE_MODE = true` di `sync_http.js` line ~20, restart BDS. Sync mati total, game tetap jalan normal. Player tidak akan terganggu.

## Related

- Schema Supabase: `leaderboard_sync`, `metrics_history`, `economy_history`, `topup_queue`
- Auth: anon key di `sync_http.js` (publik di code, RLS policy melindungi di Supabase side)
