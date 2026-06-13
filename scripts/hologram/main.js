// hologram/main.js — Admin UI: /lt:holo (tag mimi only)
// Intervals: 0. Features: CRUD, duplicate, alignment, templates, leaderboard builder.
import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { HOLO_CFG as CFG } from "./config.js";
import {
  getRegistry, createHologram, deleteHologram, duplicateHologram,
  editHologram, moveHologram, nudgeHologram, addLine, removeLine, setAlign,
  despawnHologram, spawnHologram, saveRegistry, sanitizeText,
} from "./engine.js";
import { UIClose } from "../ui_close.js";

const _active = new Set();
function _sfx(p, id, pitch = 1.0) { try { p.playSound(id, { pitch, volume: 0.7 }); } catch {} }
const _al = { center: "§f Tengah", left: "§f Kiri", right: "§f Kanan" };

system.beforeEvents.startup.subscribe(init => {
  try {
    init.customCommandRegistry.registerCommand({
      name: "lt:holo", description: "Kelola Hologram (Admin)",
      permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
    }, (origin) => {
      const p = origin.sourceEntity;
      if (!p?.sendMessage) return;
      if (!p.hasTag(CFG.ADMIN_TAG)) { system.run(() => p.sendMessage("§8[§cHolo§8]§c Akses ditolak.")); return; }
      if (_active.has(p.id)) return;
      system.run(() => _open(p).catch(e => { if (!e?.isUIClose) console.warn("[Holo] ui:", e); }));
      return { status: 0 };
    });
  } catch (e) { console.warn("[Holo] cmd reg:", e); }
});

async function _open(player) {
  if (_active.has(player.id)) return;
  _active.add(player.id);
  try { await _menu(player); }
  catch (e) { if (!e?.isUIClose) throw e; }
  finally { _active.delete(player.id); }
}

// ── Main menu ──
async function _menu(player) {
  while (true) {
    const reg = getRegistry();
    const loc = player.location;
    let body = `${CFG.HR}\n§b  ♦ HOLOGRAM MANAGER\n${CFG.HR}\n\n`;
    body += `  §fTotal: §e${reg.length}§8/§f${CFG.MAX_HOLOS}\n`;
    body += `  §fPosisi: §f${loc.x | 0}, ${loc.y | 0}, ${loc.z | 0}\n\n${CFG.HR}`;

    const B = [];
    const f = new ActionFormData().title("§8 ♦ §bHOLOGRAM§r §8♦ §r").body(body);
    f.button("§a  Buat dari Template\n§r  §8Preset profesional", "textures/ui/color_plus"); B.push("tpl");
    f.button("§6  Leaderboard Builder\n§r  §8Pilih scoreboard aktif", "textures/items/diamond"); B.push("lb");
    f.button("§b  Buat Custom\n§r  §8Tulis teks sendiri", "textures/items/book_writable"); B.push("custom");
    f.button(`§e  Daftar (${reg.length})\n§r  §8Edit, duplikat, hapus`, "textures/items/name_tag"); B.push("list");
    f.button("§d  Placeholder Info\n§r  §8Variabel dinamis", "textures/items/paper"); B.push("info");
    f.button("§c  Respawn Semua\n§r  §8Perbaiki holo hilang", "textures/items/ender_pearl"); B.push("respawn");
    f.button("§4  Hapus Semua\n§r  §8Hapus seluruh hologram", "textures/ui/cancel"); B.push("nuke");
    f.button("§8  Tutup", "textures/items/redstone_dust"); B.push("x");

    _sfx(player, "random.click", 1.3);
    const r = await f.show(player);
    if (r.canceled) throw new UIClose();
    if (B[r.selection] === "x") return;

    switch (B[r.selection]) {
      case "tpl":     await _uiTpl(player); break;
      case "lb":      await _uiLeaderboard(player); break;
      case "custom":  await _uiCustom(player); break;
      case "list":    await _uiList(player); break;
      case "info":    await _uiInfo(player); break;
      case "respawn": await _uiRespawn(player); break;
      case "nuke":    await _uiNuke(player); break;
    }
  }
}

