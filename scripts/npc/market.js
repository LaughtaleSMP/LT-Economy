// npc/market.js — NPC Market Hub

import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { isPurgeActive } from "../purge_gate.js";
import { UIClose } from "../ui_close.js";
import { addCoin, getCoin, fmt } from "../store/helpers.js";

// Feature opener imports (semua modul yang bisa di-assign ke NPC)
import { openStoreMenu } from "../store/ui.js";
import { openAuctionNPC } from "../auction/main.js";
import { openGachaNPC } from "../gacha/main.js";
import { openDailyMenu } from "../daily/ui.js";
import { openBankMenu } from "../Bank/main.js";
import { showLeaderboard } from "../leaderboard/main.js";

// Gugugaga mood system tetap (satu-satunya role khusus)
import { openGuguMoodMenu, getMoodMultiplier, markFed } from "./role_gugugaga.js";


const ENTITY_TYPE = "lt:market_npc";
const TAG = "lt_market";
const DP_REGISTRY = "eco:npc_registry";
const ADMIN_TAG = "admin";

// Ikan yang bisa dikasih ke Gugugaga
const FISH_ITEMS = new Set([
  "minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:pufferfish",
  "minecraft:cooked_cod", "minecraft:cooked_salmon",
]);

// Set untuk track Gugugaga yang sedang lompat (anti-spam)
const _happyNPCs = new Set();

// Set untuk track player yang sedang proses feeding Gugugaga
// (mencegah player makan ikan sendiri saat mundur)
const _feedingPlayers = new Set();

// Set untuk track NPC yang sedang "bicara" via nametag (skip sync)
const _talkingNPCs = new Set();

// Cooldown kasih ikan — 5 menit per player
const GUGU_FEED_COOLDOWN = 5 * 60 * 1000; // 5 menit (ms)
const _guguFeedCooldown = new Map();

// Debounce interaksi NPC — cegah double-fire (main hand + off hand)
const _interactCooldown = new Map(); // playerId → tick

// Idle dialogue system — NPC "bicara" via nametag saat player dekat
const IDLE_CHAT_RADIUS = 8;            // blok radius deteksi player
const IDLE_CHAT_COOLDOWN = 15;         // 15 detik (1 cycle = 1 detik karena interval 20 tick)
const IDLE_CHAT_DURATION = 60;         // 3 detik tampil (dalam tick)
const _npcChatCooldown = new Map();    // npcId → tick countdown

// Dialog idle ambient — lebih pendek, untuk nametag floating
const IDLE_CHAT_LINES = {
  0: [ // Luffy
    "§e§oShishishi~",
    "§e§oYohoho!",
    "§e§oMau kemana~?",
    "§e§oDaging!!\n§e§o...eh, halo!",
    "§e§oHei nakama!",
    "§e§oPetualangan menanti!",
    "§e§oAyo jelajah!",
  ],
  1: [ // Alice
    "§d§oHari yang tenang.",
    "§d§oAngin sepoi~",
    "§d§oAda perlu?",
    "§d§oJangan buru-buru.",
    "§d§oSiap tempur!",
    "§d§oHari ini cerah~",
    "§d§oJangan lengah!",
  ],
  2: null, // sama dengan skin 1 (Alice malam)
  3: [ // Furina
    "§9§oHmph~",
    "§9§oPertunjukan\n§9§osegera dimulai!",
    "§9§oMemandangiku?",
    "§9§oAku tidak suka\n§9§omenunggu.",
    "§9§oBintang utama~",
    "§9§oTak ada yang\n§9§olebih elegan.",
  ],
  4: [ // Gugugaga
    "§e§oGugu~?",
    "§e§oGaga!",
    "§e§oGugu gugu~",
    "§e§oGugugaga~!",
    "§e§oGugu gaga!",
  ],
  5: [ // Nahida
    "§a§oIrminsul\n§a§oberbisik...",
    "§a§oAku tahu\n§a§obanyak hal~",
    "§a§oMimpi indah...",
    "§a§oHai, Traveler~",
    "§a§oPengetahuan\n§a§oadalah cahaya.",
    "§a§oKabar baik~",
  ],
};

// Suara custom Gugugaga — random saat interaksi
const GUGU_SOUNDS_IDLE = [
  "custom.gugugaga.signature",
  "custom.gugugaga.cute",
  "custom.gugugaga.cute2",
  "custom.gugugaga.confused",
];
const GUGU_SOUNDS_HAPPY = [
  "custom.gugugaga.excited",
  "custom.gugugaga.cute",
  "custom.gugugaga.cute2",
];
const GUGU_SOUND_MAD = "custom.gugugaga.mad";

// Skin indexes yang pakai custom 3D model (bisa diatur scale-nya)
const CUSTOM_MODEL_SKINS = new Set([1, 2, 3, 4, 5]); // Semua skin 3D

// Default scale per skin (sesuai proporsi karakter asli)
// Scale 1=0.55  2=0.65  3=0.75  4=0.85  5=0.95
const DEFAULT_SKIN_SCALE = {
  1: 3, // Alice siang (0.75)
  2: 3, // Alice malam (0.75)
  3: 4, // Furina (0.85)
  4: 4, // Gugugaga (0.85)
  5: 2, // Nahida (0.65)
};

// Default nametag height level per skin (1-20, setiap level = 0.1 blok)
// Level 1 = 0.5 blok, Level 10 = 1.4 blok, Level 14 = 1.8 blok, Level 20 = 2.4 blok
const DEFAULT_NAMETAG_H = {
  0: 14, // Luffy (humanoid normal → 1.8 blok)
  1: 10, // Alice siang
  2: 10, // Alice malam
  3: 10, // Furina
  4: 5,  // Gugugaga
  5: 5,  // Nahida
};

// Scale level labels
const SCALE_LABELS = [
  "",
  "§c1 §f- Mungil (0.55x)",
  "§e2 §f- Kecil (0.65x)",
  "§a3 §f- Sedang (0.75x)",
  "§b4 §f- Besar (0.85x)",
  "§d5 §f- Jumbo (0.95x)",
];

const SKIN_NAMES = [
  "Luffy",
  "Alice",
  "Alice",  // skin 2 = Alice malam (visual beda, karakter sama)
  "Furina",
  "Gugugaga",
  "Nahida",
];

// Skin yang bisa dipilih admin. Skin 1 (Alice siang) skip — otomatis swap dari skin 2.
const PICKABLE_SKINS = [0, 2, 3, 4, 5];
const PICKABLE_LABELS = [
  { name: "Luffy", color: "§c", size: "" },
  { name: "[3D] Alice", color: "§d", size: "Sedang" },
  { name: "[3D] Furina", color: "§9", size: "Jumbo" },
  { name: "[3D] Gugugaga", color: "§e", size: "Kecil" },
  { name: "[3D] Nahida", color: "§a", size: "Kecil" },
];

const SKIN_COLORS = ["§c", "§d", "§b", "§9", "§e", "§a"];

// Display names untuk nametag NPC
const NPC_DISPLAY_NAMES = [
  "Luffy",
  "Alice",
  "Alice",  // skin 2 = Alice malam
  "Furina",
  "Gugugaga",
  "Nahida",
];

