// hologram/engine.js — Core engine: single-entity hologram (unified background)
// Intervals: 2 (update loop + DP flush). 1 entity = 1 hologram (all lines in 1 nameTag).
import { world, system } from "@minecraft/server";
import { HOLO_CFG as CFG } from "./config.js";

let _regCache = null;
let _regDirty = false;
const _pendingSpawn = new Set(); // IDs waiting for chunk load

function _readReg() {
  try { return JSON.parse(world.getDynamicProperty(CFG.K_REGISTRY) ?? "null") ?? []; }
  catch { return []; }
}

function _flushReg() {
  if (!_regDirty || !_regCache) return;
  try {
    const json = JSON.stringify(_regCache);
    if (json.length > 30000) {
      console.warn(`[Holo] ⚠ Registry size: ${(json.length / 1024).toFixed(1)}KB — approaching DP limit!`);
    }
    world.setDynamicProperty(CFG.K_REGISTRY, json);
    _regDirty = false;
  } catch (e) { console.warn("[Holo] dp flush:", e); }
}

export function getRegistry() {
  if (!_regCache) _regCache = _readReg();
  return _regCache;
}

export function saveRegistry(list) {
  _regCache = list;
  _regDirty = true;
}

system.runInterval(_flushReg, 100);

function _genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ── Global placeholder cache (per update cycle) ──
let _gpl = null;
let _gplTick = -1;
let _players = null;

function _refreshGlobal() {
  const tick = system.currentTick;
  if (_gpl && _gplTick === tick) return;
  _players = world.getPlayers();
  const now = new Date(Date.now() + 7 * 3600_000);
  let day = "?";
  try { day = String(world.getAbsoluteTime() / 24000 | 0); } catch {}
  _gpl = {
    online: String(_players.length),
    time:   `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
    date:   `${now.getUTCDate()}/${now.getUTCMonth() + 1}/${now.getUTCFullYear()}`,
    day_count: day,
  };
  _gplTick = tick;
}

// ── Leaderboard: {top:obj:n} ──
const _lbCache = new Map();

function _resolveLeaderboard(obj, count) {
  const key = `${obj}:${count}`;
  const cached = _lbCache.get(key);
  if (cached && cached.tick === _gplTick) return cached.text;

  const n = Math.min(Math.max(count, 1), 10);
  let text = "";
  try {
    const sb = world.scoreboard.getObjective(obj);
    if (!sb) { text = "§8(scoreboard not found)"; }
    else {
      // Use getParticipants → filter real players only (skip fakePlayer/entity)
      const participants = sb.getParticipants();
      const scored = [];
      for (const p of participants) {
        try {
          // Filter: skip fake players & entities (commands.score, etc.)
          // Bedrock API: type is string "Player"/"FakePlayer"/"Entity"
          const t = String(p.type ?? "");
          if (t === "FakePlayer" || t === "Entity") continue;
          const s = sb.getScore(p);
          if (s === undefined) continue;
          scored.push({ name: p.displayName ?? "???", score: s });
        } catch {}
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, n);
      if (!top.length) { text = "§8(belum ada data)"; }
      else {
        const lines = [];
        for (let i = 0; i < top.length; i++) {
          const name  = top[i].name.slice(0, 14);
          const score = String(top[i].score);
          const rank  = String(i + 1).padStart(2, " ");
          if (i < 3) {
            const medal = i === 0 ? "§6" : i === 1 ? "§f" : "§c";
            lines.push(`${medal}#${rank} §f${name} §8- §e${score}`);
          } else {
            lines.push(`§7#${rank} §7${name} §8- §7${score}`);
          }
        }
        text = lines.join("\n");
      }
    }
  } catch { text = "§8(error)"; }

  _lbCache.set(key, { tick: _gplTick, text });
  if (_lbCache.size > 20) _lbCache.delete(_lbCache.keys().next().value);
  return text;
}

// ── Per-player: {my:obj}, {my_name} ──
function _findNearest(x, y, z, dimId) {
  if (!_players?.length) return null;
  let best = null, bestD = CFG.PROXIMITY_RANGE + 1;
  for (const p of _players) {
    try {
      if (p.dimension.id !== dimId) continue;
      const dx = p.location.x - x, dy = p.location.y - y, dz = p.location.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bestD) { best = p; bestD = d; }
    } catch {}
  }
  return best;
}