// ── Create from template ──
async function _uiTpl(player) {
  const keys = Object.keys(CFG.TEMPLATES);
  const f = new ActionFormData()
    .title("§8 ♦ §aTEMPLATE§r §8♦ §r")
    .body(`${CFG.HR}\n§a  ♦ Pilih template:\n${CFG.HR}`);
  for (const k of keys) {
    const t = CFG.TEMPLATES[k];
    f.button(`§f  ${t.name}\n§r  §8${t.desc}`, "textures/items/name_tag");
  }
  f.button("§6  Kembali", "textures/items/arrow");

  const r = await f.show(player);
  if (r.canceled) throw new UIClose();
  if (r.selection === keys.length) return;

  const tplKey = keys[r.selection];
  const tpl    = CFG.TEMPLATES[tplKey];

  const align = await _pickAlign(player, tpl.align);
  if (align === null) return;

  const anim = await _pickAnim(player);
  if (anim === null) return;

  const loc = player.location;
  const res = createHologram([...tpl.lines], loc.x, loc.y + 2, loc.z, player.dimension.id, player.name, tplKey, anim, align, CFG.VIEW_RANGE);
  if (!res.ok) { player.sendMessage(`§8[§cHolo§8]§c Limit ${CFG.MAX_HOLOS} tercapai!`); return; }

  _sfx(player, "random.levelup");
  player.sendMessage(`§8[§aHolo§8]§a Template "${tplKey}" dibuat!\n§7 ID: §f${res.id}  §7Align: §f${align}`);
}

// ── Leaderboard Builder — pick from active scoreboards ──
async function _uiLeaderboard(player) {
  // Fetch all scoreboard objectives
  let objectives = [];
  try { objectives = world.scoreboard.getObjectives(); } catch {}
  if (!objectives.length) {
    await new ActionFormData().title("§8 ♦ §6LEADERBOARD§r §8♦ §r")
      .body(`${CFG.HR}\n§c  ♦ Tidak ada scoreboard aktif.\n\n§7 Buat scoreboard terlebih dahulu\n§7 menggunakan /scoreboard objectives add\n${CFG.HR}`)
      .button("§6  Kembali", "textures/items/arrow").show(player);
    return;
  }

  // Sort alphabetically for easy browsing
  objectives.sort((a, b) => a.id.localeCompare(b.id));

  // Step 1: Pick scoreboard objective
  const f1 = new ActionFormData()
    .title("§8 ♦ §6PILIH SCOREBOARD§r §8♦ §r")
    .body(`${CFG.HR}\n§6  ♦ Scoreboard Aktif: §f${objectives.length}\n${CFG.HR}\n\n§7 Pilih scoreboard untuk leaderboard:`);
  for (const obj of objectives) {
    // Show participant count for each objective
    let count = 0;
    try { count = obj.getParticipants().length; } catch {}
    const display = obj.displayName && obj.displayName !== obj.id
      ? `§f  ${obj.id}\n§r  §8"${obj.displayName}" §7(${count} entri)`
      : `§f  ${obj.id}\n§r  §7${count} entri`;
    f1.button(display, "textures/items/name_tag");
  }
  f1.button("§6  Kembali", "textures/items/arrow");

  const r1 = await f1.show(player);
  if (r1.canceled) throw new UIClose();
  if (r1.selection === objectives.length) return;

  const chosen = objectives[r1.selection];
  const objId = chosen.id;
  const objDisplay = chosen.displayName || objId;

  // Step 2: Configure count + title
  const f2 = new ModalFormData()
    .title("§8 ♦ §6KONFIGURASI§r §8♦ §r")
    .slider("§fJumlah Top Player", 1, 10, { defaultValue: 10 })
    .textField(
      `§fJudul Leaderboard\n§8Kosongkan untuk auto: "TOP N ${objId.toUpperCase()}"`,
      `TOP 10 ${objId.toUpperCase()}`,
      { defaultValue: "" }
    );
  const r2 = await f2.show(player);
  if (r2.canceled) return;

  const topN = r2.formValues?.[0] ?? 10;
  const customTitle = sanitizeText(String(r2.formValues?.[1] ?? "").trim());
  const title = customTitle || `T O P   ${topN}   ${objId.toUpperCase().split("").join(" ")}`;

  // Step 3: Pick alignment
  const align = await _pickAlign(player);
  if (align === null) return;

  // Step 4: Pick animation
  const anim = await _pickAnim(player);
  if (anim === null) return;

  // Build leaderboard lines
  const lines = [
    "",
    `§l§6${title}`,
    "",
    "§r§8───────────────────────",
    "",
    `{top:${objId}:${topN}}`,
    "",
    "§r§8───────────────────────",
    "",
  ];

  const loc = player.location;
  const res = createHologram(
    lines, loc.x, loc.y + 2, loc.z,
    player.dimension.id, player.name,
    `lb_${objId}`, anim, align, CFG.VIEW_RANGE
  );
  if (!res.ok) { player.sendMessage(`§8[§cHolo§8]§c Limit ${CFG.MAX_HOLOS} tercapai!`); return; }

  _sfx(player, "random.levelup");
  player.sendMessage(
    `§8[§aHolo§8]§a Leaderboard dibuat!\n` +
    `§7 Scoreboard: §f${objId}\n` +
    `§7 Display: §f${objDisplay}\n` +
    `§7 Top: §f${topN}\n` +
    `§7 ID: §f${res.id}  §7Align: §f${align}`
  );
}

