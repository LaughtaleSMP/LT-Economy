// auction/items.js
// Serialisasi & deserialisasi ItemStack untuk penyimpanan di DynamicProperty.

import { ItemStack, EnchantmentType } from "@minecraft/server";
import { CATEGORIES, CAT_OTHER } from "../config.js";

// ═══════════════════════════════════════════════════════════
// SERIALIZE — ubah ItemStack jadi plain object
// ═══════════════════════════════════════════════════════════
export function serializeItem(itemStack) {
  const data = {
    typeId: itemStack.typeId,
    amount: itemStack.amount,
  };

  if (itemStack.nameTag) data.nameTag = itemStack.nameTag;

  // Lore
  try {
    const lore = itemStack.getLore();
    if (lore && lore.length > 0) data.lore = lore;
  } catch {}

  // Enchantments
  try {
    const enc = itemStack.getComponent("minecraft:enchantable");
    if (enc) {
      const list = enc.getEnchantments();
      if (list.length > 0) {
        data.enchantments = list.map(e => ({
          id: e.type.id,
          level: e.level,
        }));
      }
    }
  } catch {}

  // Durability
  try {
    const dur = itemStack.getComponent("minecraft:durability");
    if (dur) {
      data.damage       = dur.damage;
      data.maxDurability = dur.maxDurability;
    }
  } catch {}

  return data;
}

// ═══════════════════════════════════════════════════════════
// DESERIALIZE — buat ItemStack dari plain object
// ═══════════════════════════════════════════════════════════
export function deserializeItem(data) {
  try {
    const item = new ItemStack(data.typeId, data.amount ?? 1);

    if (data.nameTag) item.nameTag = data.nameTag;

    // Lore
    if (data.lore && data.lore.length > 0) {
      try { item.setLore(data.lore); } catch {}
    }

    // Enchantments
    if (data.enchantments && data.enchantments.length > 0) {
      try {
        const enc = item.getComponent("minecraft:enchantable");
        if (enc) {
          for (const e of data.enchantments) {
            try {
              const etype = new EnchantmentType(e.id);
              enc.addEnchantment({ type: etype, level: e.level });
            } catch {}
          }
        }
      } catch {}
    }

    // Durability
    if (typeof data.damage === "number") {
      try {
        const dur = item.getComponent("minecraft:durability");
        if (dur) dur.damage = data.damage;
      } catch {}
    }

    return item;
  } catch (e) {
    console.error("[Auction] deserializeItem gagal:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// INVENTORY HELPERS
// ═══════════════════════════════════════════════════════════
export function giveItem(player, itemData) {
  const item = deserializeItem(itemData);
  if (!item) return false;

  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    for (let i = 0; i < inv.size; i++) {
      if (!inv.getItem(i)) {
        inv.setItem(i, item);
        return true;
      }
    }
    return false;   // inventory penuh
  } catch (e) {
    console.error("[Auction] giveItem gagal:", e);
    return false;
  }
}

export function takeItemFromSlot(player, slot) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return null;

    const item = inv.getItem(slot);
    if (!item) return null;

    const data = serializeItem(item);
    inv.setItem(slot, undefined);
    return data;
  } catch (e) {
    console.error("[Auction] takeItemFromSlot gagal:", e);
    return null;
  }
}

/**
 * Ambil sebagian stack dari slot inventory.
 * Jika quantity === item.amount, ambil semua (hapus slot).
 * Jika quantity < item.amount, kurangi amount di slot, return data dengan amount = quantity.
 * @returns {object|null} serialized item data dengan amount = quantity, atau null jika gagal
 */
