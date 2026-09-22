/**
 * Touch — sonar lattice.
 * Extends the scene grid into a 3D lattice: width × depth plan cells
 * replicated on each storey (height). Every lattice line is a real pathway
 * (sampling, surface tracing, pinging all work on it), and every true 3D
 * crossing becomes a junction waypoint node automatically via sync.
 *
 * The lattice config is stored in scene flags:
 *   touch.lattice = { enabled, cellW, cellD, storeys, intensity, mode, tone }
 * Lines are written into the normal touch.pathways flag list, each tagged
 * { lattice: { storey, axis } } so regeneration/clearing never touches
 * hand-drawn pathways.
 */
import { MODULE_ID, normalizeConfig } from "./constants.js";
import { getPathways, createPathway, removePathway, syncJunctionWaypoints } from "./pathways.js";
import { getWaypoints } from "./waypoints.js";

const LATTICE_KEY = "lattice";
/** Safety cap: refuse to generate more than this many lattice lines. */
export const MAX_LATTICE_LINES = 600;

/** Default lattice settings for a scene. */
export function defaultLattice() {
  const unit = Math.abs(Number(canvas?.dimensions?.size)) || 100;
  const w = Math.ceil((canvas?.dimensions?.sceneWidth ?? 2000) / (unit * 4));
  const d = Math.ceil((canvas?.dimensions?.sceneHeight ?? 1500) / (unit * 4));
  return {
    enabled: false,
    cellW: Math.min(24, Math.max(2, w)),
    cellD: Math.min(24, Math.max(2, d)),
    storeys: 2,
    intensity: 25,
    mode: "both",
    tone: "mid",
  };
}

/** Read (or initialize) the lattice config for a scene. */
export function getLattice(scene) {
  const raw = scene?.getFlag(MODULE_ID, LATTICE_KEY);
  return raw && typeof raw === "object" ? { ...defaultLattice(), ...raw } : defaultLattice();
}

/** Write the lattice config for a scene. */
export async function setLattice(scene, patch) {
  const next = { ...getLattice(scene), ...patch };
  await scene.setFlag(MODULE_ID, LATTICE_KEY, next);
  return next;
}

/** True if the pathway is a lattice line. */
export function isLatticeLine(pw) {
  return Boolean(pw?.lattice);
}

/**
 * Generate lattice pathways: (cellW + cellD) plan gridlines per storey,
 * replicated on every storey (elevation = storey × storeyHeight). Lines on
 * the same storey cross; lines on different storeys don't (elevation gate),
 * so junction waypoint nodes appear exactly where gridlines of one floor
 * intersect in 3D.
 *
 * @returns {Promise<{added: number, removed: number, capped: boolean, config: object}>}
 */
export async function generateLattice(scene, patch = {}) {
  const cfg = await setLattice(scene, { ...patch, enabled: true });
  const unit = Math.abs(Number(canvas?.dimensions?.size)) || 100;
  const { sceneWidth = 2000, sceneHeight = 1500, sceneX = 0, sceneY = 0 } = canvas?.dimensions ?? {};
  const storeyHeight = Math.abs(Number(game.settings.get("touch", "storeyHeight")) || 10);

  // Remove previous lattice lines, keep hand-drawn ones.
  const existing = getPathways(scene);
  const keep = existing.filter((p) => !isLatticeLine(p));
  const removed = existing.length - keep.length;
  await scene.setFlag(MODULE_ID, "pathways", keep);

  const cellWpx = Math.max(unit, Math.round(sceneWidth / cfg.cellW));
  const cellDpx = Math.max(unit, Math.round(sceneHeight / cfg.cellD));

  const plan = [];
  for (let i = 0; i <= cfg.cellW; i++) {
    plan.push({ axis: "v", x: sceneX + i * cellWpx, index: i });
  }
  for (let j = 0; j <= cfg.cellD; j++) {
    plan.push({ axis: "h", y: sceneY + j * cellDpx, index: j });
  }

  const total = plan.length * cfg.storeys;
  if (total > MAX_LATTICE_LINES) {
    await setLattice(scene, { enabled: false });
    return { added: 0, removed, capped: true, config: cfg };
  }

  let added = 0;
  for (let s = 0; s < cfg.storeys; s++) {
    const elevation = s * storeyHeight;
    for (const { axis, x, y, index } of plan) {
      const a = axis === "v" ? { x, y: sceneY } : { x: sceneX, y };
      // Span endpoints by half a cell past the scene rect so edge gridlines
      // cleanly intersect each other (their endpoints ARE the crossings).
      const b = axis === "v" ? { x, y: sceneY + sceneHeight + Math.min(cellDpx, cellWpx) / 2 } : { x: sceneX + sceneWidth + Math.min(cellDpx, cellWpx) / 2, y };
      const pw = await createPathway(scene, {
        a,
        b,
        name: game.i18n.format("TOUCH.Lattice.LineName", {
          axis: axis === "v" ? "V" : "H",
          index,
        }),
        elevation,
        config: { intensity: cfg.intensity, mode: cfg.mode, tone: cfg.tone },
        spacing: 2,
      });
      // Tag as lattice line for later regeneration/clearing.
      const list = getPathways(scene);
      const idx = list.findIndex((p) => p.id === pw.id);
      if (idx !== -1) {
        list[idx] = { ...list[idx], lattice: { storey: s, axis } };
        await scene.setFlag(MODULE_ID, "pathways", list);
      }
      added++;
    }
  }

  // Crossings become junction waypoint nodes (3D-gated).
  await syncJunctionWaypoints(scene);
  return { added, removed, capped: false, config: cfg };
}