// Menu definitions — fitur yang bisa di-assign ke NPC
const FEATURE_DEFS = {
  store:       { label: "Store Bahan Build",       desc: "Beli blok & utility",           icon: "textures/blocks/emerald_block",   color: "§a" },
  auction:     { label: "Auction House",            desc: "Jual beli item antar player",   icon: "textures/items/emerald",          color: "§e" },
  gacha:       { label: "Gacha Hub",                desc: "Partikel & peralatan random",   icon: "textures/items/nether_star",      color: "§d" },
  daily:       { label: "Daily Quest",              desc: "Quest & Achievement harian",    icon: "textures/items/book_writable",    color: "§b" },
  bank:        { label: "Bank Koin",                desc: "Simpan & tarik koin",           icon: "textures/items/gold_ingot",       color: "§6" },
  leaderboard: { label: "Leaderboard",              desc: "Top pemain server",             icon: "textures/items/diamond",          color: "§e" },
  particle:    { label: "Particle Trail",           desc: "Toggle efek partikel",          icon: "textures/items/blaze_powder",     color: "§9" },
};
const ALL_FEATURE_KEYS = Object.keys(FEATURE_DEFS);

// Feature opener map — key -> async function(player)
const FEATURE_OPENERS = {
  store:       (player) => openStoreMenu(player),
  auction:     (player) => openAuctionNPC(player),
  gacha:       (player) => openGachaNPC(player),
  daily:       (player) => openDailyMenu(player),
  bank:        (player) => openBankMenu(player),
  leaderboard: (player) => showLeaderboard(player),
  particle:    (player) => {
    try {
      const safeName = player.name.replace(/"/g, '');
      player.dimension.runCommand(`execute as @a[name="${safeName}"] run scriptevent particle:open_menu`);
    } catch { player.sendMessage("§8[Sistem]§c Particle system tidak tersedia."); }
  },
};

// Cache registry parse untuk isFeatureOnNPC — hindari JSON.parse tiap command
let _featureCache = null;
let _featureCacheTs = 0;
const FEATURE_CACHE_TTL = 5000; // 5 detik

function _getCachedRegistry() {
  const now = Date.now();
  if (_featureCache && now - _featureCacheTs < FEATURE_CACHE_TTL) return _featureCache;
  _featureCache = getRegistry();
  _featureCacheTs = now;
  return _featureCache;
}

/** Cek apakah fitur sudah di-assign ke NPC manapun (cached) */
export function isFeatureOnNPC(featureKey) {
  const reg = _getCachedRegistry();
  return reg.some(e => {
    const feats = e.features || e.menus || [];
    return feats.includes(featureKey);
  });
}

// Dialog interaktif per karakter — random tiap interaksi (universal, tidak terikat fitur)
const NPC_DIALOGUES = {
  0: [ // Luffy — Kapten energik
    "Shishishi! Ada yang bisa kubantu?",
    "Yo nakama! Mau lihat apa hari ini?",
    "Aku akan jadi Raja Bajak Laut! Tapi silakan dulu~",
    "Hei! Hari ini pasti seru!",
    "Nakama! Ayo kita mulai petualangan!",
    "Shishishi, aku sudah menunggumu!",
    "Butuh bantuan? Kapten siap melayani!",
  ],
  1: [ // Alice — Tenang, ramah
    "Halo! Ada yang bisa kubantu?",
    "Selamat datang~ Silakan lihat-lihat.",
    "Hari yang indah untuk mampir, ya?",
    "Jangan sungkan, aku di sini untukmu.",
    "Butuh sesuatu? Aku siap membantu.",
    "Senang bertemu denganmu lagi!",
    "Santai saja, tidak perlu buru-buru.",
  ],
  2: null, // sama dengan skin 1
  3: [ // Furina — Dramatis, percaya diri
    "Ah, kau datang menemui Furina! Pilihan yang tepat.",
    "Pertunjukan terbaik dimulai dari sini!",
    "Hmph, kau beruntung bisa dilayani oleh sang bintang~",
    "Furina selalu siap! Ada apa?",
    "Kau datang di saat yang sempurna!",
    "Layanan terbaik hanya dari yang terbaik. Yaitu aku.",
    "Tak ada yang lebih elegan dari pelayananku~",
  ],
  4: [ // Gugugaga
    "Gugugaga!",
    "Gugu... gaga!",
    "Gugugaga gugugaga!",
    "Gaga... gugu gaga!",
    "Gugugaga? Gugugaga!",
    "Gugu gugu gaga gaga!",
  ],
  5: [ // Nahida — Bijak, lembut
    "Selamat datang~ Irminsul membimbingmu ke sini.",
    "Hai! Ada yang ingin kamu ketahui?",
    "Pengetahuan dan kebaikan, itulah yang kutawarkan.",
    "Aku kecil, tapi aku bisa banyak membantu!",
    "Dunia ini penuh keajaiban. Mau kubantu jelajahi?",
    "Senang bisa bertemu denganmu hari ini~",
    "Setiap hari ada hal baru. Ayo kita mulai!",
  ],
};



/** @returns {{ x:number, y:number, z:number, dim:string, menus:string[], name:string }[]} */
function getRegistry() {
  try {
    const raw = world.getDynamicProperty(DP_REGISTRY);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return [];
}

function saveRegistry(arr) {
  try {
    world.setDynamicProperty(DP_REGISTRY, JSON.stringify(arr));
    _featureCache = null; // invalidasi cache isFeatureOnNPC
    _featureCacheTs = 0;
  } catch (e) { console.warn("[NPC Market] Failed to save registry:", e); }
}

// ═══════════════════════════════════════════════════════════
// PLAYER INTERACTION — entity interact → ActionForm
// ═══════════════════════════════════════════════════════════

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  try {
    if (!ev.target || ev.target.typeId !== ENTITY_TYPE) return;
    if (!ev.target.hasTag(TAG)) return;

    ev.cancel = true;
    const player = ev.player;
    const npc = ev.target;

    // Debounce — cegah double-fire dalam 5 tick
    const now = system.currentTick;
    if ((now - (_interactCooldown.get(player.id) ?? 0)) < 5) return;
    _interactCooldown.set(player.id, now);

    system.run(async () => {
      try {
        // Gugugaga + ikan = lompat senang!
        const skinIdx = npc.getProperty("lt:skin") ?? 0;
        if (skinIdx === 4 && !_happyNPCs.has(npc.id)) {
          const inv = player.getComponent("minecraft:inventory")?.container;
          const mainhand = inv?.getItem(player.selectedSlotIndex);
          if (mainhand && FISH_ITEMS.has(mainhand.typeId)) {
            _feedingPlayers.add(player.id);
            _gugugagaEatFish(player, npc, mainhand);
            return;
          }
        }
        await _showMarketMenu(player, npc);
      } catch (e) {
        if (!e?.isUIClose) console.warn("[NPC Market] Menu error:", e);
      }
    });
  } catch {}
});

// ═══════════════════════════════════════════════════════════
// MARKET MENU — ActionForm
// ═══════════════════════════════════════════════════════════

