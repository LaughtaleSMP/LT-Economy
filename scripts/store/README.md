# Store Module — Bahan Build dengan Tier Harian Progresif

Toko bahan build terintegrasi ke ekosistem Economy Addon. Harga otomatis
mengikuti kondisi ekonomi server via DP `eco:pricing` (sama dengan Gacha & Land).

## Filosofi

| Tujuan | Mekanisme |
|---|---|
| Ramah pemain biasa | Beli 1-5 unit = harga normal murah |
| Anti-monopoli top holder | Beli 100+ unit = harga ×7 per unit |
| Koin tidak ditimbun | Semua pembayaran masuk `store_sink` (coin burn) |
| Self-balancing | Harga naik otomatis saat inflasi, turun saat deflasi |

## Komponen

```
store/
├── config.js    — Tier multiplier, basis reader, kalkulasi progresif
├── catalog.js   — 60+ SKU item build dengan bobot harga per-difficulty
├── helpers.js   — Coin ops, lock, cooldown, inventory (pola Bank/Auction)
├── storage.js   — Batched DP writes (zero per-event write), 20s flush
├── ui.js        — Menu utama, kategori, buy flow, stats, guide, admin
├── main.js      — Entry: register /lt:store, event hooks, start flush loop
└── README.md    — (file ini)
```

## Command

- **`/lt:store`** — Primary command untuk buka Store
- **`/lt:store_toggle`** — Admin: aktif/nonaktifkan Store (kill switch, persistent)
- **`/lt:store_reset`** — Admin: hapus semua data Store (testing only, tidak sentuh Bank/Auction/dll)

## Dev / Test Mode — Lindungi Data Production

Addon ini connect ke Supabase untuk dashboard web (leaderboard sync, metrics, topup).
Kalau Anda test di server lokal, data production bisa tertimpa.

### Cara Pakai (Simpel — 1 Baris Config)

Buka file **`leaderboard/sync.js`**, cari baris:

```js
const OFFLINE_MODE = false;
```

Ubah ke `true` saat test lokal:

```js
const OFFLINE_MODE = true;
```

Save, copy addon ke BDS lokal, start server. Semua sync Supabase otomatis mati.

Selesai test? Ubah balik ke `false`, deploy ke production.

### Yang OFFLINE_MODE Matikan

- ❌ Leaderboard sync (5 min) — tidak PATCH production row
- ❌ Topup poll (30 s) — tidak klaim topup production
- ❌ Micro-sync positions (5 s) — tidak overwrite monitor
- ❌ Metrics history insert
- ❌ Economy history insert

### Yang Tetap Normal

- ✅ Gameplay (bank, auction, gacha, store, combat, dll) jalan lokal
- ✅ Wealth tax collection harian
- ✅ Semua UI
- ⚠️ `eco:pricing` tidak update → Store pakai `DEFAULT_BASIS=57`

### Pengingat Otomatis

Saat `OFFLINE_MODE = true`, console BDS akan print warning:

```
╔════════════════════════════════════════════════════════╗
║  ⚠️  OFFLINE_MODE = true  — SUPABASE SYNC DIMATIKAN  ⚠️  ║
║  Data TIDAK dikirim ke production dashboard.           ║
║  Ubah ke 'false' di sync.js sebelum deploy production. ║
╚════════════════════════════════════════════════════════╝
```

Supaya Anda tidak lupa balikin sebelum deploy.

## Tier Harian Progresif

Per kategori, per player, reset 20:00 WIB setiap hari:

| Unit ke- | Multiplier | Filosofi |
|---|---|---|
| 1-5     | ×1.0 | Harga dasar |
| 6-20    | ×1.6 | Casual builder |
| 21-50   | ×2.8 | Serious builder |
| 51-100  | ×4.5 | Bulk buyer |
| 100+    | ×7.0 | Whale (anti-monopoli) |

## Performa

- **Zero DP write per pembelian** — semua akumulasi in-memory
- **Batched flush 20s** — 1 DP write per player dirty per 20 detik
- **Player DP** untuk data harian & stats (tidak bengkak world DP)
- **Rolling audit log** max 20 entry di world DP (~1KB)
- **Lock per-player** cegah race condition
- **Int32 clamp** semua coin ops
- **Re-check state** setelah await UI (anti stale-data exploit)
- **Auto-reset period** on read (tidak perlu scheduler)
- **Cache-on-leave cleanup** tidak leak memori

## Integrasi Ekonomi

| Komponen | Source |
|---|---|
| Basis harga | `world.getDynamicProperty("eco:pricing").iph` |
| Sink tracking | `trackFlow("store_sink", -amount)` |
| Storage pattern | Sama dengan Bank/Auction/Tax |
| UI style | Match Daily System premium style |

## Dashboard Web

- **index.html** → Feature card Store (#15)
- **economy.html** → Card "Store (Bahan Build)" di grid Panduan Fitur & Harga
- **economy-page.js** → `store_sink` masuk di list sinks (dashboard inflasi)
- **welcome.js** → Page `guideStore()` di in-game `/guide`

## Keamanan & Anti-Bug

1. ✅ Lock cegah double-spend saat rapid click
2. ✅ Re-check saldo & limit di dalam lock
3. ✅ Pre-check inventory space sebelum deduct coin
4. ✅ Partial-give refund proportional (saldo tidak hilang)
5. ✅ Integer math untuk coin (zero floating-point bug)
6. ✅ Ceil per-tier (fair ke player vs ceil total)
7. ✅ Purchase cooldown 10 ticks (mitigasi client-side rapid fire)
8. ✅ Limit harian 200/kategori (hard cap)
9. ✅ Max 16 per klik (cegah accidental borong)
10. ✅ Try/catch di semua DP ops (no uncaught error bisa crash interval)

## Admin Commands

- `lt:store` sebagai player tag `mimi` → admin panel (audit log, stats)

## Future Extensions (tidak dibangun sekarang)

- Discount code (pola dari Gacha discount)
- Featured item harian (spotlight + extra diskon)
- Group buy (5+ player patungan untuk diskon)
- Subsidy dari treasury untuk saldo < 5K (lihat Tax/wealth.js `applySubsidy`)