function _getScore(player, obj) {
  try {
    const sb = world.scoreboard.getObjective(obj);
    if (!sb) return "?";
    const identity = player.scoreboardIdentity;
    if (!identity) return "0";
    const score = sb.getScore(identity);
    return String(score ?? 0);
  } catch { return "?"; }
}

// ── Conditional: {day|A|B} ──
function _isDay() {
  try { const t = world.getTimeOfDay(); return t >= 0 && t < 12000; }
  catch { return true; }
}

// ── Master resolver (per line) ──
function _resolveLine(text, nearestPlayer) {
  if (text.indexOf("{") < 0) return text;

  text = text
    .replace(/\{online\}/g,    _gpl.online)
    .replace(/\{time\}/g,      _gpl.time)
    .replace(/\{date\}/g,      _gpl.date)
    .replace(/\{day_count\}/g, _gpl.day_count);

  text = text.replace(/\{top:([a-zA-Z_]\w*):(\d+)\}/g, (_m, obj, n) =>
    _resolveLeaderboard(obj, parseInt(n, 10))
  );

  if (text.indexOf("{my") >= 0) {
    if (nearestPlayer) {
      text = text.replace(/\{my_name\}/g, nearestPlayer.name ?? "???");
      text = text.replace(/\{my:([a-zA-Z_]\w*)\}/g, (_m, obj) => _getScore(nearestPlayer, obj));
    } else {
      text = text.replace(/\{my_name\}/g, "§8---");
      text = text.replace(/\{my:[a-zA-Z_]\w*\}/g, "§8-");
    }
  }

  text = text.replace(/\{day\|([^|]*)\|([^}]*)\}/g, (_m, a, b) => _isDay() ? a : b);
  return text;
}

// ── Alignment ──
function _stripCodes(s) { return s.replace(/§[0-9a-fk-or]/gi, ""); }

function _applyAlign(lines, align) {
  if (align === "center" || !align) return lines;
  const stripped = lines.map(l => _stripCodes(l));
  const maxLen = Math.max(...stripped.map(s => s.length), 1);
  return lines.map((line, i) => {
    const diff = maxLen - stripped[i].length;
    if (diff <= 0) return line;
    const pad = CFG.PAD_CHAR.repeat(Math.min(diff, CFG.PAD_MAX));
    if (align === "left")  return line + pad;
    if (align === "right") return pad + line;
    return line;
  });
}

export function sanitizeText(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, CFG.MAX_TEXT_LEN);
}

// ── Render all lines → single nameTag string ──
function _renderNameTag(entry, nearest) {
  let resolved = entry.lines.map(l => _resolveLine(l, nearest));
  // Expand leaderboard \n into separate visual lines
  const expanded = [];
  for (const l of resolved) {
    if (l.indexOf("\n") >= 0) { for (const sub of l.split("\n")) expanded.push(sub); }
    else expanded.push(l);
  }
  const aligned = _applyAlign(expanded, entry.align);
  return aligned.join("\n"); // single nameTag with newlines = unified background
}

// ── Entity management — 1 entity per hologram ──
function _queryHoloEntity(id) {
  const tag = CFG.TAG_ID + id;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const ents = world.getDimension(dimId).getEntities({ type: CFG.ENTITY_TYPE, tags: [tag] });
      for (const e of ents) return e; // return first match
    } catch {}
  }
  return null;
}

// Kill ALL holo entities with a specific id
function _killAllForId(id) {
  const tag = CFG.TAG_ID + id;
  let n = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const ents = world.getDimension(dimId).getEntities({ type: CFG.ENTITY_TYPE, tags: [tag] });
      for (const e of ents) { try { e.remove(); n++; } catch {} }
    } catch {}
  }
  return n;
}

// Kill ALL lt:hologram entities in ALL dimensions (clean slate for reload)
function _killAllHoloEntities() {
  let total = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const ents = world.getDimension(dimId).getEntities({
        type: CFG.ENTITY_TYPE, tags: [CFG.TAG_HOLO],
      });
      for (const e of ents) { try { e.remove(); total++; } catch {} }
    } catch {}
  }
  return total;
}

