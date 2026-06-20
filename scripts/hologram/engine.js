import { world, system, ScoreboardIdentityType } from "@minecraft/server";
import { HOLO_CFG as CFG } from "./config.js";
import { getLeaderboard } from "../gacha/utils/leaderboard.js";
import { isPurgeActive } from "../purge_gate.js";

let _regCache = null;
let _regDirty = false;
let _purgeWasActive = false; // tracks purge state transition
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

// Mapping hologram placeholder → gacha leaderboard sort key + display info
// Semua data dari Player Registry (online+offline) via getLeaderboard()
const LB_GACHA_MAP = {
  coin:     { sortBy: "coin",       unit: "",   col: "§e", valKey: "coin" },
  gem:      { sortBy: "gem",        unit: "",   col: "§b", valKey: "gem" },
  partikel: { sortBy: "ptCount",    unit: " PT", col: "§5", valKey: "ptCount" },
  ptcount:  { sortBy: "ptCount",    unit: " PT", col: "§5", valKey: "ptCount" },
  pulls:    { sortBy: "totalPulls", unit: "x",  col: "§e", valKey: "totalPulls" },
  ptpulls:  { sortBy: "ptPulls",    unit: "x",  col: "§d", valKey: "ptPulls" },
  eqpulls:  { sortBy: "eqPulls",    unit: "x",  col: "§6", valKey: "eqPulls" },
};

const _fmt = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function _formatLbLines(top, unit) {
  const lines = [];
  const ranks = ["§6", "§f", "§c"]; // gold, silver, bronze
  for (let i = 0; i < top.length; i++) {
    const name  = top[i].name.slice(0, 14);
    const score = _fmt(top[i].score);
    const su    = unit ? ` ${unit}` : "";
    const rc    = ranks[i] ?? "§7";
    const num   = i < 3 ? `§l#${i + 1}` : ` ${i + 1}.`;
    lines.push(`${rc}${num} §r§f${name} §8» ${rc}${score}${su}`);
  }
  return lines;
}