// ── Create custom ──
async function _uiCustom(player) {
  const loc = player.location;
  const f = new ModalFormData()
    .title("§8 ♦ §bCUSTOM§r §8♦ §r")
    .textField(
      "§fKonten §8(\\n = baris baru)\n§7{online}, {top:coin:10}, {my:coin}, {day|A|B}",
      "§6Welcome\\n§7Online: {online}", { defaultValue: "" }
    );
  const r = await f.show(player);
  if (r.canceled) return;

  const raw = String(r.formValues?.[0] ?? "").trim();
  if (!raw) { player.sendMessage("§8[§cHolo§8]§c Konten kosong!"); return; }

  const align = await _pickAlign(player);
  if (align === null) return;

  const lines = raw.split("\\n").slice(0, CFG.MAX_LINES);
  const res   = createHologram(lines, loc.x, loc.y + 2, loc.z, player.dimension.id, player.name, null, "none", align, CFG.VIEW_RANGE);
  if (!res.ok) { player.sendMessage(`§8[§cHolo§8]§c Limit tercapai!`); return; }

  _sfx(player, "random.levelup");
  player.sendMessage(`§8[§aHolo§8]§a Custom dibuat! §7ID: §f${res.id}`);
}

// ── Shared pickers ──
async function _pickAlign(player, def = "center") {
  const keys = Object.keys(CFG.ALIGNS);
  const f = new ActionFormData()
    .title("§8 ♦ §fALIGNMENT§r §8♦ §r")
    .body(`${CFG.HR}\n§f  ♦ Pilih perataan teks:\n${CFG.HR}`);
  for (const k of keys) {
    const cur = k === def ? " §a(default)" : "";
    f.button(`${_al[k]}${cur}`);
  }
  const r = await f.show(player);
  if (r.canceled) return null;
  return keys[r.selection];
}

async function _pickAnim(player) {
  const keys = Object.keys(CFG.ANIMATIONS);
  const f = new ActionFormData()
    .title("§8 ♦ §dANIMASI§r §8♦ §r")
    .body(`${CFG.HR}\n§d  ♦ Pilih animasi:\n${CFG.HR}`);
  for (const k of keys) f.button(`§f  ${CFG.ANIMATIONS[k]}`);
  const r = await f.show(player);
  if (r.canceled) return null;
  return keys[r.selection];
}

async function _pickViewRange(player, current = CFG.VIEW_RANGE) {
  const keys = Object.keys(CFG.VIEW_RANGES).map(Number);
  const f = new ActionFormData()
    .title("§8 ♦ §aVIEW RANGE§r §8♦ §r")
    .body(`${CFG.HR}\n§a  ♦ Jarak render update:\n${CFG.HR}`);
  for (const k of keys) {
    const cur = k === current ? " §a(aktif)" : "";
    f.button(`§f  ${CFG.VIEW_RANGES[k]}${cur}`);
  }
  f.button("§6  Kembali", "textures/items/arrow");
  const r = await f.show(player);
  if (r.canceled || r.selection === keys.length) return null;
  return keys[r.selection];
}

