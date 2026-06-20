// ============================================================
// store/catalog.js — Katalog Item Build (Event Build Edition)
//
// Format: { id, qty, baseW, cat, label, icon }
//   id     : minecraft item id (WAJIB match Mojang authoritative list)
//   qty    : jumlah per 1 unit pembelian (stack = 64, panel = 16, dst)
//   baseW  : bobot harga relatif vs basis (1.0 = basis × 1.0 = ~57 koin saat basis default)
//   cat    : id kategori (untuk daily limit counter & UI grouping)
//   label  : nama tampilan Indonesia
//   icon   : texture path untuk button UI
//
// ICON RULES (penting — agar icon SESUAI dengan item-nya):
//   1. Prioritas: `textures/items/<item>` (dari resource_pack/textures/item_texture.json)
//      → pre-rendered 16x16, paling clean di button.
//   2. Kalau item tidak punya entry di item_texture.json (ini block murni),
//      pakai `textures/blocks/<block>` atau `<block>_top` sesuai terrain_texture.json.
//   3. HINDARI proxy icon yang beda arti (cth: bell→gold_ingot) karena user
//      akan bingung. Lebih baik pakai block texture walau render kurang sempurna —
//      minimal icon SEMANTIC MATCH dengan item.
//
// PRICING PHILOSOPHY:
//   - Blok basic (renewable, cheap) : baseW 0.15-0.40
//   - Blok build umum (craftable)   : baseW 0.45-1.00
//   - Blok dekorasi (effort)        : baseW 1.00-2.50
//   - Blok premium (rare/stack 16)  : baseW 2.50-4.00
//   - Item khusus (rare single)     : baseW 4.00-8.00
//
//   Harga aktual = Math.max(1, round(baseW × basis)) × tierMult × qty
//
// REFERENSI OFFICIAL:
//   - Item IDs  : github.com/Mojang/bedrock-samples/metadata/vanilladata_modules/mojang-items.json
//   - Icon items: github.com/Mojang/bedrock-samples/resource_pack/textures/item_texture.json
//   - Icon blok : github.com/Mojang/bedrock-samples/resource_pack/textures/terrain_texture.json
// ============================================================

export const CATEGORIES = [
  { id: "basic",   label: "Blok Dasar",     color: "§f", icon: "textures/blocks/cobblestone",
    tagline: "Fondasi & struktur bangunan",
    theme: "§fMaterial raw untuk terraform, pondasi, dan bulk build." },
  { id: "wood",    label: "Kayu",           color: "§6", icon: "textures/blocks/planks_oak",
    tagline: "Log, planks, dan stripped",
    theme: "§6Pilihan kayu lengkap untuk interior dan eksterior." },
  { id: "wool",    label: "Wool & Warna",   color: "§d", icon: "textures/blocks/wool_colored_red",
    tagline: "Wool, konkrit, terracotta",
    theme: "§dPallet warna lengkap untuk dekor dan artistic build." },
  { id: "decor",   label: "Dekorasi",       color: "§e", icon: "textures/blocks/brick",
    tagline: "Bata, quartz, copper, purpur",
    theme: "§ePremium block untuk detail arsitektur & facade." },
  { id: "glass",   label: "Kaca & Panel",   color: "§b", icon: "textures/blocks/glass",
    tagline: "Kaca bening & 16 warna",
    theme: "§bTransparan untuk jendela, skylight, dan ornamen." },
  { id: "light",   label: "Pencahayaan",    color: "§6", icon: "textures/items/glowstone_dust",
    tagline: "Obor, lentera, lamp, froglight",
    theme: "§6Sumber cahaya dari lembut sampai terang penuh." },
  { id: "nature",  label: "Tanaman & Alam", color: "§a", icon: "textures/items/seeds_wheat",
    tagline: "Daun, bunga, saplings, jamur",
    theme: "§aGreen touch untuk landscape dan taman." },
  { id: "utility", label: "Utility Build",  color: "§f", icon: "textures/items/compass_item",
    tagline: "Furniture, crafting, interaktif",
    theme: "§fBlock fungsional untuk melengkapi rumah." },
  { id: "redstone",label: "Redstone",       color: "§c", icon: "textures/items/redstone_dust",
    tagline: "Komponen otomasi & mekanisme",
    theme: "§cLogic gate, piston, rail untuk kontrap." },
];

