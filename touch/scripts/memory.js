/** Persistent scene memory and snapshot signatures for Touch. */
import { MODULE_ID } from "./constants.js";

export const MEMORY_KEY = "memory";
export const IDENTITY_KEY = "identity";
export const MAX_CELLS = 2000;
const FLUSH_DEBOUNCE = 2000;

function newCell(now, what) {
  return {
    pings: 0,
    traces: 0,
    echos: 0,
    firstSeen: now,
    lastSeen: now,
    lastWhat: what ?? null,
    lastLabel: null,
    heat: 0,
  };
}

export function cellKeyFor(x, y, storey) {
  return `cell.${Math.round(x / 100)},${Math.round(y / 100)}@${storey}`;
}

function retentionSeconds() {
  return Math.max(0, Number(game.settings.get(MODULE_ID, "memoryRetention")) || 0);
}

function heatOf(ts, now) {
  const retention = retentionSeconds();
  if (retention <= 0) return 1;
  return Math.max(0, 1 - (now - ts) / 1000 / retention);
}

export class NodeMemory {
  constructor() {
    this.cells = new Map();
    this.sceneId = null;
    this._scene = null;
    this._flushTimer = null;
    this._dirty = false;
    this._tracks = null;
  }

  attachTracks(registry) {
    this._tracks = registry;
  }

  load(scene) {
    this.sceneId = scene?.id ?? null;
    this._scene = scene ?? null;
    this.cells.clear();
    const raw = scene?.getFlag(MODULE_ID, MEMORY_KEY)?.cells;
    if (raw && typeof raw === "object") {
      for (const [key, value] of Object.entries(raw)) {
        if (value && typeof value === "object") this.cells.set(key, { ...value });
      }
    }
  }

  #observe(key, kind, label, weight = 1, trackId = null) {
    const now = Date.now();
    let cell = this.cells.get(key);
    if (!cell) {
      if (this.cells.size >= MAX_CELLS) this.#evictColdest();
      cell = newCell(now, kind);
      this.cells.set(key, cell);
    }
    if (kind === "ping") cell.pings += weight;
    if (kind === "trace") cell.traces += weight;
    if (kind === "echo") cell.echos += weight;
    cell.lastSeen = now;
    cell.lastWhat = kind;
    if (label) cell.lastLabel = label;
    if (trackId) {
      cell.lastTrackId = trackId;
      cell.tracks = Array.isArray(cell.tracks) ? cell.tracks : [];
      if (!cell.tracks.includes(trackId)) cell.tracks.push(trackId);
      if (cell.tracks.length > 8) cell.tracks.shift();
    }
    cell.heat = Math.min(1, (cell.heat ?? 0) + 0.34 * weight);
    this._dirty = true;
    this.scheduleFlush();
  }

  recordPing(x, y, storey = 0, label = null, trackId = null) {
    this.#observe(cellKeyFor(x, y, storey), "ping", label, 1, trackId);
  }

  recordTrace(x, y, storey = 0, label = null, trackId = null) {
    this.#observe(cellKeyFor(x, y, storey), "trace", label, 1, trackId);
  }

  recordEcho(monitorId, x, y, storey = 0, label = null) {
    this.#observe(`mon.${monitorId}`, "echo", label);
    this.#observe(cellKeyFor(x, y, storey), "echo", label);
  }

  at(key) {
    const cell = this.cells.get(key);
    if (!cell) return null;
    const currentHeat = Math.min(1, cell.heat * heatOf(cell.lastSeen, Date.now()));
    return { key, ...cell, currentHeat };
  }

  atPosition(x, y, storey = 0) {
    return this.at(cellKeyFor(x, y, storey));
  }

  atMonitor(monitorId) {
    return this.at(`mon.${monitorId}`);
  }

  map() {
    const now = Date.now();
    const retention = retentionSeconds();
    const result = [];
    for (const [key, cell] of this.cells) {
      if (retention > 0 && now - cell.lastSeen > retention * 1000) {
        this.cells.delete(key);
        this._dirty = true;
        continue;
      }
      result.push({ key, ...cell, currentHeat: Math.min(1, cell.heat * heatOf(cell.lastSeen, now)) });
    }
    return result;
  }

  #evictColdest() {
    let coldestKey = null;
    let coldestHeat = Infinity;
    const now = Date.now();
    for (const [key, cell] of this.cells) {
      const heat = cell.heat * heatOf(cell.lastSeen, now);
      if (heat < coldestHeat) {
        coldestHeat = heat;
        coldestKey = key;
      }
    }
    if (coldestKey) this.cells.delete(coldestKey);
  }

  scheduleFlush() {
    if (this._flushTimer || !this._dirty) return;
    this._flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE);
    this._flushTimer.unref?.();
  }

  async flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty || !this.sceneId) return;
    const scene = this._scene?.id === this.sceneId
      ? this._scene
      : game.scenes?.get?.(this.sceneId) ?? canvas?.scenes?.get?.(this.sceneId);
    if (!scene) return;
    const cells = Object.fromEntries(this.cells);
    const payload = { cells };
    if (this._tracks) {
      payload.tracks = this._tracks.serialize();
      payload.groups = this._tracks.serializeGroups();
    }
    await scene.setFlag(MODULE_ID, MEMORY_KEY, payload);
    this._dirty = false;
  }

  async clear() {
    this.cells.clear();
    this._tracks?.tracks.clear();
    this._tracks?.groups.clear();
    this._dirty = true;
    await this.flush();
  }
}

export function heatColor(heat) {
  if (heat <= 0.5) {
    const t = heat / 0.5;
    return `rgb(${Math.round(0x5e + (0xfb - 0x5e) * t)}, ${Math.round(0xea + (0xbf - 0xea) * t)}, ${Math.round(0xd4 + (0x24 - 0xd4) * t)})`;
  }
  const t = (heat - 0.5) / 0.5;
  return `rgb(${Math.round(0xfb + (0xf8 - 0xfb) * t)}, ${Math.round(0xbf + (0x71 - 0xbf) * t)}, ${Math.round(0x24 + (0x71 - 0x24) * t)})`;
}

export function captureSignature(doc) {
  if (!doc) return null;
  return {
    name: String(doc.name ?? "").trim().toLowerCase(),
    w: Math.round((doc.width ?? 1) * 100) / 100,
    h: Math.round((doc.height ?? 1) * 100) / 100,
    disp: doc.disposition ?? null,
    elev: Math.round((doc.elevation ?? 0) * 10) / 10,
    actor: doc.actorId ?? doc.actor?.id ?? null,
    tex: typeof doc.texture?.src === "string" ? doc.texture.src : (doc.textureSrc ?? null),
  };
}

export function signatureSimilarity(a, b) {
  if (!a || !b) return 0;
  if ((a.actor && a.actor === b.actor) || (a.tex && a.tex === b.tex)) return 1;
  let score = 0;
  if (a.name && a.name === b.name) score += 0.35;
  else if (a.name && b.name && (a.name.includes(b.name) || b.name.includes(a.name))) score += 0.22;
  const areaA = (a.w ?? 1) * (a.h ?? 1);
  const areaB = (b.w ?? 1) * (b.h ?? 1);
  score += 0.3 * Math.max(0, 1 - Math.abs(areaA - areaB) / Math.max(areaA, areaB, 0.01));
  if (a.disp !== undefined && a.disp === b.disp) score += 0.2;
  score += 0.15 * Math.max(0, 1 - Math.abs((a.elev ?? 0) - (b.elev ?? 0)) / 5);
  return Math.min(1, Math.round(score * 1e6) / 1e6);
}