function _resolveLeaderboard(obj, count) {
  const key = `${obj}:${count}`;
  const cached = _lbCache.get(key);
  if (cached && cached.tick === _gplTick) return cached.text;

  const n = Math.min(Math.max(count, 1), 10);
  let text = "";
  try {
    const gachaMapping = LB_GACHA_MAP[obj.toLowerCase()];

    if (gachaMapping) {
      // ── Economy leaderboard: use gacha getLeaderboard (online+offline) ──
      const entries = getLeaderboard(gachaMapping.sortBy, n);
      if (!entries.length) { text = "§8(belum ada data)"; }
      else {
        const scored = entries.map(e => ({
          name: e.name,
          score: e[gachaMapping.valKey] ?? 0,
        }));
        text = _formatLbLines(scored, gachaMapping.unit).join("\n");
      }

    } else {
      // ── Other objectives: fallback to scoreboard API ──
      const sb = world.scoreboard.getObjective(obj);
      if (!sb) { text = "§8(scoreboard not found)"; }
      else {
        const scores = sb.getScores();
        const scored = [];
        for (const info of scores) {
          try {
            const p = info.participant;
            try { if (p.type === ScoreboardIdentityType.Entity) continue; } catch {}
            const ts = String(p.type ?? "");
            if (ts === "Entity") continue;
            const dn = p.displayName ?? "";
            if (dn.length === 0 || dn.length > 20) continue;
            if (dn.startsWith("command.") || dn.includes(".scoreboard.")) continue;
            const s = info.score;
            if (s === undefined || s === null) continue;
            scored.push({ name: dn, score: s });
          } catch {}
        }
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, n);
        if (!top.length) { text = "§8(belum ada data)"; }
        else { text = _formatLbLines(top, "").join("\n"); }
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

  // Animated separator — initial resolve (expanded to rainbow wave by _applyAlign)
  if (text === "{hr}") {
    const tick = (system.currentTick ?? 0);
    const pal = CFG.HR_PALETTES[Math.floor(tick / 100) % CFG.HR_PALETTES.length];
    const c = pal[Math.floor(tick / 40) % pal.length];
    return `${c}━━━━━━━━━━━━━━━━━━`;
  }

  return text;
}

// ── Alignment ──
function _stripCodes(s) { return s.replace(/§[0-9a-fk-or]/gi, ""); }

// Simple alignment — center: natural width, left/right: pad to max
function _applyAlign(lines, align) {
  if (align === "center" || !align) return lines;
  const stripped = lines.map(l => _stripCodes(l));
  const maxLen = Math.max(...stripped.map(s => s.length), 1);
  return lines.map((line, i) => {
    const diff = maxLen - stripped[i].length;
    if (diff <= 0) return line;
    const pad = Math.min(diff, CFG.PAD_MAX);
    if (align === "left") return line + " ".repeat(pad);
    if (align === "right") return " ".repeat(pad) + line;
    return line;
  });
}

export function sanitizeText(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, CFG.MAX_TEXT_LEN);
}

// ── Render all lines → array of resolved line strings ──
function _renderLines(entry, nearest) {
  let resolved = entry.lines.map(l => _resolveLine(l, nearest));
  const expanded = [];
  for (const l of resolved) {
    if (l.indexOf("\n") >= 0) { for (const sub of l.split("\n")) expanded.push(sub); }
    else expanded.push(l);
  }
  // Filter empty lines — each line is a separate entity, empty = wasted BG
  const filtered = expanded.filter(l => l.replace(/§[0-9a-fk-or]/gi, "").trim().length > 0);
  return _applyAlign(filtered, entry.align);
}

// ── Entity management — 1 entity per line ──
function _queryHoloEntity(id, dimId) {
  const tag = CFG.TAG_ID + id;
  const dims = dimId ? [dimId] : ["overworld", "nether", "the_end"];
  for (const d of dims) {
    try {
      const ents = world.getDimension(d).getEntities({ type: CFG.ENTITY_TYPE, tags: [tag] });
      for (const e of ents) return e;
    } catch {}
  }
  return null;
}

function _queryHoloEntities(id, dimId) {
  const tag = CFG.TAG_ID + id;
  const result = [];
  const dims = dimId ? [dimId] : ["overworld", "nether", "the_end"];
  for (const d of dims) {
    try {
      const ents = world.getDimension(d).getEntities({ type: CFG.ENTITY_TYPE, tags: [tag] });
      for (const e of ents) result.push(e);
    } catch {}
  }
  return result;
}

// Kill ALL holo entities with a specific id
function _killAllForId(id, dimId) {
  const tag = CFG.TAG_ID + id;
  let n = 0;
  const dims = dimId ? [dimId] : ["overworld", "nether", "the_end"];
  for (const d of dims) {
    try {
      const ents = world.getDimension(d).getEntities({ type: CFG.ENTITY_TYPE, tags: [tag] });
      for (const e of ents) { try { e.remove(); n++; } catch {} }
    } catch {}
  }
  return n;
}

// Kill ALL lt:hologram entities in ALL dimensions (clean slate for reload)
// Query by type only (not tags) — catches orphaned entities whose tags
// were lost during chunk unload/reload (Bedrock bug).
function _killAllHoloEntities() {
  let total = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const ents = world.getDimension(dimId).getEntities({ type: CFG.ENTITY_TYPE });
      for (const e of ents) { try { e.remove(); total++; } catch {} }
    } catch {}
  }
  return total;
}