// ── ITEM POOL ──
export const ITEMS = [
  // ════════════════════════════════════════════════════════════
  // BASIC — Blok dasar (dirt, stone, deepslate, nether, end)
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:dirt",               qty: 64, baseW: 0.18, cat: "basic", label: "Dirt ×64",               icon: "textures/blocks/dirt" },
  { id: "minecraft:coarse_dirt",        qty: 64, baseW: 0.22, cat: "basic", label: "Coarse Dirt ×64",        icon: "textures/blocks/coarse_dirt" },
  // NOTE Bedrock: ID resmi "dirt_with_roots" (bukan "rooted_dirt" seperti Java)
  { id: "minecraft:dirt_with_roots",    qty: 64, baseW: 0.28, cat: "basic", label: "Rooted Dirt ×64",        icon: "textures/blocks/dirt_with_roots" },
  { id: "minecraft:podzol",             qty: 64, baseW: 0.35, cat: "basic", label: "Podzol ×64",             icon: "textures/blocks/dirt_podzol_top" },
  { id: "minecraft:mycelium",           qty: 64, baseW: 0.40, cat: "basic", label: "Mycelium ×64",           icon: "textures/blocks/mycelium_top" },
  { id: "minecraft:grass_block",        qty: 64, baseW: 0.30, cat: "basic", label: "Grass Block ×64",        icon: "textures/blocks/grass_side_carried" },
  { id: "minecraft:cobblestone",        qty: 64, baseW: 0.22, cat: "basic", label: "Cobblestone ×64",        icon: "textures/blocks/cobblestone" },
  { id: "minecraft:mossy_cobblestone",  qty: 64, baseW: 0.40, cat: "basic", label: "Mossy Cobblestone ×64",  icon: "textures/blocks/cobblestone_mossy" },
  { id: "minecraft:stone",              qty: 64, baseW: 0.30, cat: "basic", label: "Stone ×64",              icon: "textures/blocks/stone" },
  { id: "minecraft:smooth_stone",       qty: 64, baseW: 0.45, cat: "basic", label: "Smooth Stone ×64",       icon: "textures/blocks/stone_slab_top" },
  { id: "minecraft:sand",               qty: 64, baseW: 0.28, cat: "basic", label: "Sand ×64",               icon: "textures/blocks/sand" },
  { id: "minecraft:red_sand",           qty: 64, baseW: 0.30, cat: "basic", label: "Red Sand ×64",           icon: "textures/blocks/red_sand" },
  { id: "minecraft:gravel",             qty: 64, baseW: 0.25, cat: "basic", label: "Gravel ×64",             icon: "textures/blocks/gravel" },
  { id: "minecraft:clay",               qty: 64, baseW: 0.45, cat: "basic", label: "Clay ×64",               icon: "textures/blocks/clay" },
  { id: "minecraft:deepslate",          qty: 64, baseW: 0.35, cat: "basic", label: "Deepslate ×64",          icon: "textures/blocks/deepslate/deepslate" },
  { id: "minecraft:cobbled_deepslate",  qty: 64, baseW: 0.38, cat: "basic", label: "Cobbled Deepslate ×64",  icon: "textures/blocks/deepslate/cobbled_deepslate" },
  { id: "minecraft:tuff",               qty: 64, baseW: 0.32, cat: "basic", label: "Tuff ×64",               icon: "textures/blocks/tuff" },
  { id: "minecraft:calcite",            qty: 64, baseW: 0.45, cat: "basic", label: "Calcite ×64",            icon: "textures/blocks/calcite" },
  { id: "minecraft:dripstone_block",    qty: 64, baseW: 0.55, cat: "basic", label: "Dripstone Block ×64",    icon: "textures/blocks/dripstone_block" },
  { id: "minecraft:andesite",           qty: 64, baseW: 0.28, cat: "basic", label: "Andesite ×64",           icon: "textures/blocks/stone_andesite" },
  { id: "minecraft:diorite",            qty: 64, baseW: 0.28, cat: "basic", label: "Diorite ×64",            icon: "textures/blocks/stone_diorite" },
  { id: "minecraft:granite",            qty: 64, baseW: 0.28, cat: "basic", label: "Granite ×64",            icon: "textures/blocks/stone_granite" },
  { id: "minecraft:netherrack",         qty: 64, baseW: 0.35, cat: "basic", label: "Netherrack ×64",         icon: "textures/blocks/netherrack" },
  { id: "minecraft:soul_sand",          qty: 64, baseW: 0.50, cat: "basic", label: "Soul Sand ×64",          icon: "textures/blocks/soul_sand" },
  { id: "minecraft:soul_soil",          qty: 64, baseW: 0.50, cat: "basic", label: "Soul Soil ×64",          icon: "textures/blocks/soul_soil" },
  { id: "minecraft:blackstone",         qty: 64, baseW: 0.55, cat: "basic", label: "Blackstone ×64",         icon: "textures/blocks/blackstone" },
  { id: "minecraft:basalt",             qty: 64, baseW: 0.55, cat: "basic", label: "Basalt ×64",             icon: "textures/blocks/basalt_side" },
  { id: "minecraft:smooth_basalt",      qty: 64, baseW: 0.70, cat: "basic", label: "Smooth Basalt ×64",      icon: "textures/blocks/smooth_basalt" },
  { id: "minecraft:end_stone",          qty: 64, baseW: 0.60, cat: "basic", label: "End Stone ×64",          icon: "textures/blocks/end_stone" },
  { id: "minecraft:obsidian",           qty: 16, baseW: 2.50, cat: "basic", label: "Obsidian ×16",           icon: "textures/blocks/obsidian" },
  { id: "minecraft:packed_mud",         qty: 64, baseW: 0.40, cat: "basic", label: "Packed Mud ×64",         icon: "textures/blocks/packed_mud" },

  // ── Ice variants (aquatic/frozen builds) ──
  { id: "minecraft:ice",                qty: 32, baseW: 0.50, cat: "basic", label: "Ice ×32",                icon: "textures/blocks/ice" },
  { id: "minecraft:packed_ice",         qty: 32, baseW: 0.75, cat: "basic", label: "Packed Ice ×32",         icon: "textures/blocks/ice_packed" },
  { id: "minecraft:blue_ice",           qty: 16, baseW: 1.50, cat: "basic", label: "Blue Ice ×16",           icon: "textures/blocks/blue_ice" },
  { id: "minecraft:snow",               qty: 64, baseW: 0.25, cat: "basic", label: "Snow Block ×64",         icon: "textures/blocks/snow" },
  { id: "minecraft:powder_snow",        qty: 32, baseW: 0.60, cat: "basic", label: "Powder Snow ×32",        icon: "textures/blocks/powder_snow" },

  // ════════════════════════════════════════════════════════════
  // WOOD — Log, planks, stripped (semua jenis kayu)
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:oak_log",             qty: 32, baseW: 0.45, cat: "wood", label: "Oak Log ×32",             icon: "textures/blocks/log_oak_top" },
  { id: "minecraft:spruce_log",          qty: 32, baseW: 0.45, cat: "wood", label: "Spruce Log ×32",          icon: "textures/blocks/log_spruce_top" },
  { id: "minecraft:birch_log",           qty: 32, baseW: 0.45, cat: "wood", label: "Birch Log ×32",           icon: "textures/blocks/log_birch_top" },
  { id: "minecraft:jungle_log",          qty: 32, baseW: 0.48, cat: "wood", label: "Jungle Log ×32",          icon: "textures/blocks/log_jungle_top" },
  { id: "minecraft:acacia_log",          qty: 32, baseW: 0.48, cat: "wood", label: "Acacia Log ×32",          icon: "textures/blocks/log_acacia_top" },
  { id: "minecraft:dark_oak_log",        qty: 32, baseW: 0.50, cat: "wood", label: "Dark Oak Log ×32",        icon: "textures/blocks/log_big_oak_top" },
  { id: "minecraft:mangrove_log",        qty: 32, baseW: 0.55, cat: "wood", label: "Mangrove Log ×32",        icon: "textures/blocks/mangrove_log_top" },
  { id: "minecraft:cherry_log",          qty: 32, baseW: 0.60, cat: "wood", label: "Cherry Log ×32",          icon: "textures/blocks/cherry_log_top" },
  // NOTE: atlas resmi Bedrock — crimson pakai "crimson_log_top", warped pakai "warped_stem_top".
  //       Naming historis tidak konsisten.
  { id: "minecraft:crimson_stem",        qty: 32, baseW: 0.65, cat: "wood", label: "Crimson Stem ×32",        icon: "textures/blocks/huge_fungus/crimson_log_top" },
  { id: "minecraft:warped_stem",         qty: 32, baseW: 0.65, cat: "wood", label: "Warped Stem ×32",         icon: "textures/blocks/huge_fungus/warped_stem_top" },
  // Bamboo block (pakai top face, sprite bamboo_stage0 tidak render di button)
  { id: "minecraft:bamboo_block",        qty: 32, baseW: 0.50, cat: "wood", label: "Bamboo Block ×32",        icon: "textures/blocks/bamboo_block_top" },

  { id: "minecraft:oak_planks",          qty: 64, baseW: 0.35, cat: "wood", label: "Oak Planks ×64",          icon: "textures/blocks/planks_oak" },
  { id: "minecraft:spruce_planks",       qty: 64, baseW: 0.35, cat: "wood", label: "Spruce Planks ×64",       icon: "textures/blocks/planks_spruce" },
  { id: "minecraft:birch_planks",        qty: 64, baseW: 0.35, cat: "wood", label: "Birch Planks ×64",        icon: "textures/blocks/planks_birch" },
  { id: "minecraft:jungle_planks",       qty: 64, baseW: 0.38, cat: "wood", label: "Jungle Planks ×64",       icon: "textures/blocks/planks_jungle" },
  { id: "minecraft:acacia_planks",       qty: 64, baseW: 0.38, cat: "wood", label: "Acacia Planks ×64",       icon: "textures/blocks/planks_acacia" },
  { id: "minecraft:dark_oak_planks",     qty: 64, baseW: 0.40, cat: "wood", label: "Dark Oak Planks ×64",     icon: "textures/blocks/planks_big_oak" },
  { id: "minecraft:mangrove_planks",     qty: 64, baseW: 0.45, cat: "wood", label: "Mangrove Planks ×64",     icon: "textures/blocks/mangrove_planks" },
  { id: "minecraft:cherry_planks",       qty: 64, baseW: 0.50, cat: "wood", label: "Cherry Planks ×64",       icon: "textures/blocks/cherry_planks" },
  { id: "minecraft:bamboo_planks",       qty: 64, baseW: 0.45, cat: "wood", label: "Bamboo Planks ×64",       icon: "textures/blocks/bamboo_planks" },
  { id: "minecraft:crimson_planks",      qty: 64, baseW: 0.55, cat: "wood", label: "Crimson Planks ×64",      icon: "textures/blocks/huge_fungus/crimson_planks" },
  { id: "minecraft:warped_planks",       qty: 64, baseW: 0.55, cat: "wood", label: "Warped Planks ×64",       icon: "textures/blocks/huge_fungus/warped_planks" },

  { id: "minecraft:stripped_oak_log",    qty: 32, baseW: 0.55, cat: "wood", label: "Stripped Oak Log ×32",    icon: "textures/blocks/stripped_oak_log_top" },
  { id: "minecraft:stripped_spruce_log", qty: 32, baseW: 0.55, cat: "wood", label: "Stripped Spruce Log ×32", icon: "textures/blocks/stripped_spruce_log_top" },
  { id: "minecraft:stripped_birch_log",  qty: 32, baseW: 0.55, cat: "wood", label: "Stripped Birch Log ×32",  icon: "textures/blocks/stripped_birch_log_top" },
  { id: "minecraft:stripped_dark_oak_log",qty: 32, baseW: 0.60, cat: "wood", label: "Stripped Dark Oak ×32",  icon: "textures/blocks/stripped_dark_oak_log_top" },
  { id: "minecraft:stripped_cherry_log", qty: 32, baseW: 0.70, cat: "wood", label: "Stripped Cherry ×32",     icon: "textures/blocks/stripped_cherry_log_top" },
];

