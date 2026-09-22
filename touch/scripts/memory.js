/**
 * Touch — sonar node memory.
 * Persistent per-coordinate memory: every lattice node, corner monitor, and
 * plan grid cell remembers what its sonar has observed — ping counts, surface
 * traces (what broke a pathway, and when), and echo returns at corner
 * monitors — with a decaying "heat" value so stale history fades over a
 * configurable retention window.
 *
 * Memory lives in the scene flag `touch.memory.cells` (keyed by coordinate
 * cell) and is written debounced (2s) so bursts of activity coalesce into
 * one flag write. It survives scene saves, reloads, and copies with the
 * scene. Cell keys are grid-quantized (`cell.<gx>,<gy>@<storey>`) so nearby
 * observations aggregate; corner monitors additionally index their exact
 * waypoint id (`mon.<waypointId>`).
 */
import { MODULE_ID } from "./constants.js";

const MEMORY_KEY = "memory";
const IDENTITY_KEY = "identity"; // permanent per-document identity flag
/** Debounce window for flag writes (ms). */
const FLUSH_DEBOUNCE = 2000;
/** Hard cap on remembered cells (protects flag size). */
export const MAX_CELLS = 2000;

/** Default memory entry. */
function newCell(now, what) {
  return {
    pings: 0,
    traces: 0,
    echos: 0,
    firstSeen: now,
    lastSeen: now,
    lastWhat: what ?? null,   // "ping" | "trace" | "echo"
    lastLabel: null,          // name of the last thing observed
    heat: 0,
  };
}

/** Quantize scene px to a grid cell (grid size = 100px ~ one square). */
function cellKey(x, y, storey) {
  const gx = Math.round(x / 100);
  const gy = Math.round(y / 100);
  return `cell.${gx},${gy}@${storey}`;
}

/** Cell-key helper shared with the track registry. */
function cellKeyFor(x, y, storey) {
  return cellKey(x, y, storey);
}

/** Retention window in seconds (0 = forever). */
function retentionSeconds() {
  return Math.max(0, Number(game.settings.get(MODULE_ID, "memoryRetention")) || 0);
}

/** Current heat multiplier for an observation made at `ts` (1 → 0). */
function heatOf(ts, now) {
  const ret = retentionSeconds();
  if (ret <= 0) return 1; // never fades
  const age = (now - ts) / 1000;
  return Math.max(0, 1 - age / ret);
}

export class NodeMemory {
  constructor() {
    this.cells = new Map();     // key → cell record
    this.sceneId = null;
    this._scene = null;         // last loaded scene (write fallback)
    this._flushTimer = null;
    this._dirty = false;
    this._tracks = null;        // TrackRegistry (optional, persisted together)
  }

  /** Attach a track registry whose state persists with the same flag. */
  attachTracks(registry) {
    this._tracks = registry;
  }

