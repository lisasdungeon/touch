/** Persistent track identities and snapshot matching for Touch. */
import { MODULE_ID } from "./constants.js";
import {
  MEMORY_KEY,
  IDENTITY_KEY,
  cellKeyFor,
  captureSignature,
  signatureSimilarity,
} from "./memory.js";
import { TrackGroups } from "./track-groups.js";

const MAX_TRACKS = 200;
const TRACK_STALE_MS = 10 * 60 * 1000;

function newTrackId() {
  return `trk.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class TrackRegistry {
  constructor(nodeMemory) {
    this.mem = nodeMemory;
    this.tracks = new Map();
    this.grouping = new TrackGroups(this);
    this.groups = this.grouping.groups;
  }

  get tolerance() {
    const value = Number(game.settings.get(MODULE_ID, "trackMatchTolerance"));
    return Number.isFinite(value) ? Math.max(0, Math.min(0.9, value)) : 0.25;
  }

  load(scene) {
    this.tracks.clear();
    const flag = scene?.getFlag(MODULE_ID, MEMORY_KEY);
    const raw = flag?.tracks;
    if (raw && typeof raw === "object") {
      for (const [id, value] of Object.entries(raw)) {
        if (value && typeof value === "object") {
          this.tracks.set(id, { ...value, points: [...(value.points ?? [])], cells: [...(value.cells ?? [])] });
        }
      }
    }
    this.grouping.load(flag?.groups);
  }

  trackIdOf(doc) {
    return doc?.getFlag?.(MODULE_ID, "trackId") ?? null;
  }

  identityOf(doc) {
    return doc?.getFlag?.(MODULE_ID, IDENTITY_KEY) ?? this.trackIdOf(doc) ?? null;
  }

  async assignIdentity(doc, id = null, label = null) {
    if (!doc) return null;
    id = id || this.identityOf(doc) || newTrackId();
    if (this.tracks.has(id) && this.identityOf(doc) !== id) return null;
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
    this.markDirty();
    return id;
  }

  async recapture(doc, label = null) {
    if (!doc) return { id: null, sig: null };
    const id = this.identityOf(doc);
    if (!id) return { id: null, sig: null };
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
    this.markDirty();
    return { id, sig };
  }

  async revokeIdentity(doc) {
    if (!doc) return;
    const id = this.identityOf(doc);
    const track = id ? this.tracks.get(id) : null;
    if (track?.assigned) {
      this.tracks.delete(id);
      this.markDirty();
    }
    if (!doc.unsetFlag) return;
    doc._touchStamping = true;
    try {
      await doc.unsetFlag(MODULE_ID, IDENTITY_KEY);
      await doc.unsetFlag(MODULE_ID, "trackId");
      await doc.unsetFlag(MODULE_ID, "trackSig");
    } finally {
      doc._touchStamping = false;
    }
  }

  assign(doc, x, y, storey = 0, label = null) {
    const now = Date.now();
    const sig = captureSignature(doc);
    let id = this.trackIdOf(doc);
    let continued = false;
    let matched = false;
    let similarity = sig ? 1 : 0;

    if (id && !this.tracks.has(id)) {
      const explicit = doc?.getFlag?.(MODULE_ID, IDENTITY_KEY);
      if (explicit && explicit === id) {
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
        continued = true;
      } else {
        id = null;
      }
    }

    if (id && this.tracks.has(id)) {
      const track = this.tracks.get(id);
      similarity = sig ? signatureSimilarity(sig, track.sig) : 0;
      if (similarity >= 1 - this.tolerance) {
        continued = true;
        matched = true;
        track.sig = sig ?? track.sig;
      } else {
        id = null;
      }
    }

    if (!id && sig) {
      let best = null;
      for (const [trackId, track] of this.tracks) {
        const score = signatureSimilarity(sig, track.sig);
        if (score >= 1 - this.tolerance && (!best || score > best.score)) best = { trackId, score };
      }
      if (best) {
        id = best.trackId;
        similarity = best.score;
        continued = true;
        matched = true;
      }
    }

    if (!id) {
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
    track.points.push({ x: Math.round(x), y: Math.round(y), t: now, storey, docId: doc?.id ?? null });
    if (track.points.length > 64) track.points.shift();
    const key = cellKeyFor(x, y, storey);
    if (!track.cells.includes(key)) track.cells.push(key);
    if (track.cells.length > 128) track.cells.shift();
    const onDoc = this.trackIdOf(doc) === id;
    if (track.assigned || onDoc) this.#stamp(doc, id, sig, Boolean(track.assigned));
    this.grouping.recompute(now);
    this.markDirty();
    return { id, continued, matched, similarity, groupId: track.groupId ?? null };
  }

  #stamp(doc, id, sig, explicit = false) {
    if (!doc?.setFlag) return;
    const existing = doc.getFlag?.(MODULE_ID, "trackId");
    if (!explicit && existing !== id) return;
    doc._touchStamping = true;
    try {
      if (existing !== id) doc.setFlag(MODULE_ID, "trackId", id).catch?.(() => {});
      if (sig && JSON.stringify(doc.getFlag?.(MODULE_ID, "trackSig")) !== JSON.stringify(sig)) {
        doc.setFlag(MODULE_ID, "trackSig", sig).catch?.(() => {});
      }
      if (explicit && doc.getFlag?.(MODULE_ID, IDENTITY_KEY) !== id) {
        doc.setFlag(MODULE_ID, IDENTITY_KEY, id).catch?.(() => {});
      }
    } finally {
      doc._touchStamping = false;
    }
  }

  markDirty() {
    this.mem._dirty = true;
    this.mem.scheduleFlush();
  }

  groupOfTrack(id) { return this.grouping.groupOfTrack(id); }
  groupsList() { return this.grouping.list(); }
  dissolveGroup(id) { return this.grouping.dissolve(id); }
  formationTimeline(perGroup = 12) { return this.grouping.timeline(perGroup); }
  serializeGroups() { return this.grouping.serialize(); }

  get(id) {
    const track = this.tracks.get(id);
    return track ? { id, ...track, points: [...track.points], cells: [...track.cells] } : null;
  }

  list() {
    const now = Date.now();
    const result = [];
    for (const [id, track] of this.tracks) {
      if (track.lastSeen && now - track.lastSeen > TRACK_STALE_MS) {
        this.tracks.delete(id);
        this.markDirty();
        continue;
      }
      result.push({ id, ...track, points: [...track.points], cells: [...track.cells] });
    }
    return result.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  }

  groupedList() {
    return this.list().map((track) => {
      const groupId = this.groupOfTrack(track.id);
      return { ...track, groupId, groupLabel: groupId ? (this.groups.get(groupId)?.label ?? null) : null };
    });
  }

  #cap() {
    if (this.tracks.size <= MAX_TRACKS) return;
    const entries = [...this.tracks.entries()]
      .sort((a, b) => (a[1].lastSeen ?? 0) - (b[1].lastSeen ?? 0));
    while (entries.length > MAX_TRACKS) {
      const [id] = entries.shift();
      this.tracks.delete(id);
      this.markDirty();
    }
  }

  serialize() {
    this.#cap();
    return Object.fromEntries(this.tracks);
  }
}
