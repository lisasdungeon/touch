/**
 * Touch — sonar pathways.
 * A pathway is a drawn line between two scene points whose entire length
 * emits pings. It is sampled every `spacing` grid units (capped, staggered)
 * into per-point emitters, so sonar sweeps read as a lit "rail" rather than
 * one dot. Stored in scene flags — no documents needed.
 *
 * When a token moves across a pathway, the segments of the line passing
 * through the token's footprint are measured and emitted as "trace" pings —
 * a hollow surface profile of exactly the surface breaking the line. Two
 * crossing pathways spawn a shared junction waypoint at the intersection.
 */
import { MODULE_ID, normalizeConfig } from "./constants.js";
import { getWaypoints } from "./waypoints.js";

const PATHWAYS_KEY = "pathways";
/** Hard cap on sample points per pathway (protects the ping pipeline). */
export const MAX_SAMPLES = 64;
/** Default distance in grid units between sample points. */
export const DEFAULT_SPACING = 2;
/** Max trace segments emitted per crossing (guards degenerate polygons). */
const MAX_TRACE_SEGMENTS = 16;

/** Read all pathways for a scene (never null). */
export function getPathways(scene) {
  const raw = scene?.getFlag(MODULE_ID, PATHWAYS_KEY);
  return Array.isArray(raw) ? raw : [];
}

/** Read one pathway by id. */
export function getPathway(scene, id) {
  return getPathways(scene).find((p) => p.id === id) ?? null;
}

/**
 * Sample positions along a pathway (currently one segment) at `spacing`
 * grid-unit intervals, endpoints included. Deterministic and shared by the
 * canvas layer, the viewer, and the pinger.
 */
export function samplePathway(pathway, spacing = DEFAULT_SPACING) {
  const s = Math.max(1, Number(spacing) || DEFAULT_SPACING);
  const d = canvas?.dimensions ?? { size: 100 };
  const unit = d.size || 100;
  const [ax, ay, bx, by] = pathway.c ?? [0, 0, 0, 0];
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.floor(len / (unit * s)) + 1));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    pts.push({ x: Math.round(ax + (bx - ax) * t), y: Math.round(ay + (by - ay) * t) });
  }
  return pts;
}

/**
 * Create a pathway from two scene points.
 * @returns {object} the stored pathway
 */