async function _showMarketMenu(player, npc) {
  // Purge check
  if (isPurgeActive()) {
    player.sendMessage("§8[Sistem] §cPilar Energi offline — market tidak tersedia.");
    return;
  }

  const skinIdx = npc?.isValid ? (npc.getProperty("lt:skin") ?? 0) : 0;

  let npcName = "NPC";
  let actualSkin = skinIdx;

  // Skin 1 & 2 = Alice (satu karakter, visual siang/malam beda)
  if (skinIdx === 1 || skinIdx === 2) {
    npcName = "Alice";
    actualSkin = 1;
    const time = world.getTimeOfDay();
    const isNight = time >= 13000;
    const visualSkin = isNight ? 2 : 1;
    if (visualSkin !== skinIdx && npc?.isValid) {
      try {
        const loc = npc.location;
        const dim = npc.dimension;
        for (let i = 0; i < 8; i++) {
          dim.spawnParticle("minecraft:totem_particle", {
            x: loc.x + (Math.random() - 0.5) * 0.8,
            y: loc.y + Math.random() * 1.5,
            z: loc.z + (Math.random() - 0.5) * 0.8,
          });
        }
        player.playSound("mob.evocation_illager.prepare_wololo", { location: loc, volume: 0.6, pitch: 1.4 });
      } catch {}
      npc.setProperty("lt:skin", visualSkin);
    }
  } else {
    npcName = SKIN_NAMES[skinIdx] || "NPC";
  }

  const dialogues = NPC_DIALOGUES[actualSkin] || NPC_DIALOGUES[0];
  const greeting = dialogues[Math.floor(Math.random() * dialogues.length)];

  // Gugugaga: play custom voice
  if (actualSkin === 4 && npc?.isValid) {
    const snd = GUGU_SOUNDS_IDLE[Math.floor(Math.random() * GUGU_SOUNDS_IDLE.length)];
    try { player.playSound(snd, { location: npc.location, volume: 0.7, pitch: 1.0 }); } catch {}
  }

  // Gugugaga (skin 4) selalu buka mood menu dulu, lalu fitur lain
  if (actualSkin === 4) {
    await openGuguMoodMenu(player, greeting);
    return;
  }

  // Cari entry registry untuk NPC ini
  const npcLoc = npc?.isValid ? npc.location : null;
  const reg = getRegistry();
  let entry = null;
  if (npcLoc) {
    let bestDist = Infinity;
    for (const e of reg) {
      if (e.dim !== npc.dimension.id) continue;
      const d = Math.abs(e.x - npcLoc.x) + Math.abs(e.y - npcLoc.y) + Math.abs(e.z - npcLoc.z);
      if (d < bestDist) { bestDist = d; entry = e; }
    }
  }

  // Ambil features dari registry (backward compat: menus -> features)
  const features = entry?.features || entry?.menus || ["store"];
  const validFeatures = features.filter(k => FEATURE_DEFS[k]);
  if (validFeatures.length === 0) validFeatures.push("store");

  // Jika hanya 1 fitur, tampilkan greeting singkat lalu langsung buka
  if (validFeatures.length === 1) {
    const def = FEATURE_DEFS[validFeatures[0]];
    const skinColor = SKIN_COLORS[actualSkin] || "§f";
    const form = new ActionFormData()
      .title(`§8« ${skinColor}${npcName} §8»`)
      .body(
        `  §f§o"${greeting}"§r\n\n` +
        `  §8Layanan: ${def.color}${def.label}`
      )
      .button(`${def.color}  ${def.label}\n§r§8${def.desc}`, def.icon)
      .button("§c  Tutup", "textures/items/barrier");

    const res = await form.show(player);
    if (res.canceled || res.selection === 1) return;
    const opener = FEATURE_OPENERS[validFeatures[0]];
    if (opener) await opener(player);
    return;
  }

  // Multi-fitur: tampilkan menu pilihan
  const skinColor = SKIN_COLORS[actualSkin] || "§f";
  const form = new ActionFormData()
    .title(`§8« ${skinColor}${npcName} §8»`)
    .body(
      `  §f§o"${greeting}"§r\n\n` +
      `  §8Pilih layanan:`
    );

  const featureKeys = [];
  for (const key of validFeatures) {
    const def = FEATURE_DEFS[key];
    if (!def) continue;
    form.button(`${def.color}  ${def.label}\n§r§8${def.desc}`, def.icon);
    featureKeys.push(key);
  }
  form.button("§c  Tutup", "textures/items/barrier");

  const res = await form.show(player);
  if (res.canceled || res.selection === featureKeys.length) return;

  const selectedKey = featureKeys[res.selection];
  const opener = FEATURE_OPENERS[selectedKey];
  if (opener) await opener(player);
}

// ═══════════════════════════════════════════════════════════
// NPC LIFECYCLE — position lock + purge despawn + auto-respawn
// ═══════════════════════════════════════════════════════════

let _lastPurgeState = false;
let _scaleCache = new Map();

system.runInterval(() => {
  try {
    const registry = getRegistry();
    if (!registry.length) return;
    const purgeNow = isPurgeActive();

    // Group entries by dimension
    const byDim = {};
    for (const e of registry) (byDim[e.dim] ??= []).push(e);

    for (const [dimId, entries] of Object.entries(byDim)) {
      const dim = world.getDimension(dimId);

      // 1 call per dimension — ringan
      let allNpcs = [];
      try { allNpcs = dim.getEntities({ type: ENTITY_TYPE, tags: [TAG] }); } catch { continue; }

      // Claim: tiap entry ambil NPC dengan skin yang COCOK dan terdekat
      // [FIX] Skin-first matching — mencegah NPC tertukar saat
      // salah satu ditarik jauh (fishing rod, knockback, dll)
      const claimed = new Set();
      const pairs = [];
      for (const entry of entries) {
        const wantSkin = entry.skin ?? 0;
        let best = null, bestDist = Infinity;
        for (const c of allNpcs) {
          if (!c?.isValid || claimed.has(c.id)) continue;
          const npcSkin = c.getProperty("lt:skin") ?? 0;
          // Skin 1 & 2 (Alice) share model — visual swap siang/malam
          // Jadi entry skin 2 boleh match NPC skin 1 dan sebaliknya
          const skinMatch = (wantSkin === 1 || wantSkin === 2)
            ? (npcSkin === 1 || npcSkin === 2)
            : (npcSkin === wantSkin);
          if (!skinMatch) continue;
          const d = Math.abs(c.location.x - entry.x) + Math.abs(c.location.z - entry.z);
          if (d < bestDist) { bestDist = d; best = c; }
        }
        // Radius 64 — NPC yang ditarik jauh tetap bisa diklaim balik
        if (best && bestDist < 64) {
          claimed.add(best.id);
          pairs.push({ entry, npc: best });
        } else {
          pairs.push({ entry, npc: null });
        }
      }

      // Hapus orphan (NPC tanpa entry — duplikat asli)
      for (const c of allNpcs) {
        if (c?.isValid && !claimed.has(c.id)) try { c.remove(); } catch {}
      }

      // Proses tiap pair
      for (const { entry, npc } of pairs) {
        const { x, y, z } = entry;

        if (purgeNow) {
          if (npc?.isValid) try { npc.remove(); } catch {}
          continue;
        }

        // Respawn jika hilang
        if (!npc?.isValid) {
          try {
            const s = dim.spawnEntity(ENTITY_TYPE, { x, y, z });
            s.addTag(TAG);
            const skin = Math.min(entry.skin ?? 0, SKIN_NAMES.length - 1);
            const scale = entry.scale ?? DEFAULT_SKIN_SCALE[skin] ?? 3;
            if (skin > 0) s.setProperty("lt:skin", skin);
            s.setProperty("lt:npc_scale", scale);
            s.nameTag = NPC_DISPLAY_NAMES[skin] || "§6§lNPC";
            _applyModelSize(s, skin);
          } catch {}
          continue;
        }

        // Position lock
        const loc = npc.location;
        if (Math.abs(loc.x - x) > 0.5 || Math.abs(loc.y - y) > 0.5 || Math.abs(loc.z - z) > 0.5) {
          try { npc.teleport({ x, y, z }); } catch {}
        }

        // Sync nametag (skip kalau NPC sedang "bicara")
        const skin = entry.skin ?? 0;
        const name = NPC_DISPLAY_NAMES[skin] || "§6§lNPC";
        if (!_talkingNPCs.has(npc.id) && npc.nameTag !== name && skin !== 3) npc.nameTag = name;

        // Sync scale
        const wantScale = entry.scale ?? DEFAULT_SKIN_SCALE[skin] ?? 3;
        if ((npc.getProperty("lt:npc_scale") ?? 3) !== wantScale) npc.setProperty("lt:npc_scale", wantScale);

        // Sync nametag height
        const wantH = entry.nametagH ?? DEFAULT_NAMETAG_H[skin] ?? 10;
        if ((npc.getProperty("lt:nametag_h") ?? 10) !== wantH) npc.setProperty("lt:nametag_h", wantH);

        // triggerEvent hanya jika belum applied
        const cacheKey = `${wantScale}_${wantH}`;
        const cached = _scaleCache.get(npc.id);
        if (cached !== cacheKey) {
          _applyModelSize(npc, skin);
          _applyNametag(npc, wantH);
          _scaleCache.set(npc.id, cacheKey);
        }
      }
    }
    _lastPurgeState = purgeNow;
    if (_scaleCache.size > 50) _scaleCache.clear();
  } catch {}
}, 60);