/** Remove all lattice lines and their junction nodes. */
export async function clearLattice(scene) {
  const existing = getPathways(scene);
  const keep = existing.filter((p) => !isLatticeLine(p));
  const removed = existing.length - keep.length;
  await scene.setFlag(MODULE_ID, "pathways", keep);
  await setLattice(scene, { enabled: false });
  await syncJunctionWaypoints(scene);
  return { removed };
}

// ------------------------------------------------------- corner monitors

const MONITORS_KEY = "monitors";
/** Stable id for a corner heartbeat monitor (per corner AND storey). */
function monitorId(cx, cy, storey) {
  return `wp.mon${cx.toString(36)}x${cy.toString(36)}s${storey}`;
}

/**
 * Deploy heartbeat monitors on the lattice's plan-grid corners (the gridline
 * intersection points). Each corner becomes a real waypoint emitter tagged
 * `cornerMonitor: true` — it pings like any emitter, but the GM Hub shows it
 * with a live heartbeat countdown and the viewer pulses it on its beat.
 *
 * Monitors are idempotent: existing corner monitors are kept/updated, corners
 * that no longer exist are removed, and re-running after regenerating the
 * lattice just re-anchors them. Elevations ride the lattice storeys
 * (one monitor per corner per storey).
 *
 * @param {object} scene
 * @param {object} [opts]
 * @param {boolean} [opts.remove=true]  also remove stale corner monitors
 * @returns {Promise<{added: number, removed: number, updated: number}>}
 */
export async function deployCornerMonitors(scene, { remove = true } = {}) {
  if (!scene) return { added: 0, removed: 0, updated: 0 };
  const cfg = getLattice(scene);
  const unit = Math.abs(Number(canvas?.dimensions?.size)) || 100;
  const d = canvas?.dimensions ?? {};
  const { sceneWidth = 2000, sceneHeight = 1500, sceneX = 0, sceneY = 0 } = d;
  const cellWpx = Math.max(unit, Math.round(sceneWidth / cfg.cellW));
  const cellDpx = Math.max(unit, Math.round(sceneHeight / cfg.cellD));
  const storeyHeight = Math.abs(Number(game.settings.get(MODULE_ID, "storeyHeight")) || 10);

  // Wanted monitor positions: (cellW+1) × (cellD+1) plan corners × storeys.
  const wanted = new Map();
  for (let s = 0; s < cfg.storeys; s++) {
    const elevation = s * storeyHeight;
    for (let i = 0; i <= cfg.cellW; i++) {
      for (let j = 0; j <= cfg.cellD; j++) {
        const x = Math.round(sceneX + i * cellWpx);
        const y = Math.round(sceneY + j * cellDpx);
        wanted.set(monitorId(x, y, s), { x, y, elevation, storey: s, i, j });
      }
    }
  }

  const existing = getWaypoints(scene);
  let added = 0;
  let removed = 0;
  let updated = 0;
  const next = [];
  for (const wp of existing) {
    if (!wp.cornerMonitor) {
      next.push(wp);
      continue;
    }
    const want = wanted.get(wp.id);
    if (!want) {
      if (remove) removed++; // stale corner — drop
      else next.push(wp);
      continue;
    }
    // Keep, re-anchored to the current lattice.
    if (wp.x !== want.x || wp.y !== want.y || (wp.elevation ?? 0) !== want.elevation) {
      next.push({
        ...wp,
        x: want.x,
        y: want.y,
        elevation: want.elevation,
        config: normalizeConfig({
          ...(wp.config ?? {}),
          intensity: wp.config?.intensity ?? cfg.intensity,
          mode: wp.config?.mode ?? cfg.mode,
          tone: wp.config?.tone ?? cfg.tone,
        }),
      });
      updated++;
    } else {
      next.push(wp);
    }
    wanted.delete(wp.id);
  }
  for (const [id, want] of wanted) {
    next.push({
      id,
      name: game.i18n.format("TOUCH.Lattice.MonitorName", {
        i: want.i + 1,
        j: want.j + 1,
        storey: want.storey,
      }),
      x: want.x,
      y: want.y,
      elevation: want.elevation,
      cornerMonitor: true,
      config: normalizeConfig({ intensity: cfg.intensity, mode: cfg.mode, tone: cfg.tone }),
    });
    added++;
  }
  await scene.setFlag(MODULE_ID, "waypoints", next);
  await scene.setFlag(MODULE_ID, MONITORS_KEY, { enabled: true, deployed: next.filter((w) => w.cornerMonitor).length });
  return { added, removed, updated };
}

/**
 * Read all corner monitors with their heartbeat status.
 * @returns {Array<{id, name, x, y, elevation, storey, plan, muted}>}
 */
export function getCornerMonitors(scene) {
  const storeyHeight = Math.abs(Number(game.settings.get(MODULE_ID, "storeyHeight")) || 10);
  return getWaypoints(scene)
    .filter((w) => w.cornerMonitor)
    .map((w) => ({
      id: w.id,
      name: w.name,
      x: w.x,
      y: w.y,
      elevation: w.elevation ?? 0,
      storey: Math.round((w.elevation ?? 0) / storeyHeight),
      plan: [w.x, w.y],
      muted: Boolean(w.config?.muted),
    }));
}

/** Remove every corner monitor. Junction waypoints are untouched. */
export async function removeCornerMonitors(scene) {
  const existing = getWaypoints(scene);
  const keep = existing.filter((w) => !w.cornerMonitor);
  const removed = existing.length - keep.length;
  if (removed) await scene.setFlag(MODULE_ID, "waypoints", keep);
  await scene.setFlag(MODULE_ID, MONITORS_KEY, { enabled: false, deployed: 0 });
  return { removed };
}