export async function createPathway(scene, { a, b, name, elevation = 0, config = {}, spacing = DEFAULT_SPACING }) {
  const list = getPathways(scene);
  const pw = {
    id: `pw.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name ?? game.i18n.format("TOUCH.Pathway.DefaultName", { n: list.length + 1 }),
    c: [Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)],
    elevation,
    spacing: Math.max(1, Number(spacing) || DEFAULT_SPACING),
    config: normalizeConfig(config),
  };
  await scene.setFlag(MODULE_ID, PATHWAYS_KEY, [...list, pw]);
  return pw;
}

/** Update one pathway (name, geometry, elevation, spacing, config). */
export async function updatePathway(scene, id, patch) {
  const list = getPathways(scene);
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  const next = { ...cur };
  if (Array.isArray(patch.c) && patch.c.length === 4 && patch.c.every(Number.isFinite)) {
    next.c = patch.c.map((v) => Math.round(v));
  }
  if (Number.isFinite(patch.elevation)) next.elevation = patch.elevation;
  if (Number.isFinite(patch.spacing)) next.spacing = Math.max(1, Number(patch.spacing));
  if (patch.name !== undefined) next.name = String(patch.name);
  if (patch.config) next.config = normalizeConfig({ ...cur.config, ...patch.config });
  const copy = [...list];
  copy[idx] = next;
  await scene.setFlag(MODULE_ID, PATHWAYS_KEY, copy);
  return next;
}

/** Remove a pathway. */
export async function removePathway(scene, id) {
  const list = getPathways(scene).filter((p) => p.id !== id);
  await scene.setFlag(MODULE_ID, PATHWAYS_KEY, list);
  return list.length;
}

// ------------------------------------------------------- surface-trace logic

/**
 * Segment–axis-aligned-rect intersection via Liang–Barsky clipping.
 * @param {number[]} c   segment [ax, ay, bx, by]
 * @param {number} halfw  rect half-width
 * @param {number} halfh  rect half-height
 * @returns {number[]|null} clipped segment [ax, ay, bx, by], or null if the
 *   segment misses the rect entirely.
 */
export function clipSegmentToRect(c, halfw, halfh) {
  const [ax, ay, bx, by] = c;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0; // parallel: inside iff q >= 0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, ax + halfw)) return null;   // left edge   x >= -halfw
  if (!clip(dx, halfw - ax)) return null;    // right edge  x <= halfw
  if (!clip(-dy, ay + halfh)) return null;   // top edge    y >= -halfh
  if (!clip(dy, halfh - ay)) return null;    // bottom edge y <= halfh
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Token footprint half-size in scene units (w/h are grid squares). */
function tokenHalfSize(doc, unit) {
  const w = Math.max(0.1, Number(doc.width) || 1);
  const h = Math.max(0.1, Number(doc.height) || 1);
  return { halfw: (w * unit) / 2, halfh: (h * unit) / 2 };
}

/** True when the point (px, py) sits inside the token's footprint rect. */
export function pointInToken(px, py, doc, unit) {
  const { halfw, halfh } = tokenHalfSize(doc, unit);
  const cx = doc.x ?? 0, cy = doc.y ?? 0;
  return Math.abs(px - cx) <= halfw && Math.abs(py - cy) <= halfh;
}

/**
 * Trace the surface of a token breaking a pathway: clip the pathway line to
 * the token's footprint rect and emit one "surface ping" per clipped segment
 * (support multiple samples by segmenting the chord).
 * @param {object} pathway  pathway record (uses .c geometry)
 * @param {TokenDocument} doc  the moving token document
 * @param {object} [opts]  { config } overrides for the emitted pings
 * @returns {Array<object>} trace pings, one per chord segment
 */
export function traceTokenPathwayCrossing(pathway, doc, { config } = {}) {
  const d = canvas?.dimensions ?? { size: 100 };
  const unit = d.size || 100;
  const { halfw, halfh } = tokenHalfSize(doc, unit);
  const cx = doc.x ?? 0, cy = doc.y ?? 0;
  const [ax, ay, bx, by] = pathway.c ?? [0, 0, 0, 0];
  const local = [ax - cx, ay - cy, bx - cx, by - cy];
  const clipped = clipSegmentToRect(local, halfw, halfh);
  if (!clipped) return [];
  const chordLen = Math.hypot(clipped[2] - clipped[0], clipped[3] - clipped[1]);
  if (chordLen < 1) return []; // corner graze: nothing meaningful to trace

  // Break the chord into at most MAX_TRACE_SEGMENTS surface pings.
  const segs = Math.max(1, Math.min(MAX_TRACE_SEGMENTS, Math.round(chordLen / Math.max(1, unit * 0.5))));
  const cfg = config ?? pathway.config ?? {};
  // clipped[0..1] is the t0 (entry) end by construction of Liang–Barsky.
  // Coordinates were clipped token-local; convert back to scene space.
  const [ex0, ey0, ex1, ey1] = clipped;
  const entry = { x: ex0 + cx, y: ey0 + cy };
  const exit = { x: ex1 + cx, y: ey1 + cy };
  const out = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const p0 = {
      x: Math.round(entry.x + (exit.x - entry.x) * t0),
      y: Math.round(entry.y + (exit.y - entry.y) * t0),
    };
    const p1 = {
      x: Math.round(entry.x + (exit.x - entry.x) * t1),
      y: Math.round(entry.y + (exit.y - entry.y) * t1),
    };
    out.push({
      id: `${pathway.id}@trace${Date.now().toString(36)}${i}`,
      pathwayId: pathway.id,
      kind: "trace",
      trace: true,
      name: doc.name ?? "",
      traceTokenId: doc.id,
      x: p0.x, y: p0.y,
      x2: p1.x, y2: p1.y,
      elevation: doc.elevation ?? 0,
      chord: Math.round(chordLen),
      surface: {
        chord: Math.round(chordLen),
        segments: segs,
        index: i,
        width: Math.round(halfw * 2),
        height: Math.round(halfh * 2),
        entryDeg: Math.round((Math.atan2(entry.y - cy, entry.x - cx) * 180) / Math.PI),
      },
      color: null,
      config: cfg,
      doc: null,
    });
  }
  return out;
}

// -------------------------------------------------------- crossing waypoints

/** Stable id for the junction waypoint shared by two pathway ids. */
function junctionId(aId, bId) {
  return `wp.x${[aId, bId].sort().join("~").replace(/[^a-z0-9]/gi, "")}`;
}

/**
 * Find crossings between pathways — in 3D. Two lines only cross when their
 * plan segments intersect AND their elevation spans overlap (each pathway
 * occupies one storey band: elevation ± half a storey height). A vertical
 * lattice line on floor 0 and a horizontal line on floor 1 cross in plan but
 * not in space, so no node is created.
 * @returns {Array<{x, y, a: string, b: string}>}
 */
export function findPathwayCrossings(scene, { excludeId = null } = {}) {
  const list = getPathways(scene);
  const storeyHeight = Math.abs(Number(game.settings.get("touch", "storeyHeight")) || 10);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const A = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const B = list[j];
      if (excludeId && (A.id === excludeId || B.id === excludeId)) continue;
      // 3D gate: elevation bands [e - sh/2, e + sh/2] must overlap.
      const eA = Number(A.elevation) || 0;
      const eB = Number(B.elevation) || 0;
      if (Math.abs(eA - eB) >= storeyHeight) continue;
      for (const p of segmentIntersections(A.c, B.c)) {
        out.push({ x: p.x, y: p.y, a: A.id, b: B.id });
      }
    }
  }
  return out;
}

/** Segment–segment intersection (internal, shared with crossings). */
function segmentIntersections(c1, c2) {
  const [ax, ay, bx, by] = c1;
  const [cx, cy, dx, dy] = c2;
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return []; // parallel or collinear
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return [];
  return [{ x: ax + d1x * t, y: ay + d1y * t }];
}

/**
 * Sync junction waypoints: for every pathway crossing, ensure exactly one
 * waypoint tagged { junction: { a, b } } exists at the intersection point;
 * remove stale junction waypoints whose crossing no longer exists.
 * Written directly (not via deployWaypoint) so the id is stable per pathway
 * pair — that's what makes repeated syncs idempotent.
 * Safe to call after any pathway create/update/delete.
 * @returns {{added: number, removed: number, kept: number}}
 */
export async function syncJunctionWaypoints(scene) {
  const crossings = findPathwayCrossings(scene);
  const wanted = new Map(); // junctionId -> crossing
  for (const c of crossings) wanted.set(junctionId(c.a, c.b), c);

  const wps = getWaypoints(scene);
  const existing = new Map();
  for (const wp of wps) {
    if (wp.junction) existing.set(wp.id, wp.junction);
  }

  let added = 0, removed = 0, kept = 0, moved = 0;
  const next = [...wps];
  // Remove stale junctions (crossing gone, pathway moved away or deleted)
  // and re-position kept junctions whose intersection point moved.
  for (let i = next.length - 1; i >= 0; i--) {
    const wp = next[i];
    if (!wp.junction) continue;
    const want = wanted.get(wp.id);
    if (!want) {
      next.splice(i, 1);
      removed++;
    } else if (wp.x !== Math.round(want.x) || wp.y !== Math.round(want.y)) {
      next[i] = { ...wp, x: Math.round(want.x), y: Math.round(want.y) };
      moved++;
    } else {
      kept++;
    }
  }
  // Add missing junctions — positioned at the crossing, elevated halfway
  // between the two lines' storeys, named after the two pathway names.
  for (const [id, c] of wanted) {
    if (existing.has(id)) {
      continue;
    }
    const pwA = getPathway(scene, c.a);
    const pwB = getPathway(scene, c.b);
    const elev = ((Number(pwA?.elevation) || 0) + (Number(pwB?.elevation) || 0)) / 2;
    next.push({
      id,
      name: game.i18n.format("TOUCH.Pathway.JunctionName", {
        a: pwA?.name ?? c.a.slice(3, 9),
        b: pwB?.name ?? c.b.slice(3, 9),
      }),
      x: Math.round(c.x),
      y: Math.round(c.y),
      elevation: elev,
      junction: { a: c.a, b: c.b },
      config: normalizeConfig({ intensity: 40, mode: "both" }),
    });
    added++;
  }
  if (added || removed || moved) {
    await scene.setFlag(MODULE_ID, "waypoints", next);
  }
  return { added, removed, kept, moved };
}