// ═══════════════════════════════════════════════════════════
// FURINA SHOWCASE — ambient particle cycling di sekitar NPC Furina
// ═══════════════════════════════════════════════════════════

const FURINA_PARTICLES = [
  { label: "Slime",              fx: [{ name: "particle:player_slime",  height: 0 }] },
  { label: "Cloud",              fx: [{ name: "particle:player_cloud",  height: 0 }] },
  { label: "Ice",                fx: [{ name: "particle:player_ice",    height: 0 }] },
  { label: "Static + E Static",  fx: [{ name: "Gem:staticring", height: 0.1 }, { name: "Gem:estatic", height: 1 }] },
  { label: "Small Ring",         fx: [{ name: "Gem:smallring",          height: 0 }] },
  { label: "SF Ring",            fx: [{ name: "Gem:sfring",             height: 0 }] },
  { label: "Negative Ring",      fx: [{ name: "Gem:negitvering",        height: 0 }] },
  { label: "Sas Coil",           fx: [{ name: "Gem:sashcoil",           height: 0 }] },
  { label: "Ash Coil",           fx: [{ name: "Gem:ashcoil",            height: 0 }] },
  { label: "Tree + Leaf",        fx: [{ name: "Gem:trees", height: 0 }, { name: "Gem:leaf", height: 0 }] },
  { label: "Portal + Sword",     fx: [{ name: "Gem:portal", height: 7 }, { name: "Gem:sword", height: 7 }] },
];
let _furinaShowIdx = 0;
let _furinaLastLabel = "";
const FURINA_CYCLE_TICKS = 100; // ganti particle tiap 5 detik

system.runInterval(() => {
  try {
    if (isPurgeActive()) return;
    const registry = _getCachedRegistry();
    const furinaEntries = registry.filter(e => (e.skin ?? 0) === 3);
    if (!furinaEntries.length) return;

    const current = FURINA_PARTICLES[_furinaShowIdx % FURINA_PARTICLES.length];

    for (const entry of furinaEntries) {
      try {
        const dim = world.getDimension(entry.dim);
        const nearby = dim.getPlayers({ location: { x: entry.x, y: entry.y, z: entry.z }, maxDistance: 16 });
        if (!nearby.length) continue;

        // Spawn semua particle dalam grup
        for (const p of current.fx) {
          const loc = { x: entry.x, y: entry.y + (p.height || 0), z: entry.z };
          try { dim.spawnParticle(p.name, loc); } catch {}
        }

        // Update nametag dengan nama particle (hanya saat label berubah)
        if (_furinaLastLabel !== current.label) {
          const entities = dim.getEntities({ type: ENTITY_TYPE, location: { x: entry.x, y: entry.y, z: entry.z }, maxDistance: 1 });
          for (const npc of entities) {
            if (!npc?.isValid || !npc.hasTag(TAG)) continue;
            npc.nameTag = `§d§lFurina\n§7▶ §b${current.label}`;
          }
        }
      } catch {}
    }
    _furinaLastLabel = current.label;
  } catch {}
}, 10);

// Ganti particle index tiap 5 detik
system.runInterval(() => { _furinaShowIdx = (_furinaShowIdx + 1) % FURINA_PARTICLES.length; }, FURINA_CYCLE_TICKS);

// ═══════════════════════════════════════════════════════════
// IDLE DIALOGUE — NPC ngomong via nametag saat player dekat
// ═══════════════════════════════════════════════════════════

system.runInterval(() => {
  try {
    const registry = getRegistry();
    if (!registry.length) return;
    if (isPurgeActive()) return;

    // Group by dimension
    const byDim = {};
    for (const e of registry) (byDim[e.dim] ??= []).push(e);

    for (const [dimId, entries] of Object.entries(byDim)) {
      const dim = world.getDimension(dimId);
      let allNpcs = [];
      try { allNpcs = dim.getEntities({ type: ENTITY_TYPE, tags: [TAG] }); } catch { continue; }

      for (const npc of allNpcs) {
        if (!npc?.isValid) continue;
        if (_talkingNPCs.has(npc.id)) continue;  // sedang bicara (feeding dll)
        if (_happyNPCs.has(npc.id)) continue;     // sedang happy animation

        // Cooldown countdown
        const cd = _npcChatCooldown.get(npc.id) ?? 0;
        if (cd > 0) {
          _npcChatCooldown.set(npc.id, cd - 1);
          continue;
        }

        // Cek apakah ada player dalam radius
        const loc = npc.location;
        let nearbyPlayers = [];
        try {
          nearbyPlayers = dim.getEntities({
            type: "minecraft:player",
            location: loc,
            maxDistance: IDLE_CHAT_RADIUS,
          });
        } catch { continue; }

        if (!nearbyPlayers.length) continue;

        // Random chance ~30% per tick cycle agar tidak semua NPC ngomong barengan
        if (Math.random() > 0.3) {
          _npcChatCooldown.set(npc.id, 3); // coba lagi 3 cycle kemudian
          continue;
        }

        // Ambil skin dan pilih dialog random
        const skinIdx = npc.getProperty("lt:skin") ?? 0;
        // Skin 2 = Alice malam, pakai pool skin 1
        const chatSkin = (skinIdx === 2) ? 1 : skinIdx;
        const lines = IDLE_CHAT_LINES[chatSkin] || IDLE_CHAT_LINES[0];
        const line = lines[Math.floor(Math.random() * lines.length)];

        // Simpan nama asli dan tampilkan dialog
        const originalName = npc.nameTag;
        _talkingNPCs.add(npc.id);
        npc.nameTag = line;

        // Gugugaga: play suara random saat idle chat
        if (skinIdx === 4) {
          const snd = GUGU_SOUNDS_IDLE[Math.floor(Math.random() * GUGU_SOUNDS_IDLE.length)];
          // Play ke player terdekat saja
          const closest = nearbyPlayers[0];
          if (closest?.isValid) {
            try { closest.playSound(snd, { location: loc, volume: 0.5, pitch: 1.0 }); } catch {}
          }
        }

        // Kembalikan nama setelah 3 detik
        system.runTimeout(() => {
          try {
            if (npc?.isValid) npc.nameTag = originalName;
          } catch {}
          _talkingNPCs.delete(npc?.id);
        }, IDLE_CHAT_DURATION);

        // Set cooldown 15-20 detik (random agar tidak sinkron)
        const randomCd = IDLE_CHAT_COOLDOWN + Math.floor(Math.random() * 5);
        _npcChatCooldown.set(npc.id, randomCd);
      }
    }

    // Safety cap
    if (_npcChatCooldown.size > 50) _npcChatCooldown.clear();
  } catch {}
}, 20); // Cek setiap 1 detik

