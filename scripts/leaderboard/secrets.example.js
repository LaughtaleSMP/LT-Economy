/* ══════════════════════════════════════════════════════════════
   secrets.example.js — Template untuk secrets.js
   ══════════════════════════════════════════════════════════════
   
   CARA PAKAI:
   1. Rename file ini menjadi  secrets.js
   2. Buka Supabase Dashboard → Project Store → Settings → API Keys
   3. Klik tab "Legacy anon, service_role API keys"
   4. Copy "service_role" key (yang dimulai dengan eyJhbGci...)
   5. Paste di bawah, ganti PASTE_YOUR_KEY_HERE
   
   PENTING:
   - JANGAN push secrets.js ke Git (sudah di-.gitignore)
   - JANGAN taruh key ini di website/client
   - Key ini bypass RLS — hanya untuk BDS server
   ══════════════════════════════════════════════════════════════ */

export const SERVICE_ROLE_KEY = "PASTE_YOUR_SERVICE_ROLE_KEY_HERE";