export function spawnHologram(entry) {
  try {
    _killAllForId(entry.id);
    const dim = world.getDimension(entry.dimId);
    _refreshGlobal();
    const nearest = _findNearest(entry.x, entry.y, entry.z, entry.dimId);
    const lines = _renderLines(entry, nearest);

    // Offset upward so hologram center stays at entry.y
    // This prevents bottom lines from clipping into terrain
    const totalHeight = (lines.length - 1) * CFG.LINE_GAP;
    const topY = entry.y + (totalHeight / 2);

    for (let i = 0; i < lines.length; i++) {
      const y = topY - (i * CFG.LINE_GAP);
      const ent = dim.spawnEntity(CFG.ENTITY_TYPE, { x: entry.x, y, z: entry.z });
      ent.addTag(CFG.TAG_HOLO);
      ent.addTag(CFG.TAG_ID + entry.id);
      ent.nameTag = lines[i];
    }

    _pendingSpawn.delete(entry.id);
    return true;
  } catch (e) {
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
  // Teleport all line entities
  for (const ent of _queryHoloEntities(id)) {
    try {
      const loc = ent.location;
      ent.teleport({ x: loc.x + dx, y: loc.y + dy, z: loc.z + dz });
    } catch {}
  }
  saveRegistry(reg);
  return true;
}

// ── Dynamic update helpers ──
let _cycleTick = 0;
let _dataCycle = 0; // increments each _dataTick — used for tiered refresh

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
  if (vr <= 0) return true;
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

// ── Cached render state per hologram (updated by _dataTick) ──
const _renderCache = new Map(); // id → { ents, lines }

// Generate animated separator with rotating palettes
function _buildWave(len) {
  const tick = (system.currentTick ?? 0);
  const palettes = CFG.HR_PALETTES;
  // Switch palette every ~30 seconds
  const colors = palettes[Math.floor(tick / 600) % palettes.length];
  const cl = colors.length;
  // Smooth wave — shift 1 position per second
  const offset = Math.floor(tick / 20);
  // Alternate direction every ~15 seconds
  const goRight = Math.floor(tick / 300) % 2 === 0;
  let wave = "";
  for (let j = 0; j < len; j++) {
    const ci = goRight
      ? (j + offset) % cl
      : (len - j + offset) % cl;
    wave += colors[ci] + "━";
  }
  return wave;
}

function _animTick() {
  if (_purgeWasActive) return; // entities despawned during purge
  for (const [id, cache] of _renderCache) {
    const { ents, lines } = cache;
    if (!ents.length) continue;
    for (let i = 0; i < ents.length && i < lines.length; i++) {
      try {
        if (!lines[i].includes("━")) continue;
        const sepLen = _stripCodes(lines[i]).length;
        const wave = _buildWave(sepLen);
        if (ents[i].nameTag !== wave) ents[i].nameTag = wave;
      } catch {}
    }
  }
}

// ── Slow data tick: tiered resolve (leaderboard, scores, placeholders) ──
function _dataTick() {
  // ── Purge gate: despawn during Purge, respawn when it ends ──
  const purgeNow = isPurgeActive();
  if (purgeNow) {
    if (!_purgeWasActive) {
      const killed = _killAllHoloEntities();
      _renderCache.clear();
      _purgeWasActive = true;
      console.warn(`[Holo] Purge ON — despawned ${killed} holo entities`);
    }
    return;
  }
  if (_purgeWasActive) {
    _purgeWasActive = false;
    const reg = getRegistry();
    let spawned = 0;
    for (const entry of reg) {
      if (spawnHologram(entry)) spawned++;
    }
    console.warn(`[Holo] Purge OFF — respawned ${spawned}/${reg.length} holos`);
  }

  _cycleTick++;
  _dataCycle++;
  _refreshGlobal();
  const reg = getRegistry();
  if (!reg.length) { _renderCache.clear(); return; }

  // Tiered refresh: determine which tiers run this cycle
  const runMedium = (_dataCycle % CFG.TIER_MEDIUM) === 0; // {my:...} every 10s
  const runSlow   = (_dataCycle % CFG.TIER_SLOW) === 0;   // {top:...} every 30s

  const activeIds = new Set();
  for (const entry of reg) {
    activeIds.add(entry.id);

    if (_pendingSpawn.has(entry.id)) {
      if (_hasViewerInRange(entry)) spawnHologram(entry);
      continue;
    }

    // ── OPT-2: Classify placeholder types for tiered refresh ──
    const hasHr    = entry.lines.some(l => l === "{hr}");
    const hasTop   = entry.lines.some(l => l.indexOf("{top:") >= 0);
    const hasMy    = entry.lines.some(l => l.indexOf("{my") >= 0);
    const hasFast  = entry.lines.some(l => l !== "{hr}" && l.indexOf("{") >= 0 && l.indexOf("{top:") < 0 && l.indexOf("{my") < 0);
    const hasAnim  = entry.anim && entry.anim !== "none";
    const hasDyn   = hasTop || hasMy || hasFast;

    // Pure static (no placeholders, no animation) → skip
    if (!hasDyn && !hasAnim && !hasHr) continue;

    // HR-only (no data placeholders) → just ensure cache for _animTick
    if (!hasDyn && !hasAnim && hasHr) {
      if (!_renderCache.has(entry.id) && _hasViewerInRange(entry)) {
        const ents = _queryHoloEntities(entry.id, entry.dimId);
        if (ents.length) {
          const lines = _renderLines(entry, null);
          _renderCache.set(entry.id, { ents, lines });
        }
      }
      continue;
    }

    // ── Tiered refresh: skip if not this tier's turn ──
    // If holo only has {top:...} → only resolve on slow cycles
    // If holo only has {my:...} → only resolve on medium cycles
    // If holo has {time}/{online}/fast → always resolve
    if (!hasFast && !hasAnim) {
      if (hasTop && !hasMy && !runSlow) continue;
      if (hasMy && !hasTop && !runMedium) continue;
      if (hasTop && hasMy && !runSlow && !runMedium) continue;
    }

    if (!_hasViewerInRange(entry)) continue;

    // ── OPT-4: Reuse cached entity refs if valid ──
    const cached = _renderCache.get(entry.id);
    let ents;
    if (cached && cached.ents.length > 0) {
      try {
        if (cached.ents[0].isValid) {
          ents = cached.ents;
        } else {
          ents = _queryHoloEntities(entry.id, entry.dimId);
        }
      } catch {
        ents = _queryHoloEntities(entry.id, entry.dimId);
      }
    } else {
      ents = _queryHoloEntities(entry.id, entry.dimId); // OPT-1: single dim
    }
    if (!ents.length) continue;

    const hasMyPh = hasMy;
    const nearest = hasMyPh ? _findNearest(entry.x, entry.y, entry.z, entry.dimId) : null;

    const lines = _renderLines(entry, nearest);

    ents.sort((a, b) => {
      try { return b.location.y - a.location.y; } catch { return 0; }
    });

    // Update nameTags — skip separators (handled by _animTick)
    for (let i = 0; i < ents.length && i < lines.length; i++) {
      try {
        if (lines[i].includes("━")) continue;
        let tag = lines[i];
        if (hasAnim) tag = _applyAnim(tag, entry.anim, _cycleTick);
        if (ents[i].nameTag !== tag) ents[i].nameTag = tag;
      } catch {}
    }
    _renderCache.set(entry.id, { ents, lines, align: entry.align });
  }

  // Cleanup stale cache
  for (const id of _renderCache.keys()) {
    if (!activeIds.has(id)) _renderCache.delete(id);
  }
}

// Clean-slate respawn on world load
function _respawnCheck() {
  const killed = _killAllHoloEntities();
  const reg = getRegistry();
  let spawned = 0, queued = 0;
  for (const entry of reg) {
    if (spawnHologram(entry)) spawned++;
    else queued++;
  }
  // Init log suppressed — covered by unified banner
}

system.runTimeout(_respawnCheck, CFG.RESPAWN_DELAY);
system.runInterval(_animTick, CFG.ANIM_INTERVAL); // fast: separator animation
system.runInterval(_dataTick, CFG.DATA_INTERVAL);  // slow: full data refresh