// ═══════════════════════════════════════════════════════════
// ADMIN COMMAND — /lt:npc (satu command, semua fitur)
// ═══════════════════════════════════════════════════════════

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand(
      {
        name: "lt:npc",
        description: "NPC Market Config - register, remove, skin, help",
        permissionLevel: CommandPermissionLevel.Admin,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;
        if (!player.hasTag("mimi")) {
          system.run(() => player.sendMessage("§8[§cNPC§8]§c Akses ditolak. Butuh tag 'mimi'."));
          return;
        }
        system.run(async () => {
          try { await _showNPCConfigMenu(player); }
          catch (e) { if (!e?.isUIClose) console.warn("[NPC Market] Config:", e); }
        });
        return { status: 0 };
      }
    );
  } catch (e) {
    console.warn("[NPC Market] Command registration failed:", e);
  }
});

// ── Config Menu — ActionForm hub ──
async function _showNPCConfigMenu(player) {
  const reg = getRegistry();
  const form = new ActionFormData()
    .title("§l§6 NPC Market Config")
    .body(
      `§6NPC Market Manager\n` +
      `§fTotal NPC aktif: §a${reg.length}\n\n` +
      `§fPilih aksi di bawah:`
    );

  form.button("§a Summon NPC Baru\n§r§8Spawn NPC di posisimu");
  form.button("§c Hapus NPC Terdekat\n§r§8Hapus dalam radius 10 blok");
  form.button("§b Ganti Skin NPC\n§r§8Ubah karakter NPC terdekat");
  form.button("§e Ubah Fitur NPC\n§r§8Atur fitur NPC terdekat");
  form.button("§6 Ubah Ukuran NPC\n§r§8Atur scale model 3D");
  form.button("§e Atur Tinggi Nametag\n§r§8Naik/turun posisi nametag");
  form.button("§3 Panduan Setup\n§r§8Cara pakai NPC Market");
  form.button("§8 Tutup");

  const res = await form.show(player);
  if (res.canceled || res.selection === 7) return;

  switch (res.selection) {
    case 0: await _registerNPC(player); break;
    case 1: _removeNearestNPC(player); break;
    case 2: await _changeSkin(player); break;
    case 3: await _changeFeatures(player); break;
    case 4: await _changeScale(player); break;
    case 5: await _changeNametagHeight(player); break;
    case 6: _showHelp(player); break;
  }
}

// ═══════════════════════════════════════════════════════════
// REGISTER NPC — summon + save to registry
// ═══════════════════════════════════════════════════════════

async function _registerNPC(player) {
  // Step 1: Pilih Skin
  const skinForm = new ActionFormData()
    .title("§l§6 Step 1: Pilih Karakter")
    .body(`§fNPC akan di-spawn di posisimu.\n§fPilih skin untuk NPC ini:`);

  for (const p of PICKABLE_LABELS) {
    const sz = p.size ? ` §r§8(${p.size})` : "";
    skinForm.button(`${p.color}${p.name}${sz}`);
  }
  skinForm.button("§8 Batal");

  const skinRes = await skinForm.show(player);
  if (skinRes.canceled || skinRes.selection === PICKABLE_LABELS.length) return;

  const skinIdx = PICKABLE_SKINS[skinRes.selection];

  // Gugugaga (skin 4) — skip fitur, langsung spawn (mood system otomatis)
  let features = [];
  if (skinIdx === 4) {
    features = ["gugugaga"];
  } else {
    // Step 2: Pilih Fitur (ModalForm dengan toggle)
    const featureForm = new ModalFormData()
      .title("§l§6 Step 2: Pilih Fitur");

    for (const key of ALL_FEATURE_KEYS) {
      const def = FEATURE_DEFS[key];
      featureForm.toggle(`${def.color}${def.label}\n§r§8${def.desc}`, { defaultValue: false });
    }

    const featureRes = await featureForm.show(player);
    if (featureRes.canceled) return;

    for (let i = 0; i < ALL_FEATURE_KEYS.length; i++) {
      if (featureRes.formValues[i]) features.push(ALL_FEATURE_KEYS[i]);
    }

    if (features.length === 0) {
      player.sendMessage("§8[§cNPC§8]§c Minimal pilih 1 fitur.");
      return;
    }
  }

  const scale = DEFAULT_SKIN_SCALE[skinIdx] ?? 3;
  const displayName = NPC_DISPLAY_NAMES[skinIdx] || SKIN_NAMES[skinIdx];

  // Summon NPC
  const loc = player.location;
  const dim = player.dimension.id;
  const x = Math.floor(loc.x) + 0.5;
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z) + 0.5;

  const npc = player.dimension.spawnEntity(ENTITY_TYPE, { x, y, z });
  npc.addTag(TAG);
  npc.nameTag = displayName;

  // Set skin + scale + nametag height
  if (skinIdx > 0) npc.setProperty("lt:skin", skinIdx);
  if (CUSTOM_MODEL_SKINS.has(skinIdx)) {
    npc.setProperty("lt:npc_scale", scale);
  }
  const nametagH = DEFAULT_NAMETAG_H[skinIdx] ?? 10;
  npc.setProperty("lt:nametag_h", nametagH);
  _applyNametag(npc, nametagH);

  // Save to registry
  const registry = getRegistry();
  registry.push({ x, y, z, dim, features, name: displayName, skin: skinIdx, scale, nametagH });
  saveRegistry(registry);

  const featureLabels = features.map(k => FEATURE_DEFS[k]?.label || k).join(", ");
  player.playSound("random.orb", { volume: 0.5, pitch: 1.2 });
  player.sendMessage(
    `§8[§aNPC§8]§a NPC Market berhasil dibuat!\n` +
    `§7 Posisi: §f${Math.floor(x)}, ${y}, ${Math.floor(z)}\n` +
    `§7 Fitur: §f${featureLabels}\n` +
    `§7 Skin: §f${SKIN_NAMES[skinIdx]}\n` +
    `§7 Ukuran: §f${SCALE_LABELS[scale] || "Normal"}`
  );
}

// ═══════════════════════════════════════════════════════════
// UBAH FITUR NPC — reassign fitur ke NPC terdekat
// ═══════════════════════════════════════════════════════════