export function takePartialFromSlot(player, slot, quantity) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return null;

    const item = inv.getItem(slot);
    if (!item) return null;
    if (quantity <= 0 || quantity > item.amount) return null;

    // Serialize SEBELUM modifikasi slot
    const data = serializeItem(item);
    data.amount = quantity;

    if (quantity === item.amount) {
      // Ambil semua — hapus slot
      inv.setItem(slot, undefined);
    } else {
      // Ambil sebagian — buat stack baru dengan sisa amount
      // Gunakan item yang sudah ada, clone via ItemStack constructor + set properties
      const remaining = new ItemStack(item.typeId, item.amount - quantity);
      if (item.nameTag) remaining.nameTag = item.nameTag;
      try { remaining.setLore(item.getLore()); } catch {}
      try {
        const srcEnc = item.getComponent("minecraft:enchantable");
        const dstEnc = remaining.getComponent("minecraft:enchantable");
        if (srcEnc && dstEnc) {
          for (const e of srcEnc.getEnchantments()) {
            try { dstEnc.addEnchantment(e); } catch {}
          }
        }
      } catch {}
      try {
        const srcDur = item.getComponent("minecraft:durability");
        const dstDur = remaining.getComponent("minecraft:durability");
        if (srcDur && dstDur) dstDur.damage = srcDur.damage;
      } catch {}
      inv.setItem(slot, remaining);
    }

    return data;
  } catch (e) {
    console.error("[Auction] takePartialFromSlot gagal:", e);
    return null;
  }
}

export function freeSlots(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return 0;
  let f = 0;
  for (let i = 0; i < inv.size; i++) if (!inv.getItem(i)) f++;
  return f;
}

// ═══════════════════════════════════════════════════════════
// KATEGORI — deteksi kategori item berdasarkan typeId
// ═══════════════════════════════════════════════════════════

/**
 * Tentukan kategori item berdasarkan typeId.
 * @param {string} typeId - e.g. "minecraft:diamond_sword"
 * @returns {{ id: string, label: string, color: string }}
 */
export function getCategory(typeId) {
  const id = (typeId ?? "").replace("minecraft:", "");
  for (const cat of CATEGORIES) {
    if (cat.re.test(id)) return cat;
  }
  return CAT_OTHER;
}