// ── List holos ──
async function _uiList(player) {
  while (true) {
    const reg = getRegistry();
    if (!reg.length) {
      await new ActionFormData().title("§8 ♦ §eDAFTAR§r §8♦ §r")
        .body(`${CFG.HR}\n§e  ♦ Belum ada hologram.\n${CFG.HR}`)
        .button("§6  Kembali", "textures/items/arrow").show(player);
      return;
    }
    const loc = player.location;
    const sorted = [...reg].sort((a, b) =>
      Math.hypot(a.x - loc.x, a.y - loc.y, a.z - loc.z) -
      Math.hypot(b.x - loc.x, b.y - loc.y, b.z - loc.z)
    );
    const f = new ActionFormData()
      .title(`§8 ♦ §eDAFTAR (${reg.length})§r §8♦ §r`)
      .body(`${CFG.HR}\n§e  ♦ Pilih hologram:\n${CFG.HR}`);
    for (const e of sorted) {
      const dist = Math.hypot(e.x - loc.x, e.y - loc.y, e.z - loc.z) | 0;
      const prev = (e.lines.find(l => l.replace(/§./g, "").trim()) ?? "").replace(/§./g, "").slice(0, 16) || "(kosong)";
      const badge = e.template ? ` §d[${e.template}]` : "";
      f.button(`§f  ${prev}${badge}\n§r  §8${dist}m §7${e.lines.length}L §7${e.align ?? "center"}`, "textures/items/name_tag");
    }
    f.button("§6  Kembali", "textures/items/arrow");

    const r = await f.show(player);
    if (r.canceled) throw new UIClose();
    if (r.selection === sorted.length) return;
    await _uiEdit(player, sorted[r.selection]);
  }
}

