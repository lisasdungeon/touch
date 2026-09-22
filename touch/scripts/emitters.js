/**
 * Touch — emitters.
 * Collects everything in the scene that can emit a sonar ping and reads or
 * writes per-object sonar config (intensity, mute, mode, facing) stored in
 * flags so it is system agnostic. Waypoints are stored separately in scene
 * flags and merged in here.
 */
import {
  MODULE_ID,
  FLAG_SCOPE,
  FLAG_KEY,
  normalizeConfig,
} from "./constants.js";
import { getWaypoints } from "./waypoints.js";
import { getPathways, samplePathway } from "./pathways.js";
import { getLevelsRange, getWallHeightRange } from "./elevation.js";

/**
 * Scene wall segments (reflection surfaces) — shared by the wavefield and
 * its echo→monitor attribution.
 */

/** Enum of emitter kinds, used by the hub and cameras for iconography. */
export const EMITTER_KIND = {
  TOKEN: "token",
  LIGHT: "light",
  SOUND: "sound",
  WALL: "wall",
  WAYPOINT: "waypoint",
  PATHWAY: "pathway",
};

const SOUND_DETECTION_MODES = new Set(["GB", "OB"]); // Global/Bypass act like always-on

/**
 * Read sonar config for a document.
 * @param {foundry.abstract.Document} doc
 * @returns {object}
 */
export function getConfig(doc) {
  return normalizeConfig(doc.getFlag(FLAG_SCOPE, FLAG_KEY));
}

/**
 * Write sonar config for a document (GM authority).
 * @param {foundry.abstract.Document} doc
 * @param {object} patch
 */
export async function setConfig(doc, patch) {
  const next = { ...getConfig(doc), ...patch };
  await doc.setFlag(FLAG_SCOPE, FLAG_KEY, next);
  return next;
}

/**
 * Collect all echogenic objects in the scene.
 * @param {Scene} scene
 * @returns {Array<{id, kind, name, x, y, elevation?, color?, config, doc}>}
 */