async function _changeFeatures(player) {
  const nearby = player.dimension.getEntities({
    type: ENTITY_TYPE, tags: [TAG],
    location: player.location, maxDistance: 10,
  });

  if (!nearby.length) {
    player.sendMessage("§8[§cNPC§8]§c Tidak ada NPC Market dalam radius 10 blok.");
    return;
  }

  nearby.sort((a, b) => {
    const pLoc = player.location;
    const dA = Math.abs(pLoc.x - a.location.x) + Math.abs(pLoc.z - a.location.z);
    const dB = Math.abs(pLoc.x - b.location.x) + Math.abs(pLoc.z - b.location.z);
    return dA - dB;
  });
  const npc = nearby[0];
  if (!npc?.isValid) { player.sendMessage("§8[§cNPC§8]§c NPC sudah tidak valid."); return; }

  const npcLoc = npc.location;
  const registry = getRegistry();
  let entryIdx = -1, bestDist = Infinity;
  for (let i = 0; i < registry.length; i++) {
    const e = registry[i];
    if (e.dim !== player.dimension.id) continue;
    const d = Math.abs(e.x - npcLoc.x) + Math.abs(e.z - npcLoc.z);
    if (d < bestDist) { bestDist = d; entryIdx = i; }
  }
  if (entryIdx < 0) { player.sendMessage("§8[§cNPC§8]§c NPC tidak ditemukan di registry."); return; }

  const entry = registry[entryIdx];
  const currentFeatures = entry.features || entry.menus || [];

  const form = new ModalFormData()
    .title(`§l§6 Ubah Fitur: ${entry.name || "NPC"}`);

  for (const key of ALL_FEATURE_KEYS) {
    const def = FEATURE_DEFS[key];
    form.toggle(`${def.color}${def.label}\n§r§8${def.desc}`, { defaultValue: currentFeatures.includes(key) });
  }

  const res = await form.show(player);
  if (res.canceled) return;

  const newFeatures = [];
  for (let i = 0; i < ALL_FEATURE_KEYS.length; i++) {
    if (res.formValues[i]) newFeatures.push(ALL_FEATURE_KEYS[i]);
  }

  if (newFeatures.length === 0) {
    player.sendMessage("§8[§cNPC§8]§c Minimal pilih 1 fitur.");
    return;
  }

  entry.features = newFeatures;
  delete entry.menus; // hapus legacy field
  saveRegistry(registry);

  const labels = newFeatures.map(k => FEATURE_DEFS[k]?.label || k).join(", ");
  player.sendMessage(`§8[§aNPC§8]§a Fitur ${entry.name || "NPC"} diubah:\n§7 ${labels}`);
}

// ═══════════════════════════════════════════════════════════
// REMOVE NPC — kill entity + remove from registry
// ═══════════════════════════════════════════════════════════

function _removeNearestNPC(player) {
  const nearby = player.dimension.getEntities({
    type: ENTITY_TYPE, tags: [TAG],
    location: player.location, maxDistance: 10,
  });

  if (!nearby.length) {
    player.sendMessage("§8[§cNPC§8]§c Tidak ada NPC Market dalam radius 10 blok.");
    return;
  }

  // Sort by distance, ambil terdekat
  nearby.sort((a, b) => _dist(player.location, a.location) - _dist(player.location, b.location));
  const npc = nearby[0];
  const npcLoc = npc.location;

  // Hapus TEPAT 1 entry terdekat dari registry
  const registry = getRegistry();
  let bestIdx = -1, bestDist = Infinity;
  for (let i = 0; i < registry.length; i++) {
    const e = registry[i];
    if (e.dim !== player.dimension.id) continue;
    const d = Math.abs(e.x - npcLoc.x) + Math.abs(e.z - npcLoc.z);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx >= 0) registry.splice(bestIdx, 1);
  saveRegistry(registry);

  try { npc.remove(); } catch {}

  player.sendMessage(
    `§8[§aNPC§8]§a NPC Market dihapus.\n` +
    `§f Posisi: §e${Math.floor(npcLoc.x)}, ${Math.floor(npcLoc.y)}, ${Math.floor(npcLoc.z)}\n` +
    `§f Registry: §a${registry.length}§f NPC tersisa.`
  );
}

// ═══════════════════════════════════════════════════════════
// HELP — panduan setup
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// SKIN PICKER — admin pilih skin via ActionForm
// ═══════════════════════════════════════════════════════════

async function _changeSkin(player) {
  const nearby = player.dimension.getEntities({
    type: ENTITY_TYPE, tags: [TAG],
    location: player.location, maxDistance: 10,
  });

  if (nearby.length === 0) {
    player.sendMessage("§8[§cNPC§8]§c Tidak ada NPC Market dalam radius 10 blok.");
    return;
  }

  // Sort by distance
  nearby.sort((a, b) => {
    const da = _dist(player.location, a.location);
    const db = _dist(player.location, b.location);
    return da - db;
  });

  let npc;

  if (nearby.length === 1) {
    npc = nearby[0];
  } else {
    // Multiple NPCs → pilih dulu
    const selectForm = new ActionFormData()
      .title("§l§6 Pilih NPC")
      .body(`§fAda §a${nearby.length}§f NPC dalam radius 10 blok.\n§fPilih NPC yang mau diganti skin:`);

    for (const n of nearby) {
      const dist = Math.floor(_dist(player.location, n.location));
      const si = n.getProperty("lt:skin") ?? 0;
      const skin = SKIN_NAMES[si] ?? "Unknown";
      const name = n.nameTag || "Market";
      selectForm.button(`${SKIN_COLORS[si] || "§f"}${name}\n§r§8${skin} | ${dist}m`);
    }

    const sel = await selectForm.show(player);
    if (sel.canceled) return;
    npc = nearby[sel.selection];
  }

  if (!npc?.isValid) {
    player.sendMessage("§8[§cNPC§8]§c NPC sudah tidak valid.");
    return;
  }

  // Show skin picker
  const currentSkin = npc.getProperty("lt:skin") ?? 0;

  const form = new ActionFormData()
    .title("§l§6 Ganti Skin")
    .body(
      `§fNPC: ${SKIN_COLORS[currentSkin]}${npc.nameTag || "Market"}\n` +
      `§fSkin aktif: §a${SKIN_NAMES[currentSkin] ?? "Unknown"}`
    );

  for (let i = 0; i < PICKABLE_SKINS.length; i++) {
    const si = PICKABLE_SKINS[i];
    const p = PICKABLE_LABELS[i];
    const sz = p.size ? ` §r§8(${p.size})` : "";
    const isActive = (si === currentSkin || (currentSkin === 1 && si === 2));
    const label = isActive
      ? `§a${p.name}  [AKTIF]${sz}`
      : `${p.color}${p.name}${sz}`;
    form.button(label);
  }

  const res = await form.show(player);
  if (res.canceled) return;

  const skinIdx = PICKABLE_SKINS[res.selection];
  if (skinIdx == null) return;
  npc.setProperty("lt:skin", skinIdx);

  // Auto-set default scale sesuai karakter
  if (DEFAULT_SKIN_SCALE[skinIdx]) {
    npc.setProperty("lt:npc_scale", DEFAULT_SKIN_SCALE[skinIdx]);
  }
  // Auto-set default nametag height sesuai karakter
  const newH = DEFAULT_NAMETAG_H[skinIdx] ?? 10;
  npc.setProperty("lt:nametag_h", newH);
  _applyNametag(npc, newH);

  // Update nametag ke nama karakter
  const displayName = NPC_DISPLAY_NAMES[skinIdx] || SKIN_NAMES[skinIdx];
  npc.nameTag = displayName;

  // Update registry
  const npcLoc = npc.location;
  const registry = getRegistry();
  for (const entry of registry) {
    const dx = Math.abs(entry.x - npcLoc.x);
    const dz = Math.abs(entry.z - npcLoc.z);
    if (dx < 2 && dz < 2 && entry.dim === player.dimension.id) {
      entry.skin = skinIdx;
      entry.name = displayName;
      entry.scale = DEFAULT_SKIN_SCALE[skinIdx] ?? 3;
      entry.nametagH = newH;
      break;
    }
  }
  saveRegistry(registry);

  player.playSound("random.orb", { volume: 0.5, pitch: 1.2 });
  player.sendMessage(
    `§8[§aNPC§8]§a Skin diganti ke: §f${SKIN_NAMES[skinIdx]}`
  );
}

