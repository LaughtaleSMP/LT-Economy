# Runbook — Season Migration (gem + particle only)

## Tujuan

Saat membuka **season baru** (world baru), migrasi hanya:
- Saldo **gem** per player
- **Particle skin** yang sudah dimiliki (gacha rewards)
- Equipment **pity counter** (eqsr/eql)

Yang **TIDAK** ikut: koin, land, bank history, auction listings, daily quest, combat
stats, dst. Player masuk season baru sebagai "fresh start" untuk semua sistem
non-gem.

## Alat yang dipakai (sudah ada di pack)

Sistem export/import gacha bulk:
- `gacha:bulk_export` — generate string berisi data semua player
- `gacha:prepare_import` — validate & stage string untuk preview
- `gacha:bulk_import` — apply langsung ke target world

Format: `GSALL5|<N>|<name>:<gem>:<ptmask>:<eqsr>:<eql>|...`

Filter built-in: hanya player dengan `gem > 0` ATAU `ptmask !== "0"` yang
masuk export. Player tanpa data tidak ikut (lihat `bulk.js` `hasData`).

## Workflow lengkap

### Hari H-1 (di world lama)

1. **Pastikan semua data sync**
   - Player online dapat di-export langsung dari memory
   - Player offline di-export dari `p_reg` registry
   - Confirm registry up-to-date: minta active player relog 1× sebelum H

2. **Trigger export (admin tag `mimi` saja)**
   ```
   /scriptevent gacha:bulk_export
   ```
   Output akan muncul di **console server** (bukan chat). Format:
   ```
   [GachaExport] 47 player | 1283 chars
   [GachaExport] GSALL5|47|AndiKuat:1500:7f:120:30|BudiSantoso:850:1c:80:10|...
   ```

3. **Copy string `GSALL5|...|...|` dari console**
   - Simpan ke file teks (mis. `season-1-export.txt`)
   - Backup di tempat aman (cloud/external drive)
   - Verify panjang string match `chars` count yang dilaporkan

4. **Optional — verify isi**
   ```
   /scriptevent gacha:prepare_import GSALL5|47|...
   ```
   Output akan show count player di-detect. Tidak apply, hanya validate.
   Bisa dibatalkan dengan `gacha:clear_staged`.

### Hari H (deploy world baru)

5. **Setup world baru fresh** (tidak copy `db/`)
   - Buat folder world baru di `BDS/worlds/<NAMA>/`
   - Copy pack files dari `behavior_packs/` (Economy + Mimi Land)
   - Edit `world_behavior_packs.json` — aktifkan UUID kedua pack
   - Set `OFFLINE_MODE` di `Economy/scripts/leaderboard/sync_http.js` sesuai env
   - Generate world baru via menu Bedrock client → join → quit (initial seed)

6. **Verify pack load sukses**
   - Start BDS, cek console log:
     ```
     Mimi Land loaded.
     [Eco-Pricing] init basis=57
     ```
   - Tidak ada error startup

7. **Trigger import di world baru**
   - Pastikan tag `mimi` di player admin
   - Kirim string yang di-backup:
     ```
     /scriptevent gacha:bulk_import GSALL5|47|AndiKuat:1500:7f:120:30|...
     ```
   - Output:
     ```
     [GachaBulk] bulk_import via scriptevent: 47 entries -> applied:3 pending:44 notFound:0
     ```
   - `applied`  = player online saat import → langsung dapat
   - `pending`  = player offline → akan dapat saat login pertama
   - `notFound` = nama tidak ada di `p_reg` (player baru, belum pernah login di world baru)

### Player offline yang belum pernah login di world baru

8. **Handling notFound**
   - Player yang notFound = belum pernah join world baru → registry kosong
   - **Solusi**: import ulang setelah mereka login pertama, atau pakai
     individual import via UI gacha (Admin → Export/Import → Single)
   - Alternatif praktis: kirim mass-DM ke player suruh join 1× di hari H,
     lalu run import lagi setelah 24 jam

### Hari H+1

9. **Reset first-topup marker (opsional)**
   - Player yang punya gem migrated akan auto-grandfathered → tidak dapat
     bonus +50% lagi (sesuai design — mereka sudah pernah engage gem)
   - Kalau season baru ingin **reset semua** (event spesial), hapus marker
     dari console:
     ```
     /scriptevent eco:reset_firsttopup all
     ```
     (catatan: command ini belum ada — perlu request kalau dibutuhkan)

10. **Verify migrasi sukses**
    - Run `/lt:baseline` di world baru
    - Section "Q1 PENETRASI GEM" harus show holder count match dengan
      jumlah player yang punya `gem > 0` di world lama
    - Section "Q2 DISTRIBUSI" — total gem harus match jumlah export

## Yang HARUS dilakukan player

Player yang ikut migrasi:
- Login ke world baru → otomatis dapat data via pending import
- Pesan saat login: `[★] Import offline diterapkan! Gem: <X> Partikel: <N>`
- Tidak perlu klik tombol apapun

## Edge cases

### Player nama duplikat (rename antara H-1 dan H)
Bedrock identify by player ID, tapi import pakai name (case-insensitive).
Kalau player rename antara export dan import, mereka tidak akan di-match.
**Mitigasi**: lakukan export di H-1 setelah jam-jam ramai (asumsi jarang
rename), import segera di H.

### `applied` jauh lebih kecil dari `pending`
Normal — sebagian besar player offline saat import dilakukan.

### `notFound` > 0
Player yang nama-nya muncul di export tapi tidak ada di registry world baru.
Penyebab: player belum pernah login di world baru.

**Solusi**: tunggu mereka login dulu, lalu run import ulang dengan string yang
sama. `applyBulkAll` aman di-replay (no double credit — pending key di-overwrite).