export function spawnHologram(entry) {
  try {
    const dim = world.getDimension(entry.dimId);
    _refreshGlobal();
    const nearest = _findNearest(entry.x, entry.y, entry.z, entry.dimId);
    const ent = dim.spawnEntity(CFG.ENTITY_TYPE, { x: entry.x, y: entry.y, z: entry.z });
    ent.addTag(CFG.TAG_HOLO);
    ent.addTag(CFG.TAG_ID + entry.id);
    ent.nameTag = _renderNameTag(entry, nearest);
    _pendingSpawn.delete(entry.id); // success — remove from pending
    return true;
  } catch (e) {
    // Chunk not loaded — queue for lazy retry
    if (String(e).indexOf("UnloadedChunk") >= 0 || String(e).indexOf("not in a chunk") >= 0) {
      _pendingSpawn.add(entry.id);
      return false;
    }
    console.warn("[Holo] spawn fail:", e);
    return false;
  }
}

export function despawnHologram(id) {
  return _killAllForId(id);
}

export function createHologram(lines, x, y, z, dimId, createdBy, template, anim, align, viewRange) {
  const reg = getRegistry();
  if (reg.length >= CFG.MAX_HOLOS) return { ok: false, err: "max_limit" };

  const id = _genId();
  const safe = lines.slice(0, CFG.MAX_LINES).map(l => sanitizeText(l));
  const entry = {
    id, lines: safe,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    z: Math.round(z * 100) / 100,
    dimId, template: template ?? null,
    anim: anim ?? "none",
    align: align ?? "center",
    viewRange: viewRange ?? CFG.VIEW_RANGE,
    by: createdBy, ts: Date.now(),
  };

  spawnHologram(entry);
  reg.push(entry);
  saveRegistry(reg);
  return { ok: true, id, entry };
}

export function duplicateHologram(id, newX, newY, newZ, dimId) {
  const reg = getRegistry();
  const src = reg.find(e => e.id === id);
  if (!src) return { ok: false, err: "not_found" };
  if (reg.length >= CFG.MAX_HOLOS) return { ok: false, err: "max_limit" };

  const newId = _genId();
  const entry = JSON.parse(JSON.stringify(src));
  entry.id = newId;
  entry.x = Math.round(newX * 100) / 100;
  entry.y = Math.round(newY * 100) / 100;
  entry.z = Math.round(newZ * 100) / 100;
  entry.dimId = dimId;
  entry.ts = Date.now();

  spawnHologram(entry);
  reg.push(entry);
  saveRegistry(reg);
  return { ok: true, id: newId, entry };
}

export function deleteHologram(id) {
  _pendingSpawn.delete(id);
  const n = despawnHologram(id);
  saveRegistry(getRegistry().filter(e => e.id !== id));
  return n;
}

export function editHologram(id, newLines) {
  const reg = getRegistry();
  const idx = reg.findIndex(e => e.id === id);
  if (idx < 0) return false;
  despawnHologram(id);
  reg[idx].lines = newLines.slice(0, CFG.MAX_LINES).map(l => sanitizeText(l));
  spawnHologram(reg[idx]);
  saveRegistry(reg);
  return true;
}

export function moveHologram(id, x, y, z) {
  const reg = getRegistry();
  const idx = reg.findIndex(e => e.id === id);
  if (idx < 0) return false;
  despawnHologram(id);
  reg[idx].x = Math.round(x * 100) / 100;
  reg[idx].y = Math.round(y * 100) / 100;
  reg[idx].z = Math.round(z * 100) / 100;
  spawnHologram(reg[idx]);
  saveRegistry(reg);
  return true;
}

export function setAlign(id, align) {
  const reg = getRegistry();
  const idx = reg.findIndex(e => e.id === id);
  if (idx < 0) return false;
  despawnHologram(id);
  reg[idx].align = align;
  spawnHologram(reg[idx]);
  saveRegistry(reg);
  return true;
}