  /** Load persisted cells from a scene flag (replacing current state). */
  load(scene) {
    this.sceneId = scene?.id ?? null;
    this._scene = scene ?? null; // kept as a write target fallback
    this.cells.clear();
    const raw = scene?.getFlag(MODULE_ID, MEMORY_KEY)?.cells;
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === "object") this.cells.set(k, { ...v });
      }
    }
  }

  /** Merge one observation into a cell. */
  #observe(key, kind, label, weight = 1, trackId = null) {
    const now = Date.now();
    let cell = this.cells.get(key);
    if (!cell) {
      if (this.cells.size >= MAX_CELLS) this.#evictColdest();
      cell = newCell(now, kind);
      this.cells.set(key, cell);
    }
    if (kind === "ping") cell.pings += weight;
    else if (kind === "trace") cell.traces += weight;
    else if (kind === "echo") cell.echos += weight;
    cell.lastSeen = now;
    cell.lastWhat = kind;
    if (label) cell.lastLabel = label;
    // Track link: the continuing event this observation belongs to.
    if (trackId) {
      cell.lastTrackId = trackId;
      cell.tracks = Array.isArray(cell.tracks) ? cell.tracks : [];
      if (!cell.tracks.includes(trackId)) {
        cell.tracks.push(trackId);
        if (cell.tracks.length > 8) cell.tracks.shift();
      }
    }
    // Heat: refreshed observations heat the cell up; old ones cool via heatAt.
    cell.heat = Math.min(1, (cell.heat ?? 0) + 0.34 * weight);
    this._dirty = true;
    this.scheduleFlush();
  }

  /** Record a ping at a scene position. */
  recordPing(x, y, storey = 0, label = null, trackId = null) {
    this.#observe(cellKey(x, y, storey), "ping", label, 1, trackId);
  }

  /** Record a surface trace (pathway × object) at a scene position. */
  recordTrace(x, y, storey = 0, label = null, trackId = null) {
    this.#observe(cellKey(x, y, storey), "trace", label, 1, trackId);
  }

  /** Record an echo return at a corner monitor (exact node memory). */
  recordEcho(monitorId, x, y, storey = 0, label = null) {
    this.#observe(`mon.${monitorId}`, "echo", label);
    // Also warm the plan cell around the monitor.
    this.#observe(cellKey(x, y, storey), "echo", label);
  }

  /**
   * Read one cell's memory with computed current heat.
   * @returns {object|null}
   */
  at(key) {
    const cell = this.cells.get(key);
    if (!cell) return null;
    const now = Date.now();
    return { key, ...cell, currentHeat: Math.min(1, cell.heat * heatOf(cell.lastSeen, now)) };
  }

  /** Memory for a scene position (grid cell). */
  atPosition(x, y, storey = 0) {
    return this.at(cellKey(x, y, storey));
  }

  /** Memory for a corner monitor by waypoint id. */
  atMonitor(monitorId) {
    return this.at(`mon.${monitorId}`);
  }

  /**
   * The full memory map, pruned: expired cells dropped (unless retention is
   * forever) or flattened to zero heat, and capped in size.
   * @returns {Array<{key, pings, traces, echos, lastSeen, lastWhat, lastLabel, currentHeat}>}
   */
  map() {
    const now = Date.now();
    const ret = retentionSeconds();
    const out = [];
    for (const [key, cell] of this.cells) {
      if (ret > 0 && now - cell.lastSeen > ret * 1000) {
        this.cells.delete(key); // retention window passed — forgotten
        this._dirty = true;
        continue;
      }
      out.push({ key, ...cell, currentHeat: Math.min(1, cell.heat * heatOf(cell.lastSeen, now)) });
    }
    return out;
  }

  /** Evict the coldest cell when the store is full. */
  #evictColdest() {
    let coldestKey = null;
    let coldest = Infinity;
    const now = Date.now();
    for (const [key, cell] of this.cells) {
      const h = cell.heat * heatOf(cell.lastSeen, now);
      if (h < coldest) {
        coldest = h;
        coldestKey = key;
      }
    }
    if (coldestKey) this.cells.delete(coldestKey);
  }

  /** Schedule the debounced flag write. */
  scheduleFlush() {
    if (this._flushTimer || !this._dirty) return;
    this._flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE);
    this._flushTimer.unref?.();
  }

  /** Persist cells to the scene flag immediately. */
  async flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty || !this.sceneId) return;
    const scene =
      this._scene?.id === this.sceneId ? this._scene :
      game.scenes?.get?.(this.sceneId) ?? canvas?.scenes?.get?.(this.sceneId);
    if (!scene) return;
    const obj = {};
    for (const [k, v] of this.cells) obj[k] = v;
    const payload = { cells: obj };
    if (this._tracks) {
      payload.tracks = this._tracks.serialize();
      payload.groups = this._tracks.serializeGroups();
    }
    await scene.setFlag(MODULE_ID, MEMORY_KEY, payload);
    this._dirty = false;
  }

  /** Wipe all memory (persisted immediately). */
  async clear() {
    this.cells.clear();
    this._tracks?.tracks.clear();
    this._tracks?.groups.clear();
    this._dirty = true;
    await this.flush();
  }
}

/** Heat color for a memory heat 0..1 (teal → amber → red). */
export function heatColor(h) {
  if (h <= 0.5) {
    // teal (0x5eead4) → amber (0xfbbf24)
    const t = h / 0.5;
    return `rgb(${Math.round(0x5e + (0xfb - 0x5e) * t)}, ${Math.round(0xea + (0xbf - 0xea) * t)}, ${Math.round(0xd4 + (0x24 - 0xd4) * t)})`;
  }
  // amber (0xfbbf24) → red (0xf87171)
  const t = (h - 0.5) / 0.5;
  return `rgb(${Math.round(0xfb + (0xf8 - 0xfb) * t)}, ${Math.round(0xbf + (0x71 - 0xbf) * t)}, ${Math.round(0x24 + (0x71 - 0x24) * t)})`;
}