### String terlalu panjang untuk single command
ScriptEvent message limit kira-kira 32KB. Untuk 1000+ player, string bisa
overflow. **Mitigasi**: pecah jadi 2 chunk pakai admin UI gacha (Admin Panel
→ Export/Import → Bulk → "Send via UI" yang bisa handle larger payload).

### OFFLINE_MODE
Set sesuai environment world baru:
- Staging/test world → `true` (default, tidak panggil Supabase)
- Production world → `false` (sync aktif)
**Iron rule**: jangan toggle tanpa konfirmasi.

## Yang TIDAK bisa di-migrate dengan tool ini

- Saldo coin (sengaja — fresh economy)
- Land claims (Mimi Land registry)
- Bank balance & history
- Auction listings & history
- Daily quest progress, login streak
- Combat PvP stats
- Wealth tax cumulative

Kalau perlu migrate salah satu di atas, butuh fitur tambahan (saat ini tidak
ada). Sebut spesifik kalau dibutuhkan, saya bisa scope ulang.

## Action saat error

| Symptom | Cara verify | Mitigation |
|---|---|---|
| `Versi tidak cocok` saat import | Cek prefix string apakah `GSALL5` | Re-export di world lama dengan pack version yang sama |
| `Tidak ada data player` | String mungkin truncated saat copy | Re-export, pastikan copy full string termasuk akhir |
| `applied:0 pending:0 notFound:N` | Semua nama tidak match registry | Player belum login di world baru — tunggu lalu retry |
| Player tidak dapat data saat login | Cek DP `imp_p:<player_id>` exists | Manual force apply via admin UI single import |
| Gem balance tidak sesuai harapan | Cek scoreboard `gem` & DP `p_reg` | Re-import string yang sama untuk player tersebut |

## Cleanup post-migration

- DP `gacha:topup_log` di world lama bisa di-archive (tidak perlu migrate)
- Welcome metrics counter di world baru: 0 (start fresh)
- First-topup marker di world baru: auto-set untuk player yang migrate gem
  (via `maybeGrandfatherFirstTopup` di `gacha/main.js` playerSpawn handler)

Setelah 1 minggu, cek `/lt:baseline` — kalau distribusi gem & player count
match expectation, migrasi sukses.

## Reset Supabase (anti free-tier limit)

Free tier Supabase 500MB. Time-series tables (`economy_history`,
`metrics_history`) tumbuh ~100MB/bulan. Saat season baru, reset supaya tidak
hit limit + chart fresh.

### Tool: `admin/season-reset.html`

Akses via browser admin (perlu password admin yang sama dengan tombol reset
di economy-page.js — default `wahyu1234`, ganti hash di file kalau perlu).

URL: `https://your-domain/admin/season-reset.html` atau `file:///` lokal.

### Checklist tabel

| Tabel | Tier | PK type | Filter | Reset saat season? |
|---|---|---|---|---|
| `economy_history` | SAFE | int | `id=gte.0` | Ya — auto re-populate via sync BDS |
| `metrics_history` | SAFE | bigint | `id=gte.0` | Ya — auto re-populate via sync BDS |
| `weather_history` | PERMANEN | bigint | `id=gte.0` | Opsional — history hilang permanen |
| `topup_queue` | PERMANEN | uuid | `status=in.(done,failed)` | Opsional — pending TIDAK ikut terhapus |
| `orders` | PERMANEN | (auth-gated) | — | TIDAK via tool ini — perlu auth admin |
| `leaderboard_sync` | (jangan reset) | — | — | Auto-overwrite via sync BDS, tidak grow |
| `admin_roles` | (jangan reset) | — | — | Auth — kalau di-reset semua admin lockout |
| `site_config` | (jangan reset) | — | — | Config server |

> Tabel `player_snapshots` sudah dihapus per 2026-05 — duplikat dengan
> `metrics_history.online_players`. Grafik player count tetap tersedia di
> halaman `/monitor.html` lewat tabel `metrics_history`.

### Workflow reset Supabase

1. **Backup dulu** kalau ragu — export tabel via Supabase Studio
   atau pakai existing button "Reset Total" di tab Trend (yang juga DELETE
   `economy_history` dengan filter `id=gte.0`)

2. **Buka tool**: navigasi ke `admin/season-reset.html`

3. **Login** dengan password admin

4. **Refresh count** — lihat jumlah row tiap tabel saat ini. Kalau ada
   tabel >50k row, prioritaskan reset.

5. **Pilih tabel**:
   - Default: hanya `economy_history` + `metrics_history` ter-checklist
   - Klik "Pilih Semua Aman" → tier SAFE saja
   - Manual checklist tabel tier PERMANEN kalau yakin

6. **Eksekusi** → konfirmasi 2× → log progress real-time

7. **Verify** — refresh count setelah selesai. Sukses kalau row count = 0.

### Setelah reset

- Sync BDS pertama (~5 menit setelah reset) akan mulai isi `economy_history`
  & `metrics_history` lagi dengan data fresh.
- Chart di `/economy.html` & `/monitor.html` akan empty selama 5-10 menit,
  lalu mulai ada candle baru.
- `OFFLINE_MODE` di pack harus `false` supaya sync BDS jalan ke Supabase
  (kalau `true`, reset Supabase jadi sia-sia karena tidak ada yang re-populate).

### Catatan iron rule

Tool ini hanya **DELETE** dari Supabase, tidak menulis ke `leaderboard_sync`.
Iron rule "Sync writer = BDS only, web tidak boleh write `leaderboard_sync`"
masih dipatuhi — write tetap eksklusif dari pack BDS.