export function addLine(id, text) {
  const reg = getRegistry();
  const idx = reg.findIndex(e => e.id === id);
  if (idx < 0 || reg[idx].lines.length >= CFG.MAX_LINES) return false;
  despawnHologram(id);
  reg[idx].lines.push(sanitizeText(text));
  spawnHologram(reg[idx]);
  saveRegistry(reg);
  return true;
}

export function removeLine(id, lineIndex) {
  const reg = getRegistry();
  const idx = reg.findIndex(e => e.id === id);
  if (idx < 0) return false;
  if (lineIndex < 0 || lineIndex >= reg[idx].lines.length) return false;
  if (reg[idx].lines.length <= 1) return false;
  despawnHologram(id);
  reg[idx].lines.splice(lineIndex, 1);
  spawnHologram(reg[idx]);
  saveRegistry(reg);
  return true;
}

export function nudgeHologram(id, dx, dy, dz) {
  const reg = getRegistry();
  const idx = reg.findIndex(e => e.id === id);
  if (idx < 0) return false;
  const e = reg[idx];
  e.x = Math.round((e.x + dx) * 100) / 100;
  e.y = Math.round((e.y + dy) * 100) / 100;
  e.z = Math.round((e.z + dz) * 100) / 100;
  const ent = _queryHoloEntity(id);
  if (ent) { try { ent.teleport({ x: e.x, y: e.y, z: e.z }); } catch {} }
  saveRegistry(reg);
  return true;
}

// ── Dynamic update loop ──
let _cycleTick = 0;

function _applyAnim(text, anim, offset) {
  if (anim === "cycle") {
    const c = CFG.CYCLE_COLORS[offset % CFG.CYCLE_COLORS.length];
    return text.replace(/^(§[0-9a-fk-or])+/, c);
  }
  return text;
}

function _hasViewerInRange(entry) {
  const raw = Number(entry.viewRange ?? CFG.VIEW_RANGE);
  const vr = Number.isFinite(raw) ? raw : CFG.VIEW_RANGE;
  if (vr <= 0) return true; // 0 = unlimited
  if (!_players?.length) return false;
  const vrSq = vr * vr;
  for (const p of _players) {
    try {
      if (p.dimension.id !== entry.dimId) continue;
      const dx = p.location.x - entry.x, dz = p.location.z - entry.z;
      if (dx * dx + dz * dz <= vrSq) return true;
    } catch {}
  }
  return false;
}

function _tickUpdate() {
  _cycleTick++;
  _refreshGlobal();
  const reg = getRegistry();
  if (!reg.length) return;

  for (const entry of reg) {
    // ── Lazy spawn: retry pending holograms when a player is nearby ──
    if (_pendingSpawn.has(entry.id)) {
      if (_hasViewerInRange(entry)) {
        spawnHologram(entry); // will remove from pending on success
      }
      continue; // skip update until spawned
    }

    const hasDyn  = entry.lines.some(l => l.indexOf("{") >= 0);
    const hasAnim = entry.anim && entry.anim !== "none";
    if (!hasDyn && !hasAnim) continue;
    if (!_hasViewerInRange(entry)) continue;

    const ent = _queryHoloEntity(entry.id);
    if (!ent) continue;

    const hasMyPh = entry.lines.some(l => l.indexOf("{my") >= 0);
    const nearest = hasMyPh ? _findNearest(entry.x, entry.y, entry.z, entry.dimId) : null;

    let tag = _renderNameTag(entry, nearest);
    if (hasAnim) tag = _applyAnim(tag, entry.anim, _cycleTick);
    if (ent.nameTag !== tag) ent.nameTag = tag;
  }
}

// Clean-slate respawn on world load — lazy: queue all, spawn only loaded chunks
function _respawnCheck() {
  const killed = _killAllHoloEntities();
  const reg = getRegistry();
  let spawned = 0, queued = 0;
  for (const entry of reg) {
    if (spawnHologram(entry)) spawned++;
    else queued++;
  }
  if (reg.length > 0 || killed > 0) {
    console.warn(`[Holo] init: killed=${killed} spawned=${spawned} queued=${queued}`);
  }
}

system.runTimeout(_respawnCheck, CFG.RESPAWN_DELAY);
system.runInterval(_tickUpdate, CFG.UPDATE_INTERVAL);