// ═══════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════
export function displayName(itemData) {
  if (itemData.nameTag) {
    // Strip §k (obfuscated text) dan invisible marker prefix yang bikin "????"
    // Juga strip §0§r§k§r pattern dari gacha MARK
    let clean = itemData.nameTag
      .replace(/§k/g, "")             // hapus obfuscated formatter
      .replace(/\u00A7k/g, "")        // hapus unicode variant
      .replace(/\u00A70\u00A7r\u00A7k\u00A7r/g, "") // hapus gacha MARK prefix
      .replace(/§0§r§k§r/g, "")       // hapus MARK dalam format biasa
      .trim();
    if (clean.length > 0) return clean;
  }
  // Fallback: format typeId jadi readable
  const id = itemData.typeId ?? "unknown";
  const raw = id.includes(":") ? id.split(":").pop() : id;
  return raw.replace(/_/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Nama asli item berdasarkan typeId (tanpa custom name).
 * Digunakan untuk menampilkan item asli ketika ada nameTag (anti-rename scam).
 */
export function rawItemName(typeId) {
  const id = typeId ?? "unknown";
  const raw = id.includes(":") ? id.split(":").pop() : id;
  return raw.replace(/_/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function enchantSummary(itemData) {
  if (!itemData.enchantments || !itemData.enchantments.length) return "";
  return itemData.enchantments
    .map(e => {
      const name = e.id.replace("minecraft:", "").replace(/_/g, " ");
      return `${name} ${toRoman(e.level)}`;
    })
    .join(", ");
}

function toRoman(n) {
  if (n <= 0 || n > 10) return String(n);
  const r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return r[n];
}

// ═══════════════════════════════════════════════════════════
// ITEM ICON — texture path untuk ActionFormData button icon
// ═══════════════════════════════════════════════════════════

// Items with non-standard texture filenames
const ITEM_TEX = {
  // Tools & Weapons
  wooden_sword:"diamond_sword",wooden_pickaxe:"diamond_pickaxe",wooden_axe:"diamond_axe",wooden_shovel:"diamond_shovel",wooden_hoe:"diamond_hoe",
  stone_sword:"diamond_sword",stone_pickaxe:"diamond_pickaxe",stone_axe:"diamond_axe",stone_shovel:"diamond_shovel",stone_hoe:"diamond_hoe",
  iron_sword:"iron_sword",iron_pickaxe:"iron_pickaxe",iron_axe:"iron_axe",iron_shovel:"iron_shovel",iron_hoe:"iron_hoe",
  golden_sword:"gold_sword",golden_pickaxe:"gold_pickaxe",golden_axe:"gold_axe",golden_shovel:"gold_shovel",golden_hoe:"gold_hoe",
  diamond_sword:"diamond_sword",diamond_pickaxe:"diamond_pickaxe",diamond_axe:"diamond_axe",diamond_shovel:"diamond_shovel",diamond_hoe:"diamond_hoe",
  netherite_sword:"netherite_sword",netherite_pickaxe:"netherite_pickaxe",netherite_axe:"netherite_axe",netherite_shovel:"netherite_shovel",netherite_hoe:"netherite_hoe",
  bow:"bow_standby",crossbow:"crossbow_standby",trident:"trident",mace:"mace",shield:"empty_armor_slot_shield",
  fishing_rod:"fishing_rod_uncast",flint_and_steel:"flint_and_steel",shears:"shears",brush:"brush",spyglass:"spyglass",
  // Armor
  leather_helmet:"leather_helmet",leather_chestplate:"leather_chestplate",leather_leggings:"leather_leggings",leather_boots:"leather_boots",
  chainmail_helmet:"chainmail_helmet",chainmail_chestplate:"chainmail_chestplate",chainmail_leggings:"chainmail_leggings",chainmail_boots:"chainmail_boots",
  iron_helmet:"iron_helmet",iron_chestplate:"iron_chestplate",iron_leggings:"iron_leggings",iron_boots:"iron_boots",
  golden_helmet:"gold_helmet",golden_chestplate:"gold_chestplate",golden_leggings:"gold_leggings",golden_boots:"gold_boots",
  diamond_helmet:"diamond_helmet",diamond_chestplate:"diamond_chestplate",diamond_leggings:"diamond_leggings",diamond_boots:"diamond_boots",
  netherite_helmet:"netherite_helmet",netherite_chestplate:"netherite_chestplate",netherite_leggings:"netherite_leggings",netherite_boots:"netherite_boots",
  turtle_helmet:"turtle_helmet",elytra:"elytra",
  // Food
  apple:"apple",golden_apple:"apple_golden",enchanted_golden_apple:"apple_golden",
  bread:"bread",cooked_beef:"beef_cooked",beef:"beef_raw",cooked_porkchop:"porkchop_cooked",porkchop:"porkchop_raw",
  cooked_chicken:"chicken_cooked",chicken:"chicken_raw",cooked_mutton:"mutton_cooked",mutton:"mutton_raw",
  cooked_rabbit:"rabbit_cooked",rabbit:"rabbit_raw",cooked_cod:"fish_cooked",cod:"fish_raw",
  cooked_salmon:"salmon_cooked",salmon:"salmon_raw",baked_potato:"potato_baked",potato:"potato",poisonous_potato:"potato_poisonous",
  carrot:"carrot",golden_carrot:"carrot_golden",melon_slice:"melon",cookie:"cookie",cake:"cake",
  pumpkin_pie:"pumpkin_pie",beetroot:"beetroot",beetroot_soup:"beetroot_soup",mushroom_stew:"mushroom_stew",rabbit_stew:"rabbit_stew",
  suspicious_stew:"suspicious_stew",sweet_berries:"sweet_berries",glow_berries:"glow_berries",dried_kelp:"dried_kelp",honey_bottle:"honey_bottle",
  spider_eye:"spider_eye",rotten_flesh:"rotten_flesh",tropical_fish:"fish_clownfish_raw",pufferfish:"fish_pufferfish_raw",
  // Potions & Brewing
  potion:"potion_bottle_drinkable",splash_potion:"potion_bottle_splash",lingering_potion:"potion_bottle_lingering",
  glass_bottle:"potion_bottle_empty",blaze_powder:"blaze_powder",blaze_rod:"blaze_rod",
  ghast_tear:"ghast_tear",magma_cream:"magma_cream",fermented_spider_eye:"spider_eye_fermented",
  glistering_melon_slice:"melon_speckled",nether_wart:"nether_wart",phantom_membrane:"phantom_membrane",
  brewing_stand:"brewing_stand",rabbit_foot:"rabbit_foot",dragon_breath:"dragons_breath",
  // Materials & Resources
  diamond:"diamond",emerald:"emerald",iron_ingot:"iron_ingot",gold_ingot:"gold_ingot",copper_ingot:"copper_ingot",
  netherite_ingot:"netherite_ingot",iron_nugget:"iron_nugget",gold_nugget:"gold_nugget",
  raw_iron:"raw_iron",raw_gold:"raw_gold",raw_copper:"raw_copper",
  coal:"coal",charcoal:"charcoal",lapis_lazuli:"dye_powder_blue",redstone:"redstone_dust",
  quartz:"quartz",amethyst_shard:"amethyst_shard",flint:"flint",clay_ball:"clay_ball",
  brick:"brick",nether_brick:"netherbrick",prismarine_shard:"prismarine_shard",prismarine_crystals:"prismarine_crystals",
  echo_shard:"echo_shard",disc_fragment_5:"disc_fragment_5",netherite_scrap:"netherite_scrap",
  glowstone_dust:"glowstone_dust",gunpowder:"gunpowder",sugar:"sugar",
  // Misc Items
  stick:"stick",bone:"bone",bone_meal:"dye_powder_white",string:"string",feather:"feather",
  leather:"leather",paper:"paper",book:"book_normal",writable_book:"book_writable",written_book:"book_written",enchanted_book:"book_enchanted",
  map:"map_empty",filled_map:"map_filled",compass:"compass_item",clock:"clock_item",recovery_compass:"recovery_compass",
  name_tag:"name_tag",lead:"lead",saddle:"saddle",
  bucket:"bucket_empty",water_bucket:"bucket_water",lava_bucket:"bucket_lava",milk_bucket:"bucket_milk",
  powder_snow_bucket:"bucket_powder_snow",axolotl_bucket:"bucket_axolotl",tadpole_bucket:"bucket_tadpole",
  snowball:"snowball",egg:"egg",ender_pearl:"ender_pearl",ender_eye:"ender_eye",
  fire_charge:"fireball",firework_rocket:"fireworks",firework_star:"fireworks_charge",
  nether_star:"nether_star",totem_of_undying:"totem",heart_of_the_sea:"heartofthesea_closed",
  experience_bottle:"experience_bottle",knowledge_book:"book_normal",
  wheat:"wheat",wheat_seeds:"seeds_wheat",beetroot_seeds:"seeds_beetroot",melon_seeds:"seeds_melon",pumpkin_seeds:"seeds_pumpkin",
  cocoa_beans:"dye_powder_brown",ink_sac:"ink_sac",glow_ink_sac:"glow_ink_sac",
  kelp:"kelp",bamboo:"bamboo",sugar_cane:"reeds",cactus:"cactus",
  arrow:"arrow",spectral_arrow:"spectral_arrow",tipped_arrow:"tipped_arrow",
  // Spawn eggs — all use same icon
  wolf_armor:"wolf_armor",
  // Dyes
  white_dye:"dye_powder_white",orange_dye:"dye_powder_orange",magenta_dye:"dye_powder_magenta",light_blue_dye:"dye_powder_light_blue",
  yellow_dye:"dye_powder_yellow",lime_dye:"dye_powder_lime",pink_dye:"dye_powder_pink",gray_dye:"dye_powder_gray",
  light_gray_dye:"dye_powder_silver",cyan_dye:"dye_powder_cyan",purple_dye:"dye_powder_purple",blue_dye:"dye_powder_blue",
  brown_dye:"dye_powder_brown",green_dye:"dye_powder_green",red_dye:"dye_powder_red",black_dye:"dye_powder_black",
  // Music discs
  music_disc_13:"record_13",music_disc_cat:"record_cat",music_disc_blocks:"record_blocks",music_disc_chirp:"record_chirp",
  music_disc_far:"record_far",music_disc_mall:"record_mall",music_disc_mellohi:"record_mellohi",music_disc_stal:"record_stal",
  music_disc_strad:"record_strad",music_disc_ward:"record_ward",music_disc_11:"record_11",music_disc_wait:"record_wait",
  music_disc_otherside:"record_otherside",music_disc_5:"record_5",music_disc_pigstep:"record_pigstep",music_disc_relic:"record_relic",
  // Skulls & Heads
  skeleton_skull:"skull_skeleton",wither_skeleton_skull:"skull_wither",zombie_head:"skull_zombie",
  player_head:"skull_steve",creeper_head:"skull_creeper",dragon_head:"skull_dragon",piglin_head:"skull_piglin",
  // Banners
  white_banner:"banner",
  // Misc blocks placed as items
  torch:"torch",redstone_torch:"redstone_torch",soul_torch:"soul_torch",
  lantern:"lantern",soul_lantern:"soul_lantern",
  campfire:"campfire",soul_campfire:"soul_campfire",
  chain:"chain",lightning_rod:"lightning_rod",
  flower_pot:"flower_pot",painting:"painting",item_frame:"item_frame",glow_item_frame:"glow_item_frame",
  armor_stand:"armor_stand",
  minecart:"minecart_normal",chest_minecart:"minecart_chest",hopper_minecart:"minecart_hopper",tnt_minecart:"minecart_tnt",
  oak_boat:"boat_oak",spruce_boat:"boat_spruce",birch_boat:"boat_birch",jungle_boat:"boat_jungle",acacia_boat:"boat_acacia",dark_oak_boat:"boat_dark_oak",mangrove_boat:"boat_mangrove",cherry_boat:"boat_cherry",
};

// Blocks — use textures/blocks/ prefix
const BLOCK_TEX = {
  stone:"stone",cobblestone:"cobblestone",mossy_cobblestone:"cobblestone_mossy",
  granite:"stone_granite",polished_granite:"stone_granite_smooth",diorite:"stone_diorite",polished_diorite:"stone_diorite_smooth",
  andesite:"stone_andesite",polished_andesite:"stone_andesite_smooth",
  dirt:"dirt",coarse_dirt:"coarse_dirt",grass_block:"grass_side_carried",podzol:"dirt_podzol_side",mycelium:"mycelium_side",
  sand:"sand",red_sand:"red_sand",gravel:"gravel",clay:"clay",
  sandstone:"sandstone_normal",red_sandstone:"red_sandstone_normal",
  oak_log:"log_oak",spruce_log:"log_spruce",birch_log:"log_birch",jungle_log:"log_jungle",acacia_log:"log_acacia",dark_oak_log:"log_big_oak",
  mangrove_log:"mangrove_log_side",cherry_log:"cherry_log_side",
  oak_planks:"planks_oak",spruce_planks:"planks_spruce",birch_planks:"planks_birch",jungle_planks:"planks_jungle",
  acacia_planks:"planks_acacia",dark_oak_planks:"planks_big_oak",mangrove_planks:"mangrove_planks",cherry_planks:"cherry_planks",
  oak_wood:"log_oak",stripped_oak_log:"stripped_oak_log",
  cobblestone_slab:"cobblestone",oak_slab:"planks_oak",stone_slab:"stone",
  glass:"glass",glass_pane:"glass",tinted_glass:"tinted_glass",
  white_wool:"wool_colored_white",orange_wool:"wool_colored_orange",magenta_wool:"wool_colored_magenta",
  light_blue_wool:"wool_colored_light_blue",yellow_wool:"wool_colored_yellow",lime_wool:"wool_colored_lime",
  pink_wool:"wool_colored_pink",gray_wool:"wool_colored_gray",light_gray_wool:"wool_colored_silver",
  cyan_wool:"wool_colored_cyan",purple_wool:"wool_colored_purple",blue_wool:"wool_colored_blue",
  brown_wool:"wool_colored_brown",green_wool:"wool_colored_green",red_wool:"wool_colored_red",black_wool:"wool_colored_black",
  white_concrete:"concrete_white",orange_concrete:"concrete_orange",magenta_concrete:"concrete_magenta",
  light_blue_concrete:"concrete_light_blue",yellow_concrete:"concrete_yellow",lime_concrete:"concrete_lime",
  pink_concrete:"concrete_pink",gray_concrete:"concrete_gray",light_gray_concrete:"concrete_silver",
  cyan_concrete:"concrete_cyan",purple_concrete:"concrete_purple",blue_concrete:"concrete_blue",
  brown_concrete:"concrete_brown",green_concrete:"concrete_green",red_concrete:"concrete_red",black_concrete:"concrete_black",
  white_terracotta:"hardened_clay_stained_white",orange_terracotta:"hardened_clay_stained_orange",
  bricks:"brick",stone_bricks:"stonebrick",mossy_stone_bricks:"stonebrick_mossy",cracked_stone_bricks:"stonebrick_cracked",
  chiseled_stone_bricks:"stonebrick_carved",
  deepslate:"deepslate",cobbled_deepslate:"cobbled_deepslate",polished_deepslate:"polished_deepslate",
  deepslate_bricks:"deepslate_bricks",deepslate_tiles:"deepslate_tiles",
  coal_ore:"coal_ore",iron_ore:"iron_ore",gold_ore:"gold_ore",diamond_ore:"diamond_ore",
  emerald_ore:"emerald_ore",lapis_ore:"lapis_ore",redstone_ore:"redstone_ore",copper_ore:"copper_ore",
  deepslate_coal_ore:"deepslate_coal_ore",deepslate_iron_ore:"deepslate_iron_ore",
  deepslate_gold_ore:"deepslate_gold_ore",deepslate_diamond_ore:"deepslate_diamond_ore",
  nether_gold_ore:"nether_gold_ore",nether_quartz_ore:"quartz_ore",ancient_debris:"ancient_debris_side",
  coal_block:"coal_block",iron_block:"iron_block",gold_block:"gold_block",diamond_block:"diamond_block",
  emerald_block:"emerald_block",lapis_block:"lapis_block",redstone_block:"redstone_block",
  netherite_block:"netherite_block",copper_block:"copper_block",raw_iron_block:"raw_iron_block",
  raw_gold_block:"raw_gold_block",raw_copper_block:"raw_copper_block",amethyst_block:"amethyst_block",
  obsidian:"obsidian",crying_obsidian:"crying_obsidian",
  netherrack:"netherrack",nether_bricks:"nether_brick",basalt:"basalt_side",blackstone:"blackstone",
  end_stone:"end_stone",end_stone_bricks:"end_bricks",purpur_block:"purpur_block",
  glowstone:"glowstone",sea_lantern:"sea_lantern",shroomlight:"shroomlight",
  bookshelf:"bookshelf",crafting_table:"crafting_table_front",furnace:"furnace_front_off",
  chest:"chest",ender_chest:"ender_chest",barrel:"barrel_side",
  anvil:"anvil_base",enchanting_table:"enchanting_table_top",
  tnt:"tnt_side",slime_block:"slime",honey_block:"honey_top",
  ice:"ice",packed_ice:"ice_packed",blue_ice:"blue_ice",snow_block:"snow",
  sponge:"sponge",wet_sponge:"sponge_wet",
  hay_block:"hay_block_side",melon_block:"melon_side",pumpkin:"pumpkin_side",carved_pumpkin:"pumpkin_face",jack_o_lantern:"pumpkin_face_on",
  moss_block:"moss_block",mud:"mud",mud_bricks:"mud_bricks",packed_mud:"packed_mud",
  dripstone_block:"dripstone_block",calcite:"calcite",tuff:"tuff",
  prismarine:"prismarine_rough",dark_prismarine:"prismarine_dark",
  white_glazed_terracotta:"glazed_terracotta_white",
  note_block:"noteblock",jukebox:"jukebox_side",
  soul_sand:"soul_sand",soul_soil:"soul_soil",
  crimson_planks:"crimson_planks",warped_planks:"warped_planks",
  crimson_stem:"crimson_log_side",warped_stem:"warped_log_side",
  bone_block:"bone_block_side",dried_kelp_block:"dried_kelp_side_a",
  target:"target_side",bell:"bell",lodestone:"lodestone_top",respawn_anchor:"respawn_anchor_top",
  sculk:"sculk",sculk_sensor:"sculk_sensor_top",sculk_catalyst:"sculk_catalyst_top",sculk_shrieker:"sculk_shrieker_side",
  mangrove_roots:"mangrove_roots_side",
};

/**
 * Konversi typeId jadi texture path untuk icon button.
 * @param {string} typeId - e.g. "minecraft:diamond_sword"
 * @returns {string} texture path
 */
export function itemIcon(typeId) {
  if (!typeId) return "textures/items/paper";
  const id = typeId.replace("minecraft:", "");

  // 1) Check item special map
  if (ITEM_TEX[id]) return `textures/items/${ITEM_TEX[id]}`;

  // 2) Check block special map
  if (BLOCK_TEX[id]) return `textures/blocks/${BLOCK_TEX[id]}`;

  // 3) Spawn eggs — all look similar
  if (id.endsWith("_spawn_egg")) return "textures/items/egg";

  // 4) Banners
  if (id.endsWith("_banner")) return "textures/items/banner";

  // 5) Beds
  if (id.endsWith("_bed")) return "textures/items/bed_red";

  // 6) Candles
  if (id.endsWith("_candle") || id === "candle") return "textures/blocks/candle_white";

  // 7) Stained/colored glass
  if (id.endsWith("_stained_glass") || id.endsWith("_stained_glass_pane")) return "textures/blocks/glass";

  // 8) Signs
  if (id.endsWith("_sign") || id.endsWith("_hanging_sign")) return "textures/items/sign";

  // 9) Doors
  if (id.endsWith("_door")) return "textures/items/door_wood_oak";

  // 10) Boats & rafts
  if (id.endsWith("_boat") || id.endsWith("_chest_boat")) return "textures/items/boat_oak";

  // 11) Flowers & saplings
  if (id.endsWith("_sapling")) return "textures/blocks/sapling_oak";
  if (id.includes("flower") || id === "dandelion" || id === "poppy" || id === "cornflower"
    || id === "lily_of_the_valley" || id === "azure_bluet" || id === "oxeye_daisy"
    || id === "allium" || id === "blue_orchid" || id === "sunflower" || id === "lilac"
    || id === "rose_bush" || id === "peony" || id === "wither_rose" || id === "torchflower")
    return "textures/items/flower_dandelion";

  // 12) Colored variants — safe generic icons
  if (id.endsWith("_carpet")) return "textures/items/bed_red";
  if (id.endsWith("_concrete_powder") || id.endsWith("_concrete")) return "textures/blocks/concrete_white";
  if (id.endsWith("_terracotta")) return "textures/blocks/hardened_clay";
  if (id.endsWith("_wool")) return "textures/blocks/wool_colored_white";
  if (id.endsWith("_glazed_terracotta")) return "textures/blocks/hardened_clay";

  // 13) Building blocks — safe generic icons
  if (id.endsWith("_stairs") || id.endsWith("_slab") || id.endsWith("_wall")) return "textures/blocks/stonebrick";
  if (id.endsWith("_fence") || id.endsWith("_fence_gate")) return "textures/blocks/planks_oak";
  if (id.endsWith("_trapdoor") || id.endsWith("_door")) return "textures/items/door_wood_oak";
  if (id.endsWith("_pressure_plate") || id.endsWith("_button")) return "textures/blocks/stone";

  // 14) Category-based fallback — ALWAYS returns a valid icon
  const cat = getCategory(typeId);
  return cat.tex || "textures/items/paper";
}