// ------------------------------------------------------------------ tracks

/**
 * Persistent *tracks*: when an object crosses a zone (pathway/waypoint
 * beam), it is stamped with a persistent flag on its document and every
 * later zone it touches links into the same track — so its path reads as
 * one continuing event across the whole grid, not isolated blips.
 *
 * The track registry is persisted alongside cell memory in the scene flag
 * `touch.memory` under `tracks` (id → { label, color, created, points[],
 * cells[], active }). Track flags on tokens (`flags.touch.trackId`) are
 * session-wide and survive reloads; the registry is pruned by the same
 * retention window as cell memory.
 */
const MAX_TRACKS = 200;
/** A track goes quiet after this long without a new observation (ms). */
const TRACK_STALE_MS = 10 * 60 * 1000;

/** Groups: tracks march together while their motion vectors agree. */
const GROUP_SPEED_PX_S = 30;  // ± speed agreement (px/s)
const GROUP_DEG = 15;         // ± heading agreement (degrees)
const GROUP_STALE_MS = 5 * 60 * 1000; // a group dissolves after this quiet
const GROUP_VECTOR_FRESH_MS = 30 * 1000; // membership needs fresh observations
const MAX_GROUPS = 64;

/** Stable new group id. */
function newGroupId() {
  return `grp.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Stable new track id. */
function newTrackId() {
  return `trk.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Capture a "sonar snapshot" of an object: the persistent identity image its
 * track flag is tied to. Deliberately ignores position (that changes) and
 * captures what a sonar contact can recognize: name, footprint size,
 * disposition, elevation band, and its actor/texture link when present.
 * @returns {object} plain JSON snapshot
 */
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

/**
 * Similarity between two snapshots, 0..1 (1 = same object).
 * Strong identity links (same actor/texture) short-circuit to a match.
 */
export function signatureSimilarity(a, b) {
  if (!a || !b) return 0;
  // Same actor or same texture → same creature, whatever else drifted.
  if ((a.actor && a.actor === b.actor) || (a.tex && a.tex === b.tex)) return 1;
  let score = 0;
  // Name (0.35): exact after normalization, or one containing the other.
  if (a.name && a.name === b.name) score += 0.35;
  else if (a.name && b.name && (a.name.includes(b.name) || b.name.includes(a.name))) score += 0.22;
  // Footprint (0.3): how close the sizes are.
  const aw = (a.w ?? 1) * (a.h ?? 1);
  const bw = (b.w ?? 1) * (b.h ?? 1);
  score += 0.3 * Math.max(0, 1 - Math.abs(aw - bw) / Math.max(aw, bw, 0.01));
  // Disposition (0.2).
  if (a.disp !== undefined && a.disp === b.disp) score += 0.2;
  // Elevation band (0.15): within half a storey.
  score += 0.15 * Math.max(0, 1 - Math.abs((a.elev ?? 0) - (b.elev ?? 0)) / 5);
  // Quantize: identical images must score exactly 1 (float noise otherwise).
  return Math.min(1, Math.round(score * 1e6) / 1e6);
}

export class TrackRegistry {
  constructor(nodeMemory) {
    this.mem = nodeMemory;      // share flush/scene plumbing
    this.tracks = new Map();    // id → track record
    this.groups = new Map();    // id → group record (shared contacts)
    this._loadDebounce = null;
  }

  /** Snapshot-match tolerance (0..1; similarity ≥ 1−tolerance = same object). */
  get tolerance() {
    const t = Number(game.settings.get(MODULE_ID, "trackMatchTolerance"));
    return Number.isFinite(t) ? Math.max(0, Math.min(0.9, t)) : 0.25;
  }

  /** Load the persisted registry from the scene flag. */
  load(scene) {
    this.tracks.clear();
    this.groups.clear();
    const flag = scene?.getFlag(MODULE_ID, MEMORY_KEY);
    const raw = flag?.tracks;
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === "object") this.tracks.set(k, { ...v, points: [...(v.points ?? [])], cells: [...(v.cells ?? [])] });
      }
    }
    const rawGroups = flag?.groups;
    if (rawGroups && typeof rawGroups === "object") {
      for (const [k, v] of Object.entries(rawGroups)) {
        if (v && typeof v === "object") {
          this.groups.set(k, { ...v, memberIds: [...(v.memberIds ?? [])], events: [...(v.events ?? [])] });
        }
      }
    }
  }

  /**
   * The track id stamped on a document, if any.
   * @param {object} doc  token document
   * @returns {string|null}
   */
  trackIdOf(doc) {
    return doc?.getFlag?.(MODULE_ID, "trackId") ?? null;
  }

  /**
   * The identity id explicitly assigned to a document, if any. Falls back to
   * the crossing stamp: both flag paths carry the same persistent id.
   * @param {object} doc  token document
   * @returns {string|null}
   */
  identityOf(doc) {
    return doc?.getFlag?.(MODULE_ID, IDENTITY_KEY) ?? this.trackIdOf(doc) ?? null;
  }

  /**
   * Explicitly assign a persistent identity id to a document. The id is
   * written to the document (flags.touch.identity + trackId + trackSig) and
   * registered as a track, so every zone the object crosses continues it.
   * Explicit ids are permanent: even after Forget All the next crossing
   * re-registers the same id instead of forging a new one.
   * @param {object} doc     token document
   * @param {string} [id]    desired id (default: keep existing or forge one)
   * @param {string} [label] display label (default: the document's name)
   * @returns {Promise<string|null>} the id, or null if unavailable/taken
   */
  async assignIdentity(doc, id = null, label = null) {
    if (!doc) return null;
    id = id || this.identityOf(doc) || newTrackId();
    if (this.tracks.has(id) && this.identityOf(doc) !== id) return null; // taken
    const now = Date.now();
    const sig = captureSignature(doc);
    this.tracks.set(id, {
      label: label ?? doc?.name ?? "?",
      color: null,
      created: now,
      points: [],
      cells: [],
      active: true,
      sig,
      matches: 0,
      assigned: true,
    });
    this.#stamp(doc, id, sig, true);
    this.#cap();
    this.mem._dirty = true;
    this.mem.scheduleFlush();
    return id;
  }

  /**
   * Re-capture the snapshot of the track bound to a document: after a
   * disguise, polymorph, or actor swap the object's image no longer matches
   * its stored track; this refreshes the image in place so the track (and
   * its history) continues under the new appearance.
   * @param {object} doc      token document (identified via its flags)
   * @param {string} [label]  optional new display label for the track
   * @returns {Promise<{id: string|null, sig: object|null}>}
   */
  async recapture(doc, label = null) {
    if (!doc) return { id: null, sig: null };
    const id = this.identityOf(doc);
    if (!id) return { id: null, sig: null };
    // Resolve the registry record; re-register if it was wiped (Forget All).
    let track = this.tracks.get(id);
    if (!track) {
      track = {
        label: label ?? doc?.name ?? "?",
        color: null,
        created: Date.now(),
        points: [],
        cells: [],
        active: true,
        sig: null,
        matches: 0,
        assigned: Boolean(doc?.getFlag?.(MODULE_ID, IDENTITY_KEY)),
      };
      this.tracks.set(id, track);
    }
    const sig = captureSignature(doc);
    track.sig = sig;
    if (label) track.label = label;
    this.#stamp(doc, id, sig, track.assigned);
    this.mem._dirty = true;
    this.mem.scheduleFlush();
    return { id, sig };
  }

  /**
   * Remove a document's persistent identity: clears the flags and (if the
   * track was explicitly assigned) deletes its registry record. The object's
   * next crossing forges a fresh id.
   * @param {object} doc  token document
   */
  async revokeIdentity(doc) {
    if (!doc) return;
    const id = this.identityOf(doc);
    const track = id ? this.tracks.get(id) : null;
    if (track?.assigned) {
      this.tracks.delete(id);
      this.mem._dirty = true;
      this.mem.scheduleFlush();
    }
    if (doc.unsetFlag) {
      doc._touchStamping = true;
      try {
        await doc.unsetFlag(MODULE_ID, IDENTITY_KEY);
        await doc.unsetFlag(MODULE_ID, "trackId");
        await doc.unsetFlag(MODULE_ID, "trackSig");
      } finally {
        doc._touchStamping = false;
      }
    }
  }

  /**
   * Assign (or reuse) a track for a document crossing at (x, y, storey).
   *
   * Snapshot matching: the track's flag is tied to a captured snapshot
   * ("image") of the object. Each crossing captures the current object and
   * checks it against the stored image:
   *   • flag present + snapshot matches  → continue the path
   *   • no flag, snapshot matches a known track → adopt that track
   *   • snapshot contradicts the stored image → new track (genuinely new object)
   * @returns {{id: string, continued: boolean, matched: boolean, similarity: number}}
   */
  assign(doc, x, y, storey = 0, label = null) {
    const now = Date.now();
    const sig = captureSignature(doc);
    let id = this.trackIdOf(doc);
    let continued = false;
    let matched = false;
    let similarity = sig ? 1 : 0;

    // A flag whose track is gone (Forget All, other scene) is stale — unless
    // it is an explicitly assigned identity, which is permanent: re-register
    // the same id so the object keeps its identity across memory wipes.
    if (id && !this.tracks.has(id)) {
      const explicit = doc?.getFlag?.(MODULE_ID, IDENTITY_KEY);
      if (explicit && explicit === id) {
        const now0 = Date.now();
        const sig0 = sig ?? captureSignature(doc);
        this.tracks.set(id, {
          label: label ?? doc?.name ?? "?",
          color: null,
          created: now0,
          points: [],
          cells: [],
          active: true,
          sig: sig0,
          matches: 0,
          assigned: true,
        });
        continued = true; // same id, fresh history
      } else {
        id = null;
      }
    }

    if (id && this.tracks.has(id)) {
      // Flagged: verify the current object against the stored snapshot.
      const track = this.tracks.get(id);
      similarity = sig ? signatureSimilarity(sig, track.sig) : 0;
      if (similarity >= 1 - this.tolerance) {
        continued = true;
        matched = true;
        track.sig = sig ?? track.sig; // keep the image current
      } else {
        // Snapshot contradicts the image — treat as a genuinely new object.
        id = null;
      }
    }

    if (!id && sig) {
      // Unflagged: try to re-identify by snapshot against known tracks.
      let best = null;
      for (const [tid, t] of this.tracks) {
        const s = signatureSimilarity(sig, t.sig);
        if (s >= 1 - this.tolerance && (!best || s > best.s)) best = { tid, s };
      }
      if (best) {
        id = best.tid;
        similarity = best.s;
        continued = true;
        matched = true;
      }
    }

    if (!id) {
      // Genuinely new object: start a track tied to its captured snapshot.
      id = newTrackId();
      this.tracks.set(id, {
        label: label ?? doc?.name ?? "?",
        color: null,
        created: now,
        points: [],
        cells: [],
        active: true,
        sig,
        matches: 0,
      });
    }
    const track = this.tracks.get(id);
    track.active = true;
    track.lastSeen = now;
    if (matched) track.matches = (track.matches ?? 0) + 1;
    const point = { x: Math.round(x), y: Math.round(y), t: now, storey, docId: doc?.id ?? null };
    track.points.push(point);
    if (track.points.length > 64) track.points.shift();
    const cellKey = cellKeyFor(x, y, storey);
    if (!track.cells.includes(cellKey)) {
      track.cells.push(cellKey);
      if (track.cells.length > 128) track.cells.shift();
    }
    // Stamp the persistent flag + snapshot tie on the document.
    this.#stamp(doc, id, sig);
    // Marching groups: every new fix refreshes the association analysis.
    this.#recomputeGroups(now);
    this.mem._dirty = true;
    this.mem.scheduleFlush();
    return { id, continued, matched, similarity, groupId: track.groupId ?? null };
  }

  /** Stamp the track flag + snapshot tie onto the document. */
  #stamp(doc, id, sig, explicit = false) {
    if (!doc?.setFlag) return;
    // Suppress re-entrant update hooks: a flag stamp must not re-ping.
    doc._touchStamping = true;
    try {
      if (doc.getFlag?.(MODULE_ID, "trackId") !== id) {
        doc.setFlag(MODULE_ID, "trackId", id).catch?.(() => {});
      }
      // The snapshot rides along so the flag is tied to the object's image.
      if (sig && JSON.stringify(doc.getFlag?.(MODULE_ID, "trackSig")) !== JSON.stringify(sig)) {
        doc.setFlag(MODULE_ID, "trackSig", sig).catch?.(() => {});
      }
      // Explicit identities get their own permanent flag, distinct from the
      // crossing stamp: it survives Forget All and re-registers the track.
      if (explicit && doc.getFlag?.(MODULE_ID, IDENTITY_KEY) !== id) {
        doc.setFlag(MODULE_ID, IDENTITY_KEY, id).catch?.(() => {});
      }
    } finally {
      doc._touchStamping = false;
    }
  }

  // ------------------------------------------------- marching group layer

  /** Motion vector of a track from its last two well-separated fixes. */
  #vectorOf(track) {
    const pts = track.points;
    if (!pts || pts.length < 2) return null;
    const b = pts[pts.length - 1];
    // Need an older fix ≥1.5s back so speed isn't sampling noise.
    let a = null;
    for (let k = pts.length - 2; k >= 0; k--) {
      if (b.t - pts[k].t >= 1500) { a = pts[k]; break; }
    }
    if (!a) return null;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      x: b.x,
      y: b.y,
      speed: Math.hypot(dx, dy) / dt,
      heading: (Math.atan2(dy, dx) / Math.PI * 180 + 360) % 360,
      t: b.t,
    };
  }

  /**
   * Re-derive marching groups: tracks whose freshest fixes agree on speed
   * and heading (within tolerance) share one group contact. Group ids are
   * stable while a group keeps marching: if any existing group still covers
   * the new members, it keeps its id rather than forking a fresh one.
   * Every membership flip is written to the formation timeline ledgers.
   */
  #recomputeGroups(now) {
    // 1) Vectors for every live track — but only FRESH observations maintain
    //    membership. A member the sonar has stopped seeing (no recent
    //    crossings) leaves the formation: unconfirmed presence is not company.
    const vectors = new Map();
    for (const [id, t] of this.tracks) {
      const v = this.#vectorOf(t);
      if (v && now - v.t <= GROUP_VECTOR_FRESH_MS) vectors.set(id, v);
    }
    // 2) Snapshot the previous grouping so flips can be diffed and logged.
    const prev = new Map();
    for (const [id, t] of this.tracks) {
      if (t.groupId) prev.set(id, t.groupId);
    }
    // 3) Greedy link: each vector joins the nearest compatible group, else
    //    starts one. Only the ids are protected from churning.
    const compatible = (v, g) =>
      Math.abs(v.speed - g.vector.speed) <= GROUP_SPEED_PX_S &&
      Math.abs(((v.heading - g.vector.heading + 540) % 360) - 180) <= GROUP_DEG;
    const desired = new Map(); // trackId → groupId
    for (const [id, v] of vectors) {
      let best = null;
      for (const [gid, g] of this.groups) {
        if ((g.lastSeen ?? 0) < now - GROUP_STALE_MS) continue;
        if (g.dissolved) continue; // a manually split group is never re-formed
        // A lone group must not attract its own member back: the track
        // should re-join a real formation, not its own phantom solo group.
        if (g.memberIds.length < 2 && this.tracks.get(id)?.groupId === gid) continue;
        if (!compatible(v, g)) continue;
        const dist = Math.hypot(v.x - g.vector.x, v.y - g.vector.y);
        if (!best || dist < best.dist) best = { gid, dist };
      }
      const gid = best?.gid ?? (() => {
        const nid = newGroupId();
        this.groups.set(nid, {
          label: null,
          created: now,
          lastSeen: now,
          vector: { ...v },
          memberIds: [],
          events: [{ tid: null, label: null, t: now, event: "formed" }],
        });
        return nid;
      })();
      const g = this.groups.get(gid);
      g.lastSeen = now;
      g.vector = { ...v };
      desired.set(id, gid);
    }
    // 4) Member sets rebuilt purely from desired — a track that re-grouped
    //    (heading flip, speed change) is dropped from the old group's roster
    //    even though it still has a live vector.
    for (const g of this.groups.values()) g.memberIds = [];
    for (const [id, gid] of desired) {
      const g = this.groups.get(gid);
      if (g && !g.memberIds.includes(id)) g.memberIds.push(id);
    }
    if (desired.size) {
      for (const gid of new Set(desired.values())) {
        const g = this.groups.get(gid);
        if (g && g.memberIds.length > 1 && !g.label) {
          g.label = this.tracks.get(g.memberIds[0])?.label ?? null;
        }
      }
    }
    // 5) Housekeeping before logging: only STALE groups are deleted. Lone
    //    groups linger as ledger holders until they go stale, so a member's
    //    departure never destroys the group id or its formation timeline —
    //    the survivor keeps the contact and a returning member rejoins it.
    for (const [gid, g] of [...this.groups]) {
      if ((g.lastSeen ?? 0) < now - GROUP_STALE_MS) this.groups.delete(gid);
    }
    while (this.groups.size > MAX_GROUPS) {
      const oldest = [...this.groups.entries()].sort((a, b) => (a[1].lastSeen ?? 0) - (b[1].lastSeen ?? 0))[0];
      this.groups.delete(oldest[0]);
    }
    // 6) Diff against the previous state → timeline events + assignment.
    for (const [id, gid] of desired) {
      const g = this.groups.get(gid);
      const t = this.tracks.get(id);
      const p = prev.get(id);
      if (!g) {
        // The group died in this same pass (lone/stale): at most a leave.
        if (p && t) {
          this.#logTransition(p, id, "left", now);
          t.groupId = null;
        }
        continue;
      }
      if (p && p !== gid) this.#logTransition(p, id, "left", now);
      if (p !== gid) this.#logTransition(gid, id, "joined", now);
      if (t) t.groupId = gid;
    }
    for (const [id, p] of prev) {
      if (!desired.has(id)) {
        // Stopped marching (no vector) or its group went stale: a leave.
        this.#logTransition(p, id, "left", now);
        const t = this.tracks.get(id);
        if (t && t.groupId === p) t.groupId = null;
      }
    }
    // Tracks whose group vanished (or shrank to a lone ledger holder) lose
    // the grouped marker.
    for (const t of this.tracks.values()) {
      if (t.groupId) {
        const g = this.groups.get(t.groupId);
        if (!g || g.memberIds.length < 2) t.groupId = null;
      }
    }
  }

  /**
   * Write one formation-timeline transition to both ledgers: the track's
   * own ring buffer and the group's event ledger. Consecutive duplicates
   * are suppressed so recompute churn cannot spam the timeline.
   */
  #logTransition(gid, trackId, event, t) {
    const track = this.tracks.get(trackId);
    const label = track?.label ?? "?";
    if (track) {
      track.groupLog = track.groupLog ?? [];
      const last = track.groupLog[track.groupLog.length - 1];
      if (!last || last.gid !== gid || last.event !== event) {
        track.groupLog.push({ gid, t, event });
        if (track.groupLog.length > 24) track.groupLog.shift();
      }
    }
    const g = this.groups.get(gid);
    if (g) {
      // Joins are only meaningful once the group is a real formation
      // (≥2 members); phantom solo-group joins stay out of the ledger.
      if (event === "joined" && (g.memberIds?.length ?? 0) < 2) return;
      g.events = g.events ?? [];
      const last = g.events[g.events.length - 1];
      if (!last || last.tid !== trackId || last.event !== event) {
        g.events.push({ tid: trackId, label, t, event });
        if (g.events.length > 64) g.events.shift();
      }
    }
  }

  /** The group id a track currently marches with, if any. Solo ledger
   *  holder groups (one member) do not count as a contact. */
  groupOfTrack(trackId) {
    const gid = this.tracks.get(trackId)?.groupId ?? null;
    if (!gid) return null;
    const g = this.groups.get(gid);
    return g && g.memberIds.length >= 2 ? gid : null;
  }

  /** All live groups with their member summaries (freshest first). */
  groupsList() {
    const out = [];
    for (const [gid, g] of this.groups) {
      const members = g.memberIds
        .map((mid) => (this.tracks.has(mid) ? { id: mid, label: this.tracks.get(mid).label } : null))
        .filter(Boolean);
      if (members.length <= 1) continue; // dissolved groups have no formation to dissolve
      out.push({
        id: gid,
        label: g.label,
        created: g.created,
        lastSeen: g.lastSeen,
        vector: g.vector ? { ...g.vector } : null,
        members,
      });
    }
    out.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    return out;
  }

  /** Manually dissolve a group; members keep their own tracks. The record
   *  stays behind as a lone ledger holder so the formation timeline remains
   *  readable through the manual split; the stale sweep deletes it later. */
  dissolveGroup(groupId) {
    if (!this.groups.has(groupId)) return false;
    const g = this.groups.get(groupId);
    const now = Date.now();
    // Log the manual split to each member's own timeline before teardown.
    for (const mid of g.memberIds) {
      this.#logTransition(groupId, mid, "left", now);
    }
    g.events.push({ tid: null, label: null, t: now, event: "dissolved" });
    g.dissolved = true;
    g.memberIds = [];
    g.lastSeen = now;
    for (const t of this.tracks.values()) {
      if (t.groupId === groupId) t.groupId = null;
    }
    this.mem._dirty = true;
    this.mem.scheduleFlush();
    return true;
  }

  /** Serializable form of the group registry for the shared scene flag. */
  serializeGroups() {
    const obj = {};
    for (const [k, v] of this.groups) {
      obj[k] = { ...v, memberIds: [...v.memberIds], events: (v.events ?? []).slice(-64).map((e) => ({ ...e })) };
    }
    return obj;
  }

  /**
   * The formation timeline for the GM Hub: per live group, its ledger of
   * joins/leaves (freshest last), plus each member's own recent history.
   * @param {number} [perGroup] max ledger entries per group (default 12)
   * @returns {Array<object>}
   */
  formationTimeline(perGroup = 12) {
    const out = [];
    for (const [gid, g] of this.groups) {
      const members = g.memberIds
        .map((mid) => (this.tracks.has(mid) ? { id: mid, label: this.tracks.get(mid).label } : null))
        .filter(Boolean);
      // Lone ledger holders (a group whose last member left) stay readable
      // here — their timeline is exactly the departure record.
      if (members.length <= 1 && !(g.events ?? []).length) continue;
      const events = (g.events ?? []).slice(-perGroup).map((e) => ({ ...e }));
      for (const m of members) {
        const own = (this.tracks.get(m.id)?.groupLog ?? [])
          .filter((e) => e.gid === gid)
          .slice(-3)
          .map((e) => ({ ...e, tid: m.id, label: m.label }));
        for (const e of own) {
          if (!events.some((x) => x.tid === e.tid && x.event === e.event && x.t === e.t)) events.push(e);
        }
      }
      events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      out.push({
        id: gid,
        label: g.label,
        created: g.created,
        lastSeen: g.lastSeen,
        dissolved: !!g.dissolved,
        vector: g.vector ? { ...g.vector } : null,
        members,
        events,
      });
    }
    out.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    return out;
  }

  /** Get one track's full record. */
  get(id) {
    const t = this.tracks.get(id);
    return t ? { id, ...t, points: [...t.points], cells: [...t.cells] } : null;
  }

  /** All tracks (pruned of stale ones), freshest first. */
  list() {
    const now = Date.now();
    const out = [];
    for (const [id, t] of this.tracks) {
      if (t.lastSeen && now - t.lastSeen > TRACK_STALE_MS) {
        this.tracks.delete(id);
        this.mem._dirty = true;
        continue;
      }
      out.push({ id, ...t, points: [...t.points], cells: [...t.cells] });
    }
    out.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    return out;
  }

  /** All tracks plus their marching-group association, freshest first. */
  groupedList() {
    return this.list().map((t) => {
      const gid = this.groupOfTrack(t.id);
      return { ...t, groupId: gid, groupLabel: gid ? (this.groups.get(gid)?.label ?? null) : null };
    });
  }

  /** Cap the registry, dropping the stalest tracks. */
  #cap() {
    if (this.tracks.size <= MAX_TRACKS) return;
    const entries = [...this.tracks.entries()].sort((a, b) => (a[1].lastSeen ?? 0) - (b[1].lastSeen ?? 0));
    while (entries.length > MAX_TRACKS) {
      const [id] = entries.shift();
      this.tracks.delete(id);
      this.mem._dirty = true;
    }
  }

  /** Serializable form for the shared scene flag. */
  serialize() {
    this.#cap();
    const obj = {};
    for (const [k, v] of this.tracks) obj[k] = v;
    return obj;
  }

  /** Serializable groups blob (stored alongside tracks in the same flag). */
  get groupsData() {
    return this.serializeGroups();
  }
}
