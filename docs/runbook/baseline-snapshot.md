# Runbook — Baseline Gem Snapshot (`/lt:baseline`)

## Tujuan

Tool diagnostik **read-only** untuk admin. Menjawab 4 pertanyaan kunci sebelum
eksekusi roadmap peningkatan pembelian gem (P0 dari rekomendasi panel pakar 8
perspektif di `WebStore-main/CODING_STANDARDS.md`):

1. **Reach** — berapa player pernah pegang gem? (penetration rate)
2. **Distribution** — avg / median / p90 / p99 balance gem (skew whale?)
3. **Sink ratio** — gem keluar via land vs gacha vs lain
4. **Throughput** — gem in (topup) vs gem out (sink), windowed sejak sync terakhir

## Cara pakai

Player harus punya tag `mimi` (admin tag standar project).

```
/lt:baseline
```

Output dikirim ke chat player + `console.log` summary 1 baris untuk audit trail.

## Yang dibaca (read-only)

| Sumber | Field |
|---|---|
| World DP `p_reg` (chunked) | n player, balance gem/coin per player (snapshot) |
| Scoreboard `gem`, `coin` | Override balance untuk player online (live) |
| World DP `eco:flow` | Flow per source (sejak sync terakhir, **non-destruktif**) |
| Scoreboard `_eco_flow` | Cross-pack flow dari Mimi Land (`land_buy_gem` dll) |
| World DP `topup:daily:<UTCday>:<currency>:<name>` | Topup per player hari ini |
| World DP `topup:first:<name>` | Marker first-topup bonus claimed (read di sync_topup) |

## Yang TIDAK dilakukan

- ❌ Tidak memanggil `consumeFlow()` — counter eco:flow tidak di-reset.
  Sync 5-menit-an Economy tetap dapat data lengkap.
- ❌ Tidak menulis DP atau scoreboard.
- ❌ Tidak panggil HTTP / Supabase.

## Iron-rule compliance

- 🎓 Ekonom — read-only, tidak mengganggu source/sink existing.
- ⚙️ Engineer — single command invoke, ≤1 iterasi `getDynamicPropertyIds()`.
  Cost: ~10-50ms tergantung jumlah player tercatat.
- 🔒 Security — gate via `hasTag("mimi")`. Non-admin → "Akses ditolak."
- 🛡️ SRE — no on-call notice (read-only, idempotent, tidak ada side-effect).
- 📊 Data Scientist — laporkan p50/p75/p90/p99, bukan cuma avg.

## Interpretasi output

### Heuristik diagnosis (otomatis di output)

| Penetrasi | Fokus berikutnya |
|---|---|
| <10% | AWARENESS — visibility hooks, welcome calculator |
| 10-30% | KONVERSI — first-topup bonus, sink baru |
| >30% | RETENSI — premium pass, leaderboard opt-in |

| Skew p99/p50 | Tindakan |
|---|---|
| <10× | Distribusi sehat |
| 10-50× | Moderate — leaderboard opt-in OK |
| >50× | Whale dominasi — hindari leaderboard publik |

## Limitasi sekarang

- **Q4 windowing**: data hanya sejak sync terakhir (≤5 menit). Untuk trend
  mingguan butuh `OFFLINE_MODE = false` + query `economy_history` di Supabase.
- **`p_reg` snapshot**: balance offline player adalah snapshot terakhir saat
  player itu online. Bisa stale untuk player yang lama tidak login.

## Flow keys (post-split)

| Key | Currency | Direction |
|---|---|---|
| `topup` | gem (admin), coin (admin) | source |
| `topup_first_bonus` | gem | source (sekali per player) |
| `gacha_cost` | coin | sink (gacha eq) |
| `gacha_refund` | coin | source (refund cancel/error) |
| `gacha_gem_cost` | gem | sink (gacha partikel) |
| `gacha_gem_refund` | gem | source (duplicate refund 5g) |
| `land_buy_gem` | gem | sink (Mimi Land bayar gem) |

## Roadmap follow-up

1. ~~Split `gacha_cost`~~ ✅ Done — sekarang punya `gacha_cost` (coin), `gacha_refund` (coin), `gacha_gem_cost` (gem), `gacha_gem_refund` (gem).
2. Setelah ≥1 minggu data terkumpul (OFFLINE_MODE=false di staging), bandingkan
   distribusi & sink ratio untuk validate hipotesis P1.
3. Opsional: tulis hasil `/lt:baseline` ke DP `eco:baseline_last` (cap 30 hari)
   supaya bisa di-tarik via web.