// ── Tambahan item besar di file ini (split untuk menghindari baris tunggal terlalu panjang) ──
ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // WOOL — 16 warna lengkap wool, concrete, terracotta
  // NOTE: texture path "wool_colored_silver" = light_gray (historical naming)
  // NOTE: concrete powder tidak disertakan (item crafting, terlalu banyak)
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:white_wool",         qty: 64, baseW: 0.55, cat: "wool", label: "Wool Putih ×64",       icon: "textures/blocks/wool_colored_white" },
  { id: "minecraft:orange_wool",        qty: 64, baseW: 0.55, cat: "wool", label: "Wool Oranye ×64",      icon: "textures/blocks/wool_colored_orange" },
  { id: "minecraft:magenta_wool",       qty: 64, baseW: 0.55, cat: "wool", label: "Wool Magenta ×64",     icon: "textures/blocks/wool_colored_magenta" },
  { id: "minecraft:light_blue_wool",    qty: 64, baseW: 0.55, cat: "wool", label: "Wool Biru Muda ×64",   icon: "textures/blocks/wool_colored_light_blue" },
  { id: "minecraft:yellow_wool",        qty: 64, baseW: 0.55, cat: "wool", label: "Wool Kuning ×64",      icon: "textures/blocks/wool_colored_yellow" },
  { id: "minecraft:lime_wool",          qty: 64, baseW: 0.55, cat: "wool", label: "Wool Hijau Muda ×64",  icon: "textures/blocks/wool_colored_lime" },
  { id: "minecraft:pink_wool",          qty: 64, baseW: 0.55, cat: "wool", label: "Wool Pink ×64",        icon: "textures/blocks/wool_colored_pink" },
  { id: "minecraft:gray_wool",          qty: 64, baseW: 0.55, cat: "wool", label: "Wool Abu ×64",         icon: "textures/blocks/wool_colored_gray" },
  { id: "minecraft:light_gray_wool",    qty: 64, baseW: 0.55, cat: "wool", label: "Wool Abu Muda ×64",    icon: "textures/blocks/wool_colored_silver" },
  { id: "minecraft:cyan_wool",          qty: 64, baseW: 0.55, cat: "wool", label: "Wool Cyan ×64",        icon: "textures/blocks/wool_colored_cyan" },
  { id: "minecraft:purple_wool",        qty: 64, baseW: 0.55, cat: "wool", label: "Wool Ungu ×64",        icon: "textures/blocks/wool_colored_purple" },
  { id: "minecraft:blue_wool",          qty: 64, baseW: 0.55, cat: "wool", label: "Wool Biru ×64",        icon: "textures/blocks/wool_colored_blue" },
  { id: "minecraft:brown_wool",         qty: 64, baseW: 0.55, cat: "wool", label: "Wool Coklat ×64",      icon: "textures/blocks/wool_colored_brown" },
  { id: "minecraft:green_wool",         qty: 64, baseW: 0.55, cat: "wool", label: "Wool Hijau ×64",       icon: "textures/blocks/wool_colored_green" },
  { id: "minecraft:red_wool",           qty: 64, baseW: 0.55, cat: "wool", label: "Wool Merah ×64",       icon: "textures/blocks/wool_colored_red" },
  { id: "minecraft:black_wool",         qty: 64, baseW: 0.55, cat: "wool", label: "Wool Hitam ×64",       icon: "textures/blocks/wool_colored_black" },

  { id: "minecraft:white_concrete",     qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Putih ×64",    icon: "textures/blocks/concrete_white" },
  { id: "minecraft:orange_concrete",    qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Oranye ×64",   icon: "textures/blocks/concrete_orange" },
  { id: "minecraft:magenta_concrete",   qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Magenta ×64",  icon: "textures/blocks/concrete_magenta" },
  { id: "minecraft:light_blue_concrete",qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Biru Muda ×64",icon: "textures/blocks/concrete_light_blue" },
  { id: "minecraft:yellow_concrete",    qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Kuning ×64",   icon: "textures/blocks/concrete_yellow" },
  { id: "minecraft:lime_concrete",      qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Hijau Muda ×64",icon:"textures/blocks/concrete_lime" },
  { id: "minecraft:pink_concrete",      qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Pink ×64",     icon: "textures/blocks/concrete_pink" },
  { id: "minecraft:gray_concrete",      qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Abu ×64",      icon: "textures/blocks/concrete_gray" },
  { id: "minecraft:light_gray_concrete",qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Abu Muda ×64", icon: "textures/blocks/concrete_silver" },
  { id: "minecraft:cyan_concrete",      qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Cyan ×64",     icon: "textures/blocks/concrete_cyan" },
  { id: "minecraft:purple_concrete",    qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Ungu ×64",     icon: "textures/blocks/concrete_purple" },
  { id: "minecraft:blue_concrete",      qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Biru ×64",     icon: "textures/blocks/concrete_blue" },
  { id: "minecraft:brown_concrete",     qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Coklat ×64",   icon: "textures/blocks/concrete_brown" },
  { id: "minecraft:green_concrete",     qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Hijau ×64",    icon: "textures/blocks/concrete_green" },
  { id: "minecraft:red_concrete",       qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Merah ×64",    icon: "textures/blocks/concrete_red" },
  { id: "minecraft:black_concrete",     qty: 64, baseW: 0.90, cat: "wool", label: "Konkrit Hitam ×64",    icon: "textures/blocks/concrete_black" },

  { id: "minecraft:white_terracotta",   qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Putih ×64", icon: "textures/blocks/hardened_clay_stained_white" },
  { id: "minecraft:orange_terracotta",  qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Oranye ×64",icon: "textures/blocks/hardened_clay_stained_orange" },
  { id: "minecraft:yellow_terracotta",  qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Kuning ×64",icon: "textures/blocks/hardened_clay_stained_yellow" },
  { id: "minecraft:light_blue_terracotta",qty:64, baseW: 0.85, cat: "wool", label: "Terracotta Biru Muda ×64",icon:"textures/blocks/hardened_clay_stained_light_blue" },
  { id: "minecraft:cyan_terracotta",    qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Cyan ×64",  icon: "textures/blocks/hardened_clay_stained_cyan" },
  { id: "minecraft:pink_terracotta",    qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Pink ×64",  icon: "textures/blocks/hardened_clay_stained_pink" },
  { id: "minecraft:brown_terracotta",   qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Coklat ×64",icon: "textures/blocks/hardened_clay_stained_brown" },
  { id: "minecraft:green_terracotta",   qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Hijau ×64", icon: "textures/blocks/hardened_clay_stained_green" },
  { id: "minecraft:red_terracotta",     qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Merah ×64", icon: "textures/blocks/hardened_clay_stained_red" },
  { id: "minecraft:black_terracotta",   qty: 64, baseW: 0.85, cat: "wool", label: "Terracotta Hitam ×64", icon: "textures/blocks/hardened_clay_stained_black" },
  // NOTE Bedrock: ID "hardened_clay" untuk terracotta polos (bukan "terracotta" seperti Java)
  { id: "minecraft:hardened_clay",      qty: 64, baseW: 0.75, cat: "wool", label: "Terracotta Biasa ×64", icon: "textures/blocks/hardened_clay" },

  // ─── GLAZED TERRACOTTA — 16 warna dengan pattern artistik ───
  // NOTE Bedrock: icon file "glazed_terracotta_<color>".
  //       Untuk light_gray pakai "silver" (legacy naming) tapi ID tetap "light_gray_glazed_terracotta".
  //       baseW lebih tinggi dari terracotta biasa (butuh furnace + dye, pattern unik).
  { id: "minecraft:white_glazed_terracotta",     qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Putih ×32",      icon: "textures/blocks/glazed_terracotta_white" },
  { id: "minecraft:orange_glazed_terracotta",    qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Oranye ×32",     icon: "textures/blocks/glazed_terracotta_orange" },
  { id: "minecraft:magenta_glazed_terracotta",   qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Magenta ×32",    icon: "textures/blocks/glazed_terracotta_magenta" },
  { id: "minecraft:light_blue_glazed_terracotta",qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Biru Muda ×32",  icon: "textures/blocks/glazed_terracotta_light_blue" },
  { id: "minecraft:yellow_glazed_terracotta",    qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Kuning ×32",     icon: "textures/blocks/glazed_terracotta_yellow" },
  { id: "minecraft:lime_glazed_terracotta",      qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Hijau Muda ×32", icon: "textures/blocks/glazed_terracotta_lime" },
  { id: "minecraft:pink_glazed_terracotta",      qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Pink ×32",       icon: "textures/blocks/glazed_terracotta_pink" },
  { id: "minecraft:gray_glazed_terracotta",      qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Abu ×32",        icon: "textures/blocks/glazed_terracotta_gray" },
  { id: "minecraft:silver_glazed_terracotta",    qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Abu Muda ×32",   icon: "textures/blocks/glazed_terracotta_silver" },
  { id: "minecraft:cyan_glazed_terracotta",      qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Cyan ×32",       icon: "textures/blocks/glazed_terracotta_cyan" },
  { id: "minecraft:purple_glazed_terracotta",    qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Ungu ×32",       icon: "textures/blocks/glazed_terracotta_purple" },
  { id: "minecraft:blue_glazed_terracotta",      qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Biru ×32",       icon: "textures/blocks/glazed_terracotta_blue" },
  { id: "minecraft:brown_glazed_terracotta",     qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Coklat ×32",     icon: "textures/blocks/glazed_terracotta_brown" },
  { id: "minecraft:green_glazed_terracotta",     qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Hijau ×32",      icon: "textures/blocks/glazed_terracotta_green" },
  { id: "minecraft:red_glazed_terracotta",       qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Merah ×32",      icon: "textures/blocks/glazed_terracotta_red" },
  { id: "minecraft:black_glazed_terracotta",     qty: 32, baseW: 1.40, cat: "wool", label: "Glazed Hitam ×32",      icon: "textures/blocks/glazed_terracotta_black" },
);

ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // DECOR — Bata, smooth, polished, quartz, copper, purpur, prismarine
  // NOTE: "brick_block" = item id untuk blok bata (beda dari item "brick")
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:brick_block",         qty: 64, baseW: 1.20, cat: "decor", label: "Bata ×64",              icon: "textures/blocks/brick" },
  { id: "minecraft:stone_bricks",        qty: 64, baseW: 0.80, cat: "decor", label: "Stone Bricks ×64",      icon: "textures/blocks/stonebrick" },
  { id: "minecraft:mossy_stone_bricks",  qty: 64, baseW: 1.00, cat: "decor", label: "Mossy Stone Bricks ×64",icon: "textures/blocks/stonebrick_mossy" },
  { id: "minecraft:cracked_stone_bricks",qty: 64, baseW: 1.00, cat: "decor", label: "Cracked Stone Bricks ×64",icon:"textures/blocks/stonebrick_cracked" },
  { id: "minecraft:chiseled_stone_bricks",qty:64, baseW: 1.10, cat: "decor", label: "Chiseled Stone Bricks ×64",icon:"textures/blocks/stonebrick_carved" },
  { id: "minecraft:polished_deepslate",  qty: 64, baseW: 1.00, cat: "decor", label: "Polished Deepslate ×64",icon: "textures/blocks/deepslate/polished_deepslate" },
  { id: "minecraft:deepslate_bricks",    qty: 64, baseW: 1.15, cat: "decor", label: "Deepslate Bricks ×64",  icon: "textures/blocks/deepslate/deepslate_bricks" },
  { id: "minecraft:deepslate_tiles",     qty: 64, baseW: 1.20, cat: "decor", label: "Deepslate Tiles ×64",   icon: "textures/blocks/deepslate/deepslate_tiles" },
  { id: "minecraft:chiseled_deepslate",  qty: 64, baseW: 1.30, cat: "decor", label: "Chiseled Deepslate ×64",icon: "textures/blocks/deepslate/chiseled_deepslate" },
  { id: "minecraft:polished_andesite",   qty: 64, baseW: 0.85, cat: "decor", label: "Polished Andesite ×64", icon: "textures/blocks/stone_andesite_smooth" },
  { id: "minecraft:polished_diorite",    qty: 64, baseW: 0.85, cat: "decor", label: "Polished Diorite ×64",  icon: "textures/blocks/stone_diorite_smooth" },
  { id: "minecraft:polished_granite",    qty: 64, baseW: 0.85, cat: "decor", label: "Polished Granite ×64",  icon: "textures/blocks/stone_granite_smooth" },
  { id: "minecraft:polished_blackstone", qty: 64, baseW: 1.30, cat: "decor", label: "Polished Blackstone ×64",icon:"textures/blocks/polished_blackstone" },
  { id: "minecraft:polished_blackstone_bricks",qty:64,baseW:1.50,cat:"decor",label:"Polished Blackstone Bricks ×64",icon:"textures/blocks/polished_blackstone_bricks" },
  { id: "minecraft:chiseled_polished_blackstone",qty:64,baseW:1.60,cat:"decor",label:"Chiseled Blackstone ×64",icon:"textures/blocks/chiseled_polished_blackstone" },
  { id: "minecraft:gilded_blackstone",   qty: 16, baseW: 3.00, cat: "decor", label: "Gilded Blackstone ×16", icon: "textures/blocks/gilded_blackstone" },
  { id: "minecraft:polished_basalt",     qty: 64, baseW: 0.85, cat: "decor", label: "Polished Basalt ×64",   icon: "textures/blocks/polished_basalt_side" },
  // NOTE Bedrock: ID resmi "nether_brick" (singular, bukan "nether_bricks" seperti Java)
  { id: "minecraft:nether_brick",        qty: 64, baseW: 1.20, cat: "decor", label: "Nether Bricks ×64",     icon: "textures/blocks/nether_brick" },
  { id: "minecraft:red_nether_brick",    qty: 64, baseW: 1.35, cat: "decor", label: "Red Nether Bricks ×64", icon: "textures/blocks/red_nether_brick" },
  { id: "minecraft:chiseled_nether_bricks",qty:64,baseW:1.40,cat:"decor",label:"Chiseled Nether Bricks ×64",icon:"textures/blocks/chiseled_nether_bricks" },
  { id: "minecraft:end_bricks",          qty: 64, baseW: 1.50, cat: "decor", label: "End Stone Bricks ×64",  icon: "textures/blocks/end_bricks" },
  // NOTE: Prismarine block (base) TIDAK punya path "textures/blocks/prismarine" di atlas.
  //       Variants-nya animated → frame diam jelek. Pakai items shard (aman).
  { id: "minecraft:prismarine",          qty: 32, baseW: 1.80, cat: "decor", label: "Prismarine ×32",        icon: "textures/items/prismarine_shard" },
  { id: "minecraft:prismarine_bricks",   qty: 32, baseW: 2.00, cat: "decor", label: "Prismarine Bricks ×32", icon: "textures/blocks/prismarine_bricks" },
  { id: "minecraft:dark_prismarine",     qty: 32, baseW: 2.00, cat: "decor", label: "Dark Prismarine ×32",   icon: "textures/blocks/prismarine_dark" },
  { id: "minecraft:quartz_block",        qty: 32, baseW: 1.60, cat: "decor", label: "Quartz Block ×32",      icon: "textures/blocks/quartz_block_side" },
  { id: "minecraft:smooth_quartz",       qty: 32, baseW: 1.75, cat: "decor", label: "Smooth Quartz ×32",     icon: "textures/blocks/quartz_block_bottom" },
  { id: "minecraft:chiseled_quartz_block",qty:32, baseW: 1.80, cat: "decor", label: "Chiseled Quartz ×32",   icon: "textures/blocks/quartz_block_chiseled" },
  { id: "minecraft:quartz_pillar",       qty: 32, baseW: 1.80, cat: "decor", label: "Quartz Pillar ×32",     icon: "textures/blocks/quartz_block_lines" },
  { id: "minecraft:quartz_bricks",       qty: 32, baseW: 1.85, cat: "decor", label: "Quartz Bricks ×32",     icon: "textures/blocks/quartz_bricks" },
  { id: "minecraft:purpur_block",        qty: 32, baseW: 2.20, cat: "decor", label: "Purpur Block ×32",      icon: "textures/blocks/purpur_block" },
  { id: "minecraft:purpur_pillar",       qty: 32, baseW: 2.30, cat: "decor", label: "Purpur Pillar ×32",     icon: "textures/blocks/purpur_pillar" },
  { id: "minecraft:copper_block",        qty: 16, baseW: 2.50, cat: "decor", label: "Copper Block ×16",      icon: "textures/blocks/copper_block" },
  { id: "minecraft:cut_copper",          qty: 16, baseW: 2.60, cat: "decor", label: "Cut Copper ×16",        icon: "textures/blocks/cut_copper" },
  { id: "minecraft:exposed_copper",      qty: 16, baseW: 2.70, cat: "decor", label: "Exposed Copper ×16",    icon: "textures/blocks/exposed_copper" },
  { id: "minecraft:weathered_copper",    qty: 16, baseW: 2.80, cat: "decor", label: "Weathered Copper ×16",  icon: "textures/blocks/weathered_copper" },
  { id: "minecraft:oxidized_copper",     qty: 16, baseW: 3.00, cat: "decor", label: "Oxidized Copper ×16",   icon: "textures/blocks/oxidized_copper" },
  { id: "minecraft:mud_bricks",          qty: 64, baseW: 1.10, cat: "decor", label: "Mud Bricks ×64",        icon: "textures/blocks/mud_bricks" },
  { id: "minecraft:honeycomb_block",     qty: 32, baseW: 2.20, cat: "decor", label: "Honeycomb Block ×32",   icon: "textures/blocks/honeycomb" },
  // NOTE: Bedrock sandstone pakai "sandstone_normal", "sandstone_carved", "sandstone_smooth"
  //       (bukan "sandstone_side" atau "sandstone_cut" yang tidak ada di atlas).
  { id: "minecraft:sandstone",           qty: 64, baseW: 0.50, cat: "decor", label: "Sandstone ×64",         icon: "textures/blocks/sandstone_normal" },
  { id: "minecraft:cut_sandstone",       qty: 64, baseW: 0.60, cat: "decor", label: "Cut Sandstone ×64",     icon: "textures/blocks/sandstone_top" },
  { id: "minecraft:smooth_sandstone",    qty: 64, baseW: 0.65, cat: "decor", label: "Smooth Sandstone ×64",  icon: "textures/blocks/sandstone_smooth" },
  { id: "minecraft:chiseled_sandstone",  qty: 64, baseW: 0.70, cat: "decor", label: "Chiseled Sandstone ×64",icon: "textures/blocks/sandstone_carved" },
  { id: "minecraft:red_sandstone",       qty: 64, baseW: 0.55, cat: "decor", label: "Red Sandstone ×64",     icon: "textures/blocks/red_sandstone_normal" },
  { id: "minecraft:cut_red_sandstone",   qty: 64, baseW: 0.65, cat: "decor", label: "Cut Red Sandstone ×64", icon: "textures/blocks/red_sandstone_top" },
  { id: "minecraft:smooth_red_sandstone",qty: 64, baseW: 0.70, cat: "decor", label: "Smooth Red Sandstone ×64",icon:"textures/blocks/red_sandstone_smooth" },
  { id: "minecraft:chiseled_red_sandstone",qty:64, baseW: 0.75, cat: "decor", label: "Chiseled Red Sandstone ×64",icon:"textures/blocks/red_sandstone_carved" },
);

ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // GLASS — Kaca normal + stained 16 warna
  // NOTE: untuk pane pakai icon yang sama (block glass), karena "glass_pane_top"
  //       adalah sprite edge tipis yang nyaris invisible di button.
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:glass",                   qty: 64, baseW: 0.40, cat: "glass", label: "Kaca Bening ×64",      icon: "textures/blocks/glass" },
  { id: "minecraft:glass_pane",              qty: 64, baseW: 0.35, cat: "glass", label: "Panel Kaca Bening ×64",icon: "textures/blocks/glass" },
  { id: "minecraft:tinted_glass",            qty: 32, baseW: 1.50, cat: "glass", label: "Tinted Glass ×32",     icon: "textures/blocks/tinted_glass" },
  { id: "minecraft:white_stained_glass",     qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Putih ×64",       icon: "textures/blocks/glass_white" },
  { id: "minecraft:orange_stained_glass",    qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Oranye ×64",      icon: "textures/blocks/glass_orange" },
  { id: "minecraft:magenta_stained_glass",   qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Magenta ×64",     icon: "textures/blocks/glass_magenta" },
  { id: "minecraft:light_blue_stained_glass",qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Biru Muda ×64",   icon: "textures/blocks/glass_light_blue" },
  { id: "minecraft:yellow_stained_glass",    qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Kuning ×64",      icon: "textures/blocks/glass_yellow" },
  { id: "minecraft:lime_stained_glass",      qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Hijau Muda ×64",  icon: "textures/blocks/glass_lime" },
  { id: "minecraft:pink_stained_glass",      qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Pink ×64",        icon: "textures/blocks/glass_pink" },
  { id: "minecraft:gray_stained_glass",      qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Abu ×64",         icon: "textures/blocks/glass_gray" },
  { id: "minecraft:light_gray_stained_glass",qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Abu Muda ×64",    icon: "textures/blocks/glass_silver" },
  { id: "minecraft:cyan_stained_glass",      qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Cyan ×64",        icon: "textures/blocks/glass_cyan" },
  { id: "minecraft:purple_stained_glass",    qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Ungu ×64",        icon: "textures/blocks/glass_purple" },
  { id: "minecraft:blue_stained_glass",      qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Biru ×64",        icon: "textures/blocks/glass_blue" },
  { id: "minecraft:brown_stained_glass",     qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Coklat ×64",      icon: "textures/blocks/glass_brown" },
  { id: "minecraft:green_stained_glass",     qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Hijau ×64",       icon: "textures/blocks/glass_green" },
  { id: "minecraft:red_stained_glass",       qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Merah ×64",       icon: "textures/blocks/glass_red" },
  { id: "minecraft:black_stained_glass",     qty: 64, baseW: 0.55, cat: "glass", label: "Kaca Hitam ×64",       icon: "textures/blocks/glass_black" },
);

ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // LIGHT — Icon akurat sesuai item (verified di atlas)
  //   - torch      : blocks/torch_on (block texture vertikal, tapi MATCH item)
  //   - lantern    : items/lantern (pre-rendered, dari lantern_carried)
  //   - soul_lantern: items/soul_lantern (pre-rendered)
  //   - glowstone  : blocks/glowstone (tile jelas)
  //   - sea_lantern: blocks/sea_lantern (animated, tetap dipakai karena semantic)
  //   - end_rod    : blocks/end_rod (vertikal tipis, tapi MATCH item)
  //   - shroomlight: blocks/shroomlight
  //   - redstone_lamp: blocks/redstone_lamp_off
  //   - amethyst_cluster: blocks/amethyst_cluster (cluster sprite, tetap match)
  //   - candle     : items/candle (tidak ada di atlas — candle pakai BER render)
  //                  → fallback ke blocks/candle
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:torch",             qty: 64, baseW: 0.30, cat: "light", label: "Obor ×64",             icon: "textures/blocks/torch_on" },
  { id: "minecraft:soul_torch",        qty: 64, baseW: 0.45, cat: "light", label: "Soul Torch ×64",       icon: "textures/blocks/soul_torch" },
  { id: "minecraft:redstone_torch",    qty: 64, baseW: 0.40, cat: "light", label: "Redstone Torch ×64",   icon: "textures/blocks/redstone_torch_on" },
  { id: "minecraft:lantern",           qty: 16, baseW: 1.20, cat: "light", label: "Lentera ×16",          icon: "textures/items/lantern" },
  { id: "minecraft:soul_lantern",      qty: 16, baseW: 1.50, cat: "light", label: "Lentera Jiwa ×16",     icon: "textures/items/soul_lantern" },
  { id: "minecraft:glowstone",         qty: 16, baseW: 1.80, cat: "light", label: "Glowstone ×16",        icon: "textures/blocks/glowstone" },
  // NOTE: sea_lantern & end_rod di atlas hanya block texture (animated/vertikal → jelek di button).
  //       Tidak ada items/* untuk keduanya → pakai proxy semantic yang jelas.
  { id: "minecraft:sea_lantern",       qty: 16, baseW: 2.00, cat: "light", label: "Sea Lantern ×16",     icon: "textures/items/prismarine_crystals" },
  { id: "minecraft:end_rod",           qty: 16, baseW: 2.50, cat: "light", label: "End Rod ×16",          icon: "textures/items/blaze_rod" },
  { id: "minecraft:redstone_lamp",     qty: 16, baseW: 2.20, cat: "light", label: "Redstone Lamp ×16",    icon: "textures/blocks/redstone_lamp_off" },
  { id: "minecraft:shroomlight",       qty: 16, baseW: 2.80, cat: "light", label: "Shroomlight ×16",      icon: "textures/blocks/shroomlight" },
  { id: "minecraft:amethyst_cluster",  qty: 8,  baseW: 3.20, cat: "light", label: "Amethyst Cluster ×8",  icon: "textures/blocks/amethyst_cluster" },
  { id: "minecraft:ochre_froglight",   qty: 8,  baseW: 4.50, cat: "light", label: "Ochre Froglight ×8",   icon: "textures/blocks/ochre_froglight_side" },
  { id: "minecraft:verdant_froglight", qty: 8,  baseW: 4.50, cat: "light", label: "Verdant Froglight ×8", icon: "textures/blocks/verdant_froglight_side" },
  { id: "minecraft:pearlescent_froglight",qty:8, baseW: 4.50, cat: "light", label: "Pearlescent Froglight ×8",icon:"textures/blocks/pearlescent_froglight_side" },
  // NOTE: candle atlas pakai folder "candles/" — path items candle via "candle_carried".
  { id: "minecraft:candle",            qty: 16, baseW: 1.10, cat: "light", label: "Candle ×16",           icon: "textures/items/candles/candle" },
  // NOTE Bedrock: ID resmi "lit_pumpkin" (bukan "jack_o_lantern" seperti Java)
  { id: "minecraft:lit_pumpkin",       qty: 16, baseW: 1.60, cat: "light", label: "Jack o'Lantern ×16",   icon: "textures/blocks/pumpkin_face_on" },
);

ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // NATURE — Leaves, flowers, saplings, crops, mushrooms
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:oak_leaves",        qty: 64, baseW: 0.30, cat: "nature", label: "Daun Oak ×64",         icon: "textures/blocks/leaves_oak" },
  { id: "minecraft:spruce_leaves",     qty: 64, baseW: 0.30, cat: "nature", label: "Daun Spruce ×64",      icon: "textures/blocks/leaves_spruce" },
  { id: "minecraft:birch_leaves",      qty: 64, baseW: 0.30, cat: "nature", label: "Daun Birch ×64",       icon: "textures/blocks/leaves_birch" },
  { id: "minecraft:jungle_leaves",     qty: 64, baseW: 0.32, cat: "nature", label: "Daun Jungle ×64",      icon: "textures/blocks/leaves_jungle" },
  { id: "minecraft:acacia_leaves",     qty: 64, baseW: 0.32, cat: "nature", label: "Daun Acacia ×64",      icon: "textures/blocks/leaves_acacia" },
  { id: "minecraft:dark_oak_leaves",   qty: 64, baseW: 0.35, cat: "nature", label: "Daun Dark Oak ×64",    icon: "textures/blocks/leaves_big_oak" },
  { id: "minecraft:mangrove_leaves",   qty: 64, baseW: 0.38, cat: "nature", label: "Daun Mangrove ×64",    icon: "textures/blocks/mangrove_leaves" },
  { id: "minecraft:cherry_leaves",     qty: 64, baseW: 0.45, cat: "nature", label: "Daun Cherry ×64",      icon: "textures/blocks/cherry_leaves" },
  // NOTE: atlas path resmi "azalea_leaves_flowers" (plural!), bukan "flowering_azalea_leaves_top"
  { id: "minecraft:azalea_leaves_flowered",qty:64,baseW:0.50,cat:"nature", label:"Daun Azalea Bunga ×64", icon: "textures/blocks/azalea_leaves_flowers" },
  { id: "minecraft:azalea_leaves",     qty: 64, baseW: 0.40, cat: "nature", label: "Daun Azalea ×64",      icon: "textures/blocks/azalea_leaves" },

  { id: "minecraft:moss_block",        qty: 32, baseW: 0.80, cat: "nature", label: "Moss Block ×32",       icon: "textures/blocks/moss_block" },
  { id: "minecraft:moss_carpet",       qty: 32, baseW: 0.70, cat: "nature", label: "Moss Carpet ×32",      icon: "textures/blocks/moss_block" },
  { id: "minecraft:vine",              qty: 32, baseW: 0.50, cat: "nature", label: "Vine ×32",             icon: "textures/blocks/vine" },
  { id: "minecraft:glow_lichen",       qty: 16, baseW: 1.20, cat: "nature", label: "Glow Lichen ×16",      icon: "textures/blocks/glow_lichen" },
  { id: "minecraft:big_dripleaf",      qty: 16, baseW: 1.00, cat: "nature", label: "Big Dripleaf ×16",     icon: "textures/blocks/big_dripleaf_top" },
  { id: "minecraft:small_dripleaf_block",qty:16, baseW: 1.00, cat: "nature", label: "Small Dripleaf ×16",  icon: "textures/blocks/small_dripleaf_top" },
  { id: "minecraft:spore_blossom",     qty: 8,  baseW: 2.50, cat: "nature", label: "Spore Blossom ×8",     icon: "textures/blocks/spore_blossom" },

  // NOTE Bedrock: grass block baru → "short_grass" (sebelumnya "grass", renamed 1.21+)
  { id: "minecraft:short_grass",       qty: 32, baseW: 0.30, cat: "nature", label: "Grass ×32",            icon: "textures/blocks/tallgrass" },
  { id: "minecraft:tall_grass",        qty: 32, baseW: 0.40, cat: "nature", label: "Tall Grass ×32",       icon: "textures/blocks/double_plant_grass_top" },
  { id: "minecraft:fern",              qty: 32, baseW: 0.30, cat: "nature", label: "Fern ×32",             icon: "textures/blocks/fern" },
  { id: "minecraft:large_fern",        qty: 32, baseW: 0.40, cat: "nature", label: "Large Fern ×32",       icon: "textures/blocks/double_plant_fern_top" },
  // NOTE Bedrock: ID resmi "deadbush" (satu kata, bukan "dead_bush" seperti Java)
  { id: "minecraft:deadbush",          qty: 32, baseW: 0.30, cat: "nature", label: "Dead Bush ×32",        icon: "textures/blocks/deadbush" },
  { id: "minecraft:sugar_cane",        qty: 16, baseW: 0.70, cat: "nature", label: "Tebu (Reeds) ×16",     icon: "textures/items/reeds" },
  // NOTE: item bamboo (tanaman) di atlas = sprite stage0 yang terlalu tipis untuk button.
  //       Pakai texture bamboo_block_top yang lebih jelas.
  { id: "minecraft:bamboo",            qty: 16, baseW: 0.50, cat: "nature", label: "Bamboo ×16",           icon: "textures/blocks/bamboo_block_top" },
  { id: "minecraft:cactus",            qty: 16, baseW: 0.80, cat: "nature", label: "Kaktus ×16",           icon: "textures/blocks/cactus_side" },
  { id: "minecraft:pumpkin",           qty: 16, baseW: 1.20, cat: "nature", label: "Labu ×16",             icon: "textures/blocks/pumpkin_side" },
  { id: "minecraft:carved_pumpkin",    qty: 16, baseW: 1.40, cat: "nature", label: "Carved Pumpkin ×16",   icon: "textures/blocks/pumpkin_face_off" },
  { id: "minecraft:melon_block",       qty: 16, baseW: 1.20, cat: "nature", label: "Melon Block ×16",      icon: "textures/blocks/melon_side" },
  { id: "minecraft:hay_block",         qty: 16, baseW: 0.70, cat: "nature", label: "Jerami ×16",           icon: "textures/blocks/hay_block_top" },

  { id: "minecraft:oak_sapling",       qty: 16, baseW: 0.40, cat: "nature", label: "Bibit Oak ×16",        icon: "textures/blocks/sapling_oak" },
  { id: "minecraft:spruce_sapling",    qty: 16, baseW: 0.40, cat: "nature", label: "Bibit Spruce ×16",     icon: "textures/blocks/sapling_spruce" },
  { id: "minecraft:birch_sapling",     qty: 16, baseW: 0.40, cat: "nature", label: "Bibit Birch ×16",      icon: "textures/blocks/sapling_birch" },
  { id: "minecraft:jungle_sapling",    qty: 16, baseW: 0.45, cat: "nature", label: "Bibit Jungle ×16",     icon: "textures/blocks/sapling_jungle" },
  { id: "minecraft:acacia_sapling",    qty: 16, baseW: 0.45, cat: "nature", label: "Bibit Acacia ×16",     icon: "textures/blocks/sapling_acacia" },
  { id: "minecraft:dark_oak_sapling",  qty: 16, baseW: 0.50, cat: "nature", label: "Bibit Dark Oak ×16",   icon: "textures/blocks/sapling_roofed_oak" },
  { id: "minecraft:cherry_sapling",    qty: 16, baseW: 0.80, cat: "nature", label: "Bibit Cherry ×16",     icon: "textures/blocks/cherry_sapling" },
  { id: "minecraft:mangrove_propagule",qty: 16, baseW: 0.70, cat: "nature", label: "Mangrove Propagule ×16",icon: "textures/blocks/mangrove_propagule" },

  // Bunga — pakai texture block langsung, sprite sudah transparent-ready
  { id: "minecraft:dandelion",         qty: 32, baseW: 0.30, cat: "nature", label: "Dandelion ×32",        icon: "textures/blocks/flower_dandelion" },
  { id: "minecraft:poppy",             qty: 32, baseW: 0.30, cat: "nature", label: "Poppy ×32",            icon: "textures/blocks/flower_rose" },
  { id: "minecraft:blue_orchid",       qty: 32, baseW: 0.35, cat: "nature", label: "Blue Orchid ×32",      icon: "textures/blocks/flower_blue_orchid" },
  { id: "minecraft:allium",            qty: 32, baseW: 0.35, cat: "nature", label: "Allium ×32",           icon: "textures/blocks/flower_allium" },
  { id: "minecraft:azure_bluet",       qty: 32, baseW: 0.35, cat: "nature", label: "Azure Bluet ×32",      icon: "textures/blocks/flower_houstonia" },
  { id: "minecraft:red_tulip",         qty: 32, baseW: 0.35, cat: "nature", label: "Red Tulip ×32",        icon: "textures/blocks/flower_tulip_red" },
  { id: "minecraft:orange_tulip",      qty: 32, baseW: 0.35, cat: "nature", label: "Orange Tulip ×32",     icon: "textures/blocks/flower_tulip_orange" },
  { id: "minecraft:white_tulip",       qty: 32, baseW: 0.35, cat: "nature", label: "White Tulip ×32",      icon: "textures/blocks/flower_tulip_white" },
  { id: "minecraft:pink_tulip",        qty: 32, baseW: 0.35, cat: "nature", label: "Pink Tulip ×32",       icon: "textures/blocks/flower_tulip_pink" },
  { id: "minecraft:oxeye_daisy",       qty: 32, baseW: 0.35, cat: "nature", label: "Oxeye Daisy ×32",      icon: "textures/blocks/flower_oxeye_daisy" },
  { id: "minecraft:cornflower",        qty: 32, baseW: 0.40, cat: "nature", label: "Cornflower ×32",       icon: "textures/blocks/flower_cornflower" },
  { id: "minecraft:lily_of_the_valley",qty: 32, baseW: 0.40, cat: "nature", label: "Lily of the Valley ×32",icon:"textures/blocks/flower_lily_of_the_valley" },
  { id: "minecraft:sunflower",         qty: 16, baseW: 0.55, cat: "nature", label: "Sunflower ×16",        icon: "textures/blocks/double_plant_sunflower_front" },
  { id: "minecraft:lilac",             qty: 16, baseW: 0.50, cat: "nature", label: "Lilac ×16",            icon: "textures/blocks/double_plant_syringa_top" },
  { id: "minecraft:rose_bush",         qty: 16, baseW: 0.50, cat: "nature", label: "Rose Bush ×16",        icon: "textures/blocks/double_plant_rose_top" },
  { id: "minecraft:peony",             qty: 16, baseW: 0.50, cat: "nature", label: "Peony ×16",            icon: "textures/blocks/double_plant_paeonia_top" },
  { id: "minecraft:pink_petals",       qty: 16, baseW: 0.60, cat: "nature", label: "Pink Petals ×16",      icon: "textures/blocks/pink_petals" },
  { id: "minecraft:torchflower",       qty: 16, baseW: 0.70, cat: "nature", label: "Torchflower ×16",      icon: "textures/blocks/torchflower" },
  { id: "minecraft:wither_rose",       qty: 8,  baseW: 1.50, cat: "nature", label: "Wither Rose ×8",       icon: "textures/blocks/flower_wither_rose" },

  // ── Aquatic plants ──
  { id: "minecraft:waterlily",         qty: 16, baseW: 0.80, cat: "nature", label: "Lily Pad ×16",         icon: "textures/blocks/carried_waterlily" },
  { id: "minecraft:seagrass",          qty: 32, baseW: 0.50, cat: "nature", label: "Seagrass ×32",         icon: "textures/blocks/seagrass_carried" },
  { id: "minecraft:kelp",              qty: 32, baseW: 0.45, cat: "nature", label: "Kelp ×32",             icon: "textures/items/kelp" },
  { id: "minecraft:sea_pickle",        qty: 16, baseW: 0.90, cat: "nature", label: "Sea Pickle ×16",       icon: "textures/items/sea_pickle" },

  // Glow Berries — drop dari cave vines, sumber cahaya alami (level 14) saat dipasang
  // NOTE Bedrock atlas: "textures/items/glow_berries" (item sprite resmi).
  { id: "minecraft:glow_berries",      qty: 16, baseW: 0.85, cat: "nature", label: "Glow Berries ×16",     icon: "textures/items/glow_berries" },
  // Sweet Berries — bonus item buah edible, tumbuh dari sweet_berry_bush
  { id: "minecraft:sweet_berries",     qty: 16, baseW: 0.70, cat: "nature", label: "Sweet Berries ×16",    icon: "textures/items/sweet_berries" },

  { id: "minecraft:brown_mushroom",    qty: 16, baseW: 0.40, cat: "nature", label: "Brown Mushroom ×16",   icon: "textures/blocks/mushroom_brown" },
  { id: "minecraft:red_mushroom",      qty: 16, baseW: 0.40, cat: "nature", label: "Red Mushroom ×16",     icon: "textures/blocks/mushroom_red" },
  { id: "minecraft:brown_mushroom_block",qty:32, baseW: 0.65, cat: "nature", label: "Huge Brown Mushroom ×32",icon:"textures/blocks/mushroom_block_skin_brown" },
  { id: "minecraft:red_mushroom_block",qty: 32, baseW: 0.65, cat: "nature", label: "Huge Red Mushroom ×32",icon: "textures/blocks/mushroom_block_skin_red" },
  { id: "minecraft:crimson_fungus",    qty: 16, baseW: 0.55, cat: "nature", label: "Crimson Fungus ×16",   icon: "textures/blocks/crimson_fungus" },
  { id: "minecraft:warped_fungus",     qty: 16, baseW: 0.55, cat: "nature", label: "Warped Fungus ×16",    icon: "textures/blocks/warped_fungus" },

  // Seeds
  { id: "minecraft:wheat_seeds",       qty: 32, baseW: 0.30, cat: "nature", label: "Bibit Gandum ×32",     icon: "textures/items/seeds_wheat" },
  { id: "minecraft:pumpkin_seeds",     qty: 32, baseW: 0.40, cat: "nature", label: "Bibit Labu ×32",       icon: "textures/items/seeds_pumpkin" },
  { id: "minecraft:melon_seeds",       qty: 32, baseW: 0.40, cat: "nature", label: "Bibit Melon ×32",      icon: "textures/items/seeds_melon" },
  { id: "minecraft:beetroot_seeds",    qty: 32, baseW: 0.35, cat: "nature", label: "Bibit Beetroot ×32",   icon: "textures/items/seeds_beetroot" },
);

ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // UTILITY BUILD — Crafting blocks, furniture, functional blocks
  //   Icon dipakai dari items/* kalau ada entry, atau blocks/* kalau block murni.
  //   Bell entity model → tetap dipakai blocks/bell_stone karena user tahu
  //   itu bell block (lebih baik daripada proxy gold_ingot yang misleading).
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:crafting_table",   qty: 8,  baseW: 0.50, cat: "utility", label: "Crafting Table ×8",    icon: "textures/blocks/crafting_table_top" },
  { id: "minecraft:furnace",          qty: 8,  baseW: 0.60, cat: "utility", label: "Furnace ×8",           icon: "textures/blocks/furnace_front_off" },
  { id: "minecraft:blast_furnace",    qty: 4,  baseW: 1.20, cat: "utility", label: "Blast Furnace ×4",     icon: "textures/blocks/blast_furnace_front_off" },
  { id: "minecraft:smoker",           qty: 4,  baseW: 1.20, cat: "utility", label: "Smoker ×4",            icon: "textures/blocks/smoker_front_off" },
  { id: "minecraft:cartography_table",qty: 4,  baseW: 1.00, cat: "utility", label: "Cartography Table ×4", icon: "textures/blocks/cartography_table_top" },
  // NOTE: atlas file-nya "fletcher_table_top" (bukan "fletching_table_top" — historical name)
  { id: "minecraft:fletching_table",  qty: 4,  baseW: 0.90, cat: "utility", label: "Fletching Table ×4",   icon: "textures/blocks/fletcher_table_top" },
  { id: "minecraft:smithing_table",   qty: 4,  baseW: 1.10, cat: "utility", label: "Smithing Table ×4",    icon: "textures/blocks/smithing_table_top" },
  { id: "minecraft:loom",             qty: 4,  baseW: 1.00, cat: "utility", label: "Loom ×4",              icon: "textures/blocks/loom_top" },
  { id: "minecraft:stonecutter_block",qty: 4,  baseW: 1.00, cat: "utility", label: "Stonecutter ×4",       icon: "textures/blocks/stonecutter2_top" },
  { id: "minecraft:grindstone",       qty: 4,  baseW: 1.00, cat: "utility", label: "Grindstone ×4",        icon: "textures/blocks/grindstone_side" },
  { id: "minecraft:barrel",           qty: 8,  baseW: 1.00, cat: "utility", label: "Barrel ×8",            icon: "textures/blocks/barrel_top" },
  { id: "minecraft:chest",            qty: 16, baseW: 0.55, cat: "utility", label: "Chest ×16",            icon: "textures/blocks/planks_oak" },
  { id: "minecraft:ender_chest",      qty: 4,  baseW: 3.00, cat: "utility", label: "Ender Chest ×4",       icon: "textures/blocks/obsidian" },
  { id: "minecraft:bookshelf",        qty: 8,  baseW: 1.80, cat: "utility", label: "Bookshelf ×8",         icon: "textures/blocks/bookshelf" },
  { id: "minecraft:chiseled_bookshelf",qty: 4, baseW: 2.00, cat: "utility", label: "Chiseled Bookshelf ×4",icon: "textures/blocks/chiseled_bookshelf_top" },
  { id: "minecraft:composter",        qty: 4,  baseW: 0.85, cat: "utility", label: "Composter ×4",         icon: "textures/blocks/composter_top" },
  { id: "minecraft:beehive",          qty: 4,  baseW: 2.50, cat: "utility", label: "Beehive ×4",           icon: "textures/blocks/beehive_front" },
  { id: "minecraft:flower_pot",       qty: 16, baseW: 0.60, cat: "utility", label: "Flower Pot ×16",       icon: "textures/items/flower_pot" },

  { id: "minecraft:scaffolding",      qty: 32, baseW: 0.65, cat: "utility", label: "Scaffolding ×32",      icon: "textures/blocks/scaffolding_top" },
  { id: "minecraft:ladder",           qty: 32, baseW: 0.50, cat: "utility", label: "Ladder ×32",           icon: "textures/blocks/ladder" },
  { id: "minecraft:iron_bars",        qty: 32, baseW: 1.10, cat: "utility", label: "Iron Bars ×32",        icon: "textures/blocks/iron_bars" },
  // NOTE Bedrock: ID resmi "iron_chain" (bukan "chain" seperti Java). Atlas items/chain = item icon.
  { id: "minecraft:iron_chain",       qty: 32, baseW: 1.40, cat: "utility", label: "Chain ×32",            icon: "textures/items/chain" },

  // NOTE Bedrock: ID resmi "frame" & "glow_frame" (tanpa prefix "item_" seperti Java).
  { id: "minecraft:frame",            qty: 16, baseW: 0.80, cat: "utility", label: "Item Frame ×16",       icon: "textures/items/item_frame" },
  { id: "minecraft:glow_frame",       qty: 16, baseW: 1.50, cat: "utility", label: "Glow Item Frame ×16",  icon: "textures/items/glow_item_frame" },
  { id: "minecraft:armor_stand",      qty: 8,  baseW: 1.60, cat: "utility", label: "Armor Stand ×8",       icon: "textures/items/armor_stand" },
  { id: "minecraft:painting",         qty: 8,  baseW: 1.00, cat: "utility", label: "Lukisan ×8",           icon: "textures/items/painting" },
  // NOTE: atlas punya entry "bell_carried" → "textures/items/villagebell" (item icon yang benar).
  //       "bell_stone" itu alias texture, bukan representasi bell.
  { id: "minecraft:bell",             qty: 2,  baseW: 3.50, cat: "utility", label: "Bell ×2",              icon: "textures/items/villagebell" },

  // NOTE Bedrock: BED hanya 1 item ID "minecraft:bed" (warna via data value, bukan per-ID seperti Java).
  // Semua warna ber-ID sama; pilih icon putih sebagai representasi umum.
  { id: "minecraft:bed",              qty: 4,  baseW: 1.20, cat: "utility", label: "Kasur ×4",             icon: "textures/items/bed_red" },

  // Carpet — 16 warna (texture atlas pakai nama "wool_colored_*" juga karena reuse)
  { id: "minecraft:white_carpet",     qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Putih ×64",     icon: "textures/blocks/wool_colored_white" },
  { id: "minecraft:red_carpet",       qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Merah ×64",     icon: "textures/blocks/wool_colored_red" },
  { id: "minecraft:blue_carpet",      qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Biru ×64",      icon: "textures/blocks/wool_colored_blue" },
  { id: "minecraft:yellow_carpet",    qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Kuning ×64",    icon: "textures/blocks/wool_colored_yellow" },
  { id: "minecraft:green_carpet",     qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Hijau ×64",     icon: "textures/blocks/wool_colored_green" },
  { id: "minecraft:black_carpet",     qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Hitam ×64",     icon: "textures/blocks/wool_colored_black" },
  { id: "minecraft:gray_carpet",      qty: 64, baseW: 0.35, cat: "utility", label: "Karpet Abu ×64",       icon: "textures/blocks/wool_colored_gray" },

  // Signs (per jenis kayu) — ID Bedrock resmi (oak_sign, spruce_sign, dst)
  { id: "minecraft:oak_sign",         qty: 16, baseW: 0.50, cat: "utility", label: "Oak Sign ×16",         icon: "textures/items/sign" },
  { id: "minecraft:spruce_sign",      qty: 16, baseW: 0.50, cat: "utility", label: "Spruce Sign ×16",      icon: "textures/items/sign_spruce" },
  { id: "minecraft:birch_sign",       qty: 16, baseW: 0.50, cat: "utility", label: "Birch Sign ×16",       icon: "textures/items/sign_birch" },
  { id: "minecraft:dark_oak_sign",    qty: 16, baseW: 0.55, cat: "utility", label: "Dark Oak Sign ×16",    icon: "textures/items/sign_darkoak" },

  // Doors — "wooden_door" = oak, yang lain pakai prefix kayu.
  { id: "minecraft:wooden_door",      qty: 8,  baseW: 0.80, cat: "utility", label: "Oak Door ×8",          icon: "textures/items/door_wood" },
  { id: "minecraft:spruce_door",      qty: 8,  baseW: 0.80, cat: "utility", label: "Spruce Door ×8",       icon: "textures/items/door_spruce" },
  { id: "minecraft:birch_door",       qty: 8,  baseW: 0.80, cat: "utility", label: "Birch Door ×8",        icon: "textures/items/door_birch" },
  { id: "minecraft:dark_oak_door",    qty: 8,  baseW: 0.85, cat: "utility", label: "Dark Oak Door ×8",     icon: "textures/items/door_dark_oak" },
  { id: "minecraft:iron_door",        qty: 8,  baseW: 1.50, cat: "utility", label: "Iron Door ×8",         icon: "textures/items/door_iron" },
);

ITEMS.push(
  // ════════════════════════════════════════════════════════════
  // REDSTONE — Komponen redstone umum (untuk build otomatis)
  // ════════════════════════════════════════════════════════════
  { id: "minecraft:redstone",             qty: 64, baseW: 0.70, cat: "redstone", label: "Redstone Dust ×64",     icon: "textures/items/redstone_dust" },
  { id: "minecraft:redstone_block",       qty: 16, baseW: 1.60, cat: "redstone", label: "Redstone Block ×16",    icon: "textures/blocks/redstone_block" },
  { id: "minecraft:repeater",             qty: 16, baseW: 1.20, cat: "redstone", label: "Repeater ×16",          icon: "textures/items/repeater" },
  { id: "minecraft:comparator",           qty: 16, baseW: 1.40, cat: "redstone", label: "Comparator ×16",        icon: "textures/items/comparator" },
  { id: "minecraft:lever",                qty: 16, baseW: 0.50, cat: "redstone", label: "Lever ×16",             icon: "textures/items/lever" },
  { id: "minecraft:stone_button",         qty: 16, baseW: 0.40, cat: "redstone", label: "Stone Button ×16",      icon: "textures/blocks/stone" },
  { id: "minecraft:wooden_button",        qty: 16, baseW: 0.35, cat: "redstone", label: "Wooden Button ×16",     icon: "textures/blocks/planks_oak" },
  { id: "minecraft:stone_pressure_plate", qty: 16, baseW: 0.50, cat: "redstone", label: "Stone Plate ×16",       icon: "textures/blocks/stone" },
  { id: "minecraft:wooden_pressure_plate",qty: 16, baseW: 0.45, cat: "redstone", label: "Wooden Plate ×16",      icon: "textures/blocks/planks_oak" },
  { id: "minecraft:light_weighted_pressure_plate",qty:8,baseW:1.20,cat:"redstone",label:"Gold Plate ×8",          icon:"textures/blocks/gold_block" },
  { id: "minecraft:heavy_weighted_pressure_plate",qty:8,baseW:1.20,cat:"redstone",label:"Iron Plate ×8",          icon:"textures/blocks/iron_block" },
  { id: "minecraft:daylight_detector",    qty: 4,  baseW: 1.80, cat: "redstone", label: "Daylight Sensor ×4",    icon: "textures/blocks/daylight_detector_top" },
  { id: "minecraft:hopper",               qty: 4,  baseW: 2.50, cat: "redstone", label: "Hopper ×4",             icon: "textures/items/hopper" },
  { id: "minecraft:dropper",              qty: 8,  baseW: 1.50, cat: "redstone", label: "Dropper ×8",            icon: "textures/blocks/dropper_front_horizontal" },
  { id: "minecraft:dispenser",            qty: 8,  baseW: 1.60, cat: "redstone", label: "Dispenser ×8",          icon: "textures/blocks/dispenser_front_horizontal" },
  { id: "minecraft:observer",             qty: 8,  baseW: 2.00, cat: "redstone", label: "Observer ×8",           icon: "textures/blocks/observer_front" },
  { id: "minecraft:piston",               qty: 8,  baseW: 1.70, cat: "redstone", label: "Piston ×8",             icon: "textures/blocks/piston_side" },
  { id: "minecraft:sticky_piston",        qty: 8,  baseW: 2.00, cat: "redstone", label: "Sticky Piston ×8",      icon: "textures/blocks/piston_top_sticky" },
  { id: "minecraft:tripwire_hook",        qty: 16, baseW: 0.80, cat: "redstone", label: "Tripwire Hook ×16",     icon: "textures/blocks/trip_wire_source" },
  { id: "minecraft:string",               qty: 32, baseW: 0.40, cat: "redstone", label: "String ×32",            icon: "textures/items/string" },
  // NOTE Bedrock: ID resmi "noteblock" (satu kata, bukan "note_block" Java)
  { id: "minecraft:noteblock",            qty: 8,  baseW: 1.20, cat: "redstone", label: "Note Block ×8",         icon: "textures/blocks/noteblock" },
  { id: "minecraft:target",               qty: 8,  baseW: 1.50, cat: "redstone", label: "Target Block ×8",       icon: "textures/blocks/target_side" },
  { id: "minecraft:rail",                 qty: 32, baseW: 0.70, cat: "redstone", label: "Rail ×32",              icon: "textures/blocks/rail_normal" },
  // NOTE Bedrock: ID resmi "golden_rail" (bukan "powered_rail" Java)
  { id: "minecraft:golden_rail",          qty: 16, baseW: 1.50, cat: "redstone", label: "Powered Rail ×16",      icon: "textures/blocks/rail_golden" },
  { id: "minecraft:detector_rail",        qty: 16, baseW: 1.40, cat: "redstone", label: "Detector Rail ×16",     icon: "textures/blocks/rail_detector" },
  { id: "minecraft:activator_rail",       qty: 16, baseW: 1.40, cat: "redstone", label: "Activator Rail ×16",    icon: "textures/blocks/rail_activator" },
);


// ============================================================
// INDEX & VALIDATION
// ============================================================

// Index cepat by id untuk validasi
export const ITEMS_BY_ID = new Map(ITEMS.map(it => [it.id, it]));

// Group by category untuk UI
export const ITEMS_BY_CAT = new Map();
for (const cat of CATEGORIES) ITEMS_BY_CAT.set(cat.id, []);
for (const it of ITEMS) {
  const arr = ITEMS_BY_CAT.get(it.cat);
  if (arr) arr.push(it);
}

/** Harga dasar per 1 unit (sebelum tier multiplier) */
export function baseUnitPrice(item, basis) {
  // Floor 1 koin supaya harga tidak pernah 0
  return Math.max(1, Math.round(item.baseW * basis));
}

/**
 * Filter ITEMS agar hanya berisi item yang valid (bisa dibuat ItemStack).
 * Dipanggil oleh main.js saat startup.
 * Item invalid akan di-log warning dan dihapus dari catalog in-memory.
 *
 * @param {function} ItemStack - @minecraft/server ItemStack constructor
 * @returns {{valid: number, invalid: string[]}}
 */
export function validateCatalog(ItemStack) {
  const invalid = [];
  const validIds = new Set();

  for (const item of ITEMS) {
    try {
      new ItemStack(item.id, 1);
      validIds.add(item.id);
    } catch (e) {
      invalid.push(item.id);
    }
  }

  if (invalid.length > 0) {
    // Remove invalid items dari ITEMS_BY_CAT
    for (const [catId, arr] of ITEMS_BY_CAT) {
      ITEMS_BY_CAT.set(catId, arr.filter(it => validIds.has(it.id)));
    }
    // Remove dari ITEMS_BY_ID
    for (const id of invalid) ITEMS_BY_ID.delete(id);
  }

  return { valid: validIds.size, invalid };
}