// ── Edit hologram ──
async function _uiEdit(player, entry) {
  while (true) {
    const preview = entry.lines.map((l, i) => `  §8${i} §r${l}`).join("\n");
    let body = `${CFG.HR}\n§e  ♦ ${entry.id}\n${CFG.HR}\n`;
    body += `  §7Tpl: §f${entry.template ?? "Custom"}\n`;
    body += `  §7Align: §f${entry.align ?? "center"}\n`;
    body += `  §7Anim: §f${entry.anim ?? "none"}\n`;
    const vr = entry.viewRange ?? CFG.VIEW_RANGE;
    body += `  §7View: §f${vr <= 0 ? "Unlimited" : vr + " blok"}\n`;
    body += `  §7Pos: §f${entry.x}, ${entry.y}, ${entry.z}\n`;
    body += `${CFG.HR_THIN}\n${preview}\n${CFG.HR}`;

    const B = [];
    const f = new ActionFormData().title("§8 ♦ §eEDIT§r §8♦ §r").body(body);
    f.button("§e  Edit Baris", "textures/ui/editIcon"); B.push("edit");
    f.button("§a  Tambah Baris", "textures/ui/color_plus"); B.push("add");
    f.button("§c  Hapus Baris", "textures/ui/cancel"); B.push("del");
    f.button("§f  Ubah Alignment", "textures/items/book_writable"); B.push("align");
    f.button("§d  Ubah Animasi", "textures/items/clock_item"); B.push("anim");
    f.button("§a  View Range", "textures/items/spyglass"); B.push("vrange");
    f.button("§b  Pindah ke Saya", "textures/items/ender_pearl"); B.push("move");
    f.button("§d  Geser Posisi\n§r  §8Nudge X/Y/Z", "textures/items/compass_item"); B.push("nudge");
    f.button("§b  TP ke Holo", "textures/items/compass_item"); B.push("tp");
    f.button("§a  Duplikat", "textures/ui/color_plus"); B.push("dup");
    f.button("§c  Hapus Hologram", "textures/ui/cancel"); B.push("delete");
    f.button("§6  Kembali", "textures/items/arrow"); B.push("back");

    _sfx(player, "random.click", 1.2);
    const r = await f.show(player);
    if (r.canceled) throw new UIClose();
    const act = B[r.selection];
    if (act === "back") return;

    if (act === "edit") { await _uiEditLine(player, entry); continue; }
    if (act === "add")  { await _uiAddLine(player, entry); continue; }
    if (act === "del")  { await _uiDelLine(player, entry); continue; }

    if (act === "align") {
      const newA = await _pickAlign(player, entry.align);
      if (newA) {
        setAlign(entry.id, newA);
        entry.align = newA;
        _sfx(player, "random.orb");
        player.sendMessage(`§8[§aHolo§8]§a Align: §f${newA}`);
      }
      continue;
    }

    if (act === "anim") {
      const newAn = await _pickAnim(player);
      if (newAn) {
        entry.anim = newAn;
        const reg = getRegistry();
        const idx = reg.findIndex(e => e.id === entry.id);
        if (idx >= 0) { reg[idx].anim = newAn; saveRegistry(reg); }
        despawnHologram(entry.id); spawnHologram(entry);
        _sfx(player, "random.orb");
        player.sendMessage(`§8[§aHolo§8]§a Animasi: §f${newAn}`);
      }
      continue;
    }

    if (act === "vrange") {
      const newVR = await _pickViewRange(player, entry.viewRange);
      if (newVR !== null) {
        entry.viewRange = newVR;
        const reg = getRegistry();
        const idx = reg.findIndex(e => e.id === entry.id);
        if (idx >= 0) { reg[idx].viewRange = newVR; saveRegistry(reg); }
        _sfx(player, "random.orb");
        player.sendMessage(`§8[§aHolo§8]§a View Range: §f${newVR <= 0 ? "Unlimited" : newVR + " blok"}`);
      }
      continue;
    }

    if (act === "move") {
      const loc = player.location;
      moveHologram(entry.id, loc.x, loc.y + 2, loc.z);
      entry.x = Math.round(loc.x * 100) / 100;
      entry.y = Math.round((loc.y + 2) * 100) / 100;
      entry.z = Math.round(loc.z * 100) / 100;
      _sfx(player, "random.orb");
      player.sendMessage("§8[§aHolo§8]§a Dipindah.");
      continue;
    }

    if (act === "nudge") {
      await _uiNudge(player, entry);
      continue;
    }

    if (act === "tp") {
      try { player.teleport({ x: entry.x, y: entry.y, z: entry.z }); } catch {}
      _sfx(player, "mob.endermen.portal");
      continue;
    }

    if (act === "dup") {
      const loc = player.location;
      const res = duplicateHologram(entry.id, loc.x, loc.y + 2, loc.z, player.dimension.id);
      if (!res.ok) { player.sendMessage(`§8[§cHolo§8]§c ${res.err === "max_limit" ? "Limit tercapai!" : "Tidak ditemukan!"}`); continue; }
      _sfx(player, "random.levelup");
      player.sendMessage(`§8[§aHolo§8]§a Duplikat dibuat!\n§7 ID baru: §f${res.id}`);
      continue;
    }

    if (act === "delete") {
      const cf = await new MessageFormData()
        .title("§8 ♦ §cHAPUS§r §8♦ §r")
        .body(`${CFG.HR}\n§c  ♦ HAPUS §f${entry.id}§c?\n${CFG.HR}`)
        .button1("§f Batal").button2("§c Hapus").show(player);
      if (!cf.canceled && cf.selection === 1) {
        deleteHologram(entry.id);
        _sfx(player, "mob.zombie.woodbreak");
        player.sendMessage("§8[§cHolo§8]§c Dihapus.");
        return;
      }
    }
  }
}