/** Jarak 3D sederhana */
function _dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Apply nametag height — trigger lt:hN event */
function _applyNametag(entity, level) {
  try {
    if (!entity?.isValid) return;
    const h = Math.max(1, Math.min(20, level));
    entity.triggerEvent(`lt:h${h}`);
  } catch {}
}

/** Apply model size — just set property, nametag handled separately */
function _applyModelSize(entity, skinIdx) {
  try {
    if (!entity?.isValid) return;
    // Nametag height sudah dihandle oleh _applyNametag
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// SCALE PICKER — admin atur ukuran NPC
// ═══════════════════════════════════════════════════════════

async function _changeScale(player) {
  const nearby = player.dimension.getEntities({
    type: ENTITY_TYPE, tags: [TAG],
    location: player.location, maxDistance: 10,
  });

  if (nearby.length === 0) {
    player.sendMessage("§8[§cNPC§8]§c Tidak ada NPC Market dalam radius 10 blok.");
    return;
  }

  // Cari NPC terdekat
  nearby.sort((a, b) => _dist(player.location, a.location) - _dist(player.location, b.location));
  const npc = nearby[0];

  if (!npc?.isValid) {
    player.sendMessage("§8[§cNPC§8]§c NPC sudah tidak valid.");
    return;
  }

  const skinIdx = npc.getProperty("lt:skin") ?? 0;
  if (!CUSTOM_MODEL_SKINS.has(skinIdx)) {
    player.sendMessage("§8[§cNPC§8]§c Fitur ini hanya untuk NPC model 3D custom (Gugugaga dll).");
    return;
  }

  const currentScale = npc.getProperty("lt:npc_scale") ?? 3;

  const form = new ActionFormData()
    .title("§l§6 Ubah Ukuran")
    .body(
      `§fNPC: ${SKIN_COLORS[skinIdx]}${npc.nameTag || "Market"}\n` +
      `§fSkin: §a${SKIN_NAMES[skinIdx]}\n` +
      `§fUkuran aktif: §a${SCALE_LABELS[currentScale]}`
    );

  const defaultScale = DEFAULT_SKIN_SCALE[skinIdx] ?? 3;

  for (let i = 1; i <= 5; i++) {
    const isActive = i === currentScale;
    const isDefault = i === defaultScale;
    let label = SCALE_LABELS[i];
    if (isActive && isDefault) label = `§a${label}  [AKTIF] [DEFAULT]`;
    else if (isActive) label = `§a${label}  [AKTIF]`;
    else if (isDefault) label = `§e${label}  §r§8[DEFAULT]`;
    form.button(label);
  }

  const res = await form.show(player);
  if (res.canceled) return;

  const newScale = res.selection + 1; // selection 0 = scale 1
  npc.setProperty("lt:npc_scale", newScale);
  _applyModelSize(npc, skinIdx);

  // Update registry
  const npcLoc = npc.location;
  const registry = getRegistry();
  for (const entry of registry) {
    const dx = Math.abs(entry.x - npcLoc.x);
    const dz = Math.abs(entry.z - npcLoc.z);
    if (dx < 2 && dz < 2 && entry.dim === player.dimension.id) {
      entry.scale = newScale;
      break;
    }
  }
  saveRegistry(registry);

  player.playSound("random.orb", { volume: 0.5, pitch: 1.0 });
  player.sendMessage(
    `§8[§aNPC§8]§a Ukuran diubah ke: ${SCALE_LABELS[newScale]}`
  );
}

// ═══════════════════════════════════════════════════════════
// HELP — panduan setup
// ═══════════════════════════════════════════════════════════

function _showHelp(player) {
  player.sendMessage(
    `\n§6  NPC MARKET - PANDUAN SETUP\n` +
    `\n§e  1. §fPergi ke lokasi spawn market` +
    `\n§e  2. §fKetik §a/lt:npc` +
    `\n§e  3. §fPilih 'Summon NPC Baru'` +
    `\n§e  4. §fPilih menu §7(Store/Auction/Gacha)` +
    `\n§e  5. §fPilih skin karakter` +
    `\n§e  6. §fNPC langsung muncul dengan skin & ukuran default\n` +
    `\n§b  GANTI SKIN:` +
    `\n§f  Berdiri dekat NPC, ketik §b/lt:npc` +
    `\n§f  Pilih 'Ganti Skin NPC'\n` +
    `\n§6  UBAH UKURAN:` +
    `\n§f  Berdiri dekat NPC 3D, ketik §6/lt:npc` +
    `\n§f  Pilih 'Ubah Ukuran NPC'\n` +
    `\n§e  ATUR NAMETAG:` +
    `\n§f  Berdiri dekat NPC, ketik §e/lt:npc` +
    `\n§f  Pilih 'Atur Tinggi Nametag'` +
    `\n§f  Naik/turun per 0.1 blok (level 1-20)\n` +
    `\n§c  HAPUS NPC:` +
    `\n§f  Berdiri dekat NPC, ketik §c/lt:npc` +
    `\n§f  Pilih 'Hapus NPC Terdekat'\n` +
    `\n§7  NPC kebal hit, kebal dorong,` +
    `\n§7  auto-respawn, dan despawn saat Purge.` +
    `\n§7  Skin + ukuran + nametag persist setelah restart.\n`
  );
}

// ═══════════════════════════════════════════════════════════
// NAMETAG HEIGHT PICKER — atur tinggi nametag per NPC
// ═══════════════════════════════════════════════════════════

async function _changeNametagHeight(player) {
  const nearby = player.dimension.getEntities({
    type: ENTITY_TYPE, tags: [TAG],
    location: player.location, maxDistance: 10,
  });

  if (!nearby.length) {
    player.sendMessage("§8[§cNPC§8]§c Tidak ada NPC Market dalam radius 10 blok.");
    return;
  }

  nearby.sort((a, b) => _dist(player.location, a.location) - _dist(player.location, b.location));
  const npc = nearby[0];
  if (!npc?.isValid) {
    player.sendMessage("§8[§cNPC§8]§c NPC sudah tidak valid.");
    return;
  }

  let currentH = npc.getProperty("lt:nametag_h") ?? 10;
  const skinIdx = npc.getProperty("lt:skin") ?? 0;
  const defaultH = DEFAULT_NAMETAG_H[skinIdx] ?? 10;

  // Loop menu sampai player tutup
  while (true) {
    const heightBlk = (0.4 + currentH * 0.1).toFixed(1);
    const form = new ActionFormData()
      .title("§l§e Atur Nametag")
      .body(
        `§fNPC: ${SKIN_COLORS[skinIdx]}${npc.nameTag || "Market"}\n` +
        `§fSkin: §a${SKIN_NAMES[skinIdx]}\n\n` +
        `§fTinggi nametag saat ini:\n` +
        `§e  Level ${currentH}§f / 20  §7(${heightBlk} blok)\n\n` +
        `§fDefault: §7Level ${defaultH}\n` +
        `§8Level 1 = 0.5 blk, Level 10 = 1.4 blk, Level 14 = 1.8 blk, Level 20 = 2.4 blk`
      );

    // Buttons: +3, +1, -1, -3, reset, selesai
    form.button("§a  +3 §f(naik banyak)");
    form.button("§a  +1 §f(naik sedikit)");
    form.button("§c  -1 §f(turun sedikit)");
    form.button("§c  -3 §f(turun banyak)");
    form.button(`§e  Reset ke Default §7(Level ${defaultH})`);
    form.button("§8  Selesai");

    const res = await form.show(player);
    if (res.canceled || res.selection === 5) break;

    let newH = currentH;
    switch (res.selection) {
      case 0: newH = Math.min(20, currentH + 3); break;
      case 1: newH = Math.min(20, currentH + 1); break;
      case 2: newH = Math.max(1, currentH - 1); break;
      case 3: newH = Math.max(1, currentH - 3); break;
      case 4: newH = defaultH; break;
    }

    if (newH !== currentH) {
      currentH = newH;
      npc.setProperty("lt:nametag_h", currentH);
      _applyNametag(npc, currentH);

      // Update registry
      const npcLoc = npc.location;
      const registry = getRegistry();
      let bestIdx = -1, bestDist = Infinity;
      for (let i = 0; i < registry.length; i++) {
        const e = registry[i];
        if (e.dim !== player.dimension.id) continue;
        const d = Math.abs(e.x - npcLoc.x) + Math.abs(e.z - npcLoc.z);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        registry[bestIdx].nametagH = currentH;
        saveRegistry(registry);
      }

      const newBlk = (0.4 + currentH * 0.1).toFixed(1);
      player.sendMessage(`§8[§eNPC§8]§e Nametag: Level ${currentH} §7(${newBlk} blk)`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// GUGUGAGA — ikan = senang! (animation-driven + reward)
// ═══════════════════════════════════════════════════════════

function _gugugagaEatFish(player, npc, fishItem) {
  try {
    // Cek cooldown (skip untuk tag mimi)
    const now = Date.now();
    const hasMimi = player.hasTag("mimi");
    const lastFeed = _guguFeedCooldown.get(player.id) ?? 0;
    if (!hasMimi && now - lastFeed < GUGU_FEED_COOLDOWN) {
      const sisaMenit = Math.ceil((GUGU_FEED_COOLDOWN - (now - lastFeed)) / 60000);
      player.sendMessage(`§7* Gugugaga masih kenyang... tunggu §f${sisaMenit} menit§7 lagi *`);
      try { player.playSound(GUGU_SOUND_MAD, { location: npc.location, volume: 0.7, pitch: 1.0 }); } catch {}
      return;
    }

    // Ambil 1 ikan dari tangan player
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    const slot = player.selectedSlotIndex;
    if (fishItem.amount <= 1) {
      inv.setItem(slot, undefined);
    } else {
      fishItem.amount -= 1;
      inv.setItem(slot, fishItem);
    }

    // Set cooldown
    _guguFeedCooldown.set(player.id, now);

    // Anti-spam animasi
    _happyNPCs.add(npc.id);

    // Simpan nametag asli
    const originalName = npc.nameTag || "Gugugaga";
    _talkingNPCs.add(npc.id);

    // Aktifkan animasi happy
    npc.setProperty("lt:happy", true);

    // Dialog 1: makan
    npc.nameTag = "§7*nyam nyam...*";
    try { player.playSound("random.eat", { location: npc.location, volume: 0.8, pitch: 1.5 }); } catch {}

    // Dialog 2: senang (0.5 detik)
    const allSounds = [...GUGU_SOUNDS_IDLE, ...GUGU_SOUNDS_HAPPY];
    system.runTimeout(() => {
      if (!npc?.isValid) return;
      npc.nameTag = "§e§lGugugaga!!";
      const snd = allSounds[Math.floor(Math.random() * allSounds.length)];
      try { player.playSound(snd, { location: npc.location, volume: 0.8, pitch: 1.0 }); } catch {}
    }, 10);

    // Partikel hati selama happy
    let heartCount = 0;
    const heartInterval = system.runInterval(() => {
      try {
        if (!npc?.isValid || heartCount >= 5) {
          system.clearRun(heartInterval);
          return;
        }
        const loc = npc.location;
        npc.dimension.spawnParticle("minecraft:heart_particle", {
          x: loc.x + (Math.random() - 0.5) * 0.8,
          y: loc.y + 0.8 + Math.random() * 0.5,
          z: loc.z + (Math.random() - 0.5) * 0.8,
        });
        heartCount++;
      } catch {
        system.clearRun(heartInterval);
      }
    }, 15);

    // Reward setelah 2 detik
    system.runTimeout(() => {
      try {
        if (!player?.isValid) return;

        // Mood multiplier: happy=2x, neutral=1x, hungry=0.5x
        const moodMult = getMoodMultiplier(player);
        const baseBonus = 10 + Math.floor(Math.random() * 21);
        const bonus = Math.floor(baseBonus * moodMult);
        addCoin(player, bonus);
        markFed(player); // Update mood tracker

        // Speed buff 30 detik
        player.addEffect("speed", 600, { amplifier: 0, showParticles: true });

        // Pesan reward dengan mood info
        const moodLabel = moodMult >= 2 ? "§a[Happy 2x]" : moodMult >= 1 ? "§e[Normal]" : "§c[Hungry 0.5x]";
        player.sendMessage(
          `§e§lGugugaga senang! ${moodLabel} §r§f+§e${bonus} §6Koin §7(saldo: §e${fmt(getCoin(player))}§7) §f+§b Speed I §730 detik`
        );

        // Suara reward
        try { player.playSound("random.levelup", { volume: 0.5, pitch: 1.2 }); } catch {}
      } catch {}
    }, 40);

    // Selesai setelah 3 detik — matikan animasi + restore nametag
    system.runTimeout(() => {
      try {
        if (npc?.isValid) {
          npc.setProperty("lt:happy", false);
          npc.nameTag = originalName;
        }
      } catch {}
      _talkingNPCs.delete(npc?.id);
      _happyNPCs.delete(npc?.id);
      _feedingPlayers.delete(player?.id);
    }, 60);

  } catch (e) {
    console.warn("[NPC Market] Gugugaga fish error:", e);
    try { if (npc?.isValid) npc.setProperty("lt:happy", false); } catch {}
    _talkingNPCs.delete(npc?.id);
    _happyNPCs.delete(npc?.id);
    _feedingPlayers.delete(player?.id);
  }
}

// ═══════════════════════════════════════════════════════════
// ANTI-EAT — cegah player makan ikan sendiri saat dekat Gugugaga
// ═══════════════════════════════════════════════════════════

world.beforeEvents.itemUse.subscribe((ev) => {
  try {
    // Hanya cancel item ikan
    if (!FISH_ITEMS.has(ev.itemStack?.typeId)) return;

    const player = ev.source;
    if (!player?.isValid) return;

    // Case 1: player sedang dalam proses feeding → cancel makan
    if (_feedingPlayers.has(player.id)) {
      ev.cancel = true;
      return;
    }

    // Case 2: player dekat NPC Gugugaga (radius 4 blok) → cancel makan
    // Ini mencegah makan ikan saat player berdiri dekat Gugugaga
    // tapi belum benar-benar interaksi (misal baru mundur)
    const nearbyNPCs = player.dimension.getEntities({
      type: ENTITY_TYPE,
      tags: [TAG],
      location: player.location,
      maxDistance: 4,
    });
    for (const npc of nearbyNPCs) {
      if (!npc?.isValid) continue;
      const skin = npc.getProperty("lt:skin") ?? 0;
      if (skin === 4) {
        ev.cancel = true;
        return;
      }
    }
  } catch {}
});

// ═══════════════════════════════════════════════════════════
// CLEANUP — playerLeave
// ═══════════════════════════════════════════════════════════
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  _guguFeedCooldown.delete(playerId);
  _feedingPlayers.delete(playerId);
  _interactCooldown.delete(playerId);
});