export function collectEmitters(scene) {
  if (!scene) return [];
  const out = [];

  // Tokens — the primary sonar sources (creatures, objects, vehicles…)
  for (const t of scene.tokens) {
    if (!t.object || !t.object.visible) continue;
    const center = t.object.center;
    out.push({
      id: `token.${t.id}`,
      kind: EMITTER_KIND.TOKEN,
      name: t.name,
      x: center.x,
      y: center.y,
      elevation: t.elevation,
      color: colorForToken(t),
      doc: t,
      identity: t.getFlag?.(MODULE_ID, "identity") ?? t.getFlag?.(MODULE_ID, "trackId") ?? null,
      config: getConfig(t),
    });
  }

  // Ambient lights with a light emission
  for (const l of scene.lights) {
    if (!l.object || l.hidden) continue;
    const source = l.object.source;
    if (!source || source.dim === 0) continue;
    out.push({
      id: `light.${l.id}`,
      kind: EMITTER_KIND.LIGHT,
      name: l.label ?? l.name ?? "Light",
      x: source.x,
      y: source.y,
      elevation: l.elevation,
      color: lightColor(l),
      doc: l,
      config: getConfig(l),
    });
  }

  // Ambient sounds with an active sound source
  for (const s of scene.sounds) {
    if (!s.object || s.hidden) continue;
    const src = s.object.sound;
    const always = SOUND_DETECTION_MODES.has(s.sound?.get?.("detectionModes")?.audio ?? "");
    if (!src || (!src.active && !always)) continue;
    out.push({
      id: `sound.${s.id}`,
      kind: EMITTER_KIND.SOUND,
      name: s.label ?? "Sound",
      x: src.x,
      y: src.y,
      elevation: s.elevation,
      color: 0xa78bfa,
      doc: s,
      config: getConfig(s),
    });
  }

  // Interior walls: sonar-reflective surfaces. They are included only when
  // explicitly tuned (intensity > 0), so ordinary room walls stay quiet.
  for (const w of scene.walls) {
    const cfg = getConfig(w);
    if (cfg.intensity <= 0) continue;
    const mp = w.object?.midpoint ?? { x: (w.c[0] + w.c[2]) / 2, y: (w.c[1] + w.c[3]) / 2 };
    out.push({
      id: `wall.${w.id}`,
      kind: EMITTER_KIND.WALL,
      name: `Wall ${w.id.slice(0, 6)}`,
      x: mp.x,
      y: mp.y,
      elevation: 0,
      color: 0x94a3b8,
      doc: w,
      config: cfg,
    });
  }

  // Deployable waypoints — stored in scene flags, no documents needed.
  // Corner heartbeat monitors carry their flag on the emitter (doc: wp) so
  // the hub/viewer can recognize them.
  for (const wp of getWaypoints(scene)) {
    out.push({
      id: wp.id,
      kind: EMITTER_KIND.WAYPOINT,
      name: wp.name,
      x: wp.x,
      y: wp.y,
      elevation: wp.elevation ?? 0,
      color: 0x5eead4,
      doc: wp,
      cornerMonitor: Boolean(wp.cornerMonitor),
      config: normalizeConfig(wp.config),
    });
  }

  // Sonar pathways — drawn lines whose whole length emits. Each sample point
  // along the line becomes its own emitter with a stable compound id
  // ("pw.xxx#3"), so the pipeline treats them as independent sources.
  for (const pw of getPathways(scene)) {
    if (pw.config.muted || pw.config.intensity <= 0) continue;
    const pts = samplePathway(pw, pw.spacing);
    for (let i = 0; i < pts.length; i++) {
      out.push({
        id: `${pw.id}#${i}`,
        pathwayId: pw.id,
        kind: EMITTER_KIND.PATHWAY,
        name: pw.name,
        x: pts[i].x,
        y: pts[i].y,
        elevation: pw.elevation ?? 0,
        spacing: pw.spacing,
        color: 0x5eead4,
        doc: null,
        config: pw.config,
      });
    }
  }

  return out;
}

/**
 * Collect wall segments that waves reflect from. All walls qualify (ordinary
 * room walls included) — reflection is a property of the surface, not of
 * whether the wall itself pings. Doors pass waves when open (foundry flags
 * door states: 0 closed, 1 open, 2 secret).
 * @returns {Array<{c: [x,y,x,y], elevation, bottom, top}>}
 */
export function collectWalls(scene) {
  if (!scene) return [];
  const out = [];
  for (const w of scene.walls ?? []) {
    if (!Array.isArray(w.c) || w.c.length < 4) continue;
    if (w.door === CONST.WALL_DOOR_TYPES.DOOR && w.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
    const lv = getLevelsRange(w);
    const wh = getWallHeightRange(w);
    const hasLv = lv.bottom !== null || lv.top !== null;
    const v = hasLv ? lv : wh;
    out.push({
      c: [...w.c],
      elevation: w.elevation ?? 0,
      bottom: v.bottom,
      top: v.top,
    });
  }
  return out;
}
function colorForToken(t) {
  // Prefer explicit flag color, else disposition color.
  const flagged = t.getFlag(FLAG_SCOPE, "color");
  if (typeof flagged === "string") return new foundry.utils.Color(flagged);
  switch (t.disposition) {
    case CONST.TOKEN_DISPOSITIONS.FRIENDLY: return 0x2dd4bf;
    case CONST.TOKEN_DISPOSITIONS.NEUTRAL: return 0x60a5fa;
    case CONST.TOKEN_DISPOSITIONS.HOSTILE: return 0xf87171;
    case CONST.TOKEN_DISPOSITIONS.SECRET: return 0xc084fc;
    default: return 0x94a3b8;
  }
}

/** Derive a ping color from an ambient light. */
function lightColor(l) {
  try {
    return l.object.source?.color?.get?.() ?? 0xfbbf24;
  } catch {
    return 0xfbbf24;
  }
}