// ── Line editors ──
async function _uiEditLine(player, entry) {
  const f = new ActionFormData().title("§8 ♦ §eEDIT BARIS§r §8♦ §r")
    .body(`${CFG.HR}\n§e  ♦ Pilih baris:\n${CFG.HR}`);
  for (let i = 0; i < entry.lines.length; i++) {
    f.button(`§f  #${i}: ${entry.lines[i].replace(/§./g, "").slice(0, 20) || "(kosong)"}`);
  }
  f.button("§6  Kembali", "textures/items/arrow");

  const r = await f.show(player);
  if (r.canceled) throw new UIClose();
  if (r.selection === entry.lines.length) return;

  const idx = r.selection;
  const ef = new ModalFormData().title(`§8 ♦ §eEDIT #${idx}§r §8♦ §r`)
    .textField("§fTeks\n§7{online}, {top:coin:10}, {my:coin}", "...", { defaultValue: entry.lines[idx] });
  const er = await ef.show(player);
  if (er.canceled) return;

  entry.lines[idx] = sanitizeText(String(er.formValues?.[0] ?? "")) || "(kosong)";
  editHologram(entry.id, entry.lines);
  _sfx(player, "random.orb");
  player.sendMessage(`§8[§aHolo§8]§a #${idx} diperbarui.`);
}

async function _uiAddLine(player, entry) {
  if (entry.lines.length >= CFG.MAX_LINES) { player.sendMessage(`§8[§cHolo§8]§c Maks ${CFG.MAX_LINES}!`); return; }
  const f = new ModalFormData().title("§8 ♦ §aTAMBAH§r §8♦ §r")
    .textField("§fTeks baris baru", "...", { defaultValue: "" });
  const r = await f.show(player);
  if (r.canceled) return;
  const text = sanitizeText(String(r.formValues?.[0] ?? "")) || "(baris baru)";
  if (addLine(entry.id, text)) {
    entry.lines.push(text);
  }
  _sfx(player, "random.orb");
}

async function _uiDelLine(player, entry) {
  if (entry.lines.length <= 1) { player.sendMessage("§8[§cHolo§8]§c Minimal 1 baris!"); return; }
  const f = new ActionFormData().title("§8 ♦ §cHAPUS BARIS§r §8♦ §r")
    .body(`${CFG.HR}\n§c  ♦ Pilih baris:\n${CFG.HR}`);
  for (let i = 0; i < entry.lines.length; i++) {
    f.button(`§c  #${i}: ${entry.lines[i].replace(/§./g, "").slice(0, 20) || "(kosong)"}`);
  }
  f.button("§6  Kembali", "textures/items/arrow");
  const r = await f.show(player);
  if (r.canceled) throw new UIClose();
  if (r.selection === entry.lines.length) return;
  if (removeLine(entry.id, r.selection)) {
    entry.lines.splice(r.selection, 1);
  }
  _sfx(player, "mob.zombie.woodbreak");
}

// ── Nudge position ──
async function _uiNudge(player, entry) {
  const steps = [0.1, 0.25, 0.5, 1.0, 2.0];
  let stepIdx = 2; // default 0.5

  while (true) {
    const step = steps[stepIdx];
    let body = `${CFG.HR}\n§d  ♦ GESER POSISI\n${CFG.HR}\n`;
    body += `  §7X: §f${entry.x}  §7Y: §f${entry.y}  §7Z: §f${entry.z}\n`;
    body += `  §7Step: §e${step} §7blok\n${CFG.HR}`;

    const B = [];
    const f = new ActionFormData().title("§8 ♦ §dGESER§r §8♦ §r").body(body);
    f.button(`§a  X+ §f(+${step})\n§r  §8East`);  B.push("x+");
    f.button(`§c  X- §f(-${step})\n§r  §8West`);  B.push("x-");
    f.button(`§a  Y+ §f(+${step})\n§r  §8Naik`);  B.push("y+");
    f.button(`§c  Y- §f(-${step})\n§r  §8Turun`); B.push("y-");
    f.button(`§a  Z+ §f(+${step})\n§r  §8South`); B.push("z+");
    f.button(`§c  Z- §f(-${step})\n§r  §8North`); B.push("z-");
    f.button(`§e  Step: §f${step} §8\u2192 §f${steps[(stepIdx + 1) % steps.length]}`, "textures/items/compass_item"); B.push("step");
    f.button("§6  Selesai", "textures/items/arrow"); B.push("done");

    const r = await f.show(player);
    if (r.canceled) throw new UIClose();
    const act = B[r.selection];
    if (act === "done") return;

    if (act === "step") {
      stepIdx = (stepIdx + 1) % steps.length;
      _sfx(player, "random.click", 1.5);
      continue;
    }

    let dx = 0, dy = 0, dz = 0;
    if (act === "x+") dx = step;
    if (act === "x-") dx = -step;
    if (act === "y+") dy = step;
    if (act === "y-") dy = -step;
    if (act === "z+") dz = step;
    if (act === "z-") dz = -step;

    nudgeHologram(entry.id, dx, dy, dz);
    // entry.x/y/z already updated by nudgeHologram (same object ref)
    _sfx(player, "random.orb", 1.2);
  }
}

// ── Placeholder info ──
async function _uiInfo(player) {
  let body = `${CFG.HR}\n§d  ♦ PLACEHOLDER\n${CFG.HR}\n\n`;
  body += `§e-- Global --\n`;
  body += `  §b{online} §8- §7Player online\n`;
  body += `  §b{time} §8- §7Waktu WIB\n`;
  body += `  §b{date} §8- §7Tanggal\n`;
  body += `  §b{day_count} §8- §7Hari dunia\n\n`;
  body += `§e-- Leaderboard --\n`;
  body += `  §b{top:coin:10} §8- §7Top 10 "coin"\n`;
  body += `  §b{top:gem:5} §8- §7Top 5 "gem"\n`;
  body += `  §8  Ganti obj dengan nama scoreboard\n\n`;
  body += `§e-- Per-Player --\n`;
  body += `  §b{my_name} §8- §7Nama terdekat\n`;
  body += `  §b{my:coin} §8- §7Skor coin player\n`;
  body += `  §8  Range: ${CFG.PROXIMITY_RANGE} blok\n\n`;
  body += `§e-- Kondisional --\n`;
  body += `  §b{day|A|B} §8- §7A siang, B malam\n\n${CFG.HR}`;

  await new ActionFormData().title("§8 ♦ §dINFO§r §8♦ §r").body(body)
    .button("§6  Kembali", "textures/items/arrow").show(player);
}

// ── Respawn all ──
async function _uiRespawn(player) {
  const reg = getRegistry();
  const cf = await new MessageFormData().title("§8 ♦ §cRESPAWN§r §8♦ §r")
    .body(`${CFG.HR}\n§e  ♦ Respawn semua hologram.\n§7 Total: §f${reg.length}\n${CFG.HR}`)
    .button1("§f Batal").button2("§a Respawn").show(player);
  if (cf.canceled || cf.selection !== 1) return;
  let n = 0;
  for (const e of reg) { despawnHologram(e.id); spawnHologram(e); n++; }
  _sfx(player, "random.levelup");
  player.sendMessage(`§8[§aHolo§8]§a ${n} hologram di-respawn.`);
}

// ── Delete all ──
async function _uiNuke(player) {
  const reg = getRegistry();
  if (!reg.length) {
    player.sendMessage("§8[§cHolo§8]§c Tidak ada hologram.");
    return;
  }

  const cf1 = await new MessageFormData().title("§8 ♦ §4HAPUS SEMUA§r §8♦ §r")
    .body(`${CFG.HR}\n§c  ♦ HAPUS SEMUA HOLOGRAM?\n${CFG.HR}\n\n§f Total: §c${reg.length} §fhologram\n\n§7 Aksi ini §cTIDAK BISA §7dibatalkan.\n${CFG.HR}`)
    .button1("§f Batal").button2("§c Lanjut").show(player);
  if (cf1.canceled || cf1.selection !== 1) return;

  const cf2 = await new ModalFormData().title("§8 ♦ §4KONFIRMASI§r §8♦ §r")
    .textField(`§c  ♦ Ketik §f${reg.length} §cuntuk konfirmasi hapus`, `${reg.length}`, { defaultValue: "" })
    .show(player);
  if (cf2.canceled) return;

  const input = String(cf2.formValues?.[0] ?? "").trim();
  if (input !== String(reg.length)) {
    player.sendMessage("§8[§cHolo§8]§c Input tidak cocok. Dibatalkan.");
    return;
  }

  let n = 0;
  for (const e of reg) { despawnHologram(e.id); n++; }
  saveRegistry([]);
  _sfx(player, "mob.zombie.woodbreak");
  player.sendMessage(`§8[§cHolo§8]§c ${n} hologram dihapus permanen.`);
}
