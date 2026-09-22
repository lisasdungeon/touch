/**
 * Touch — elevation integration.
 * Native elevation for all emitters, plus floor ranges via theripper93's
 * Levels module when it is active (flags.levels.rangeBottom / rangeTop).
 */
import { FLAG_SCOPE } from "./constants.js";

/** True if the Levels module is active. */
export function levelsActive() {
  return Boolean(game.modules.get("levels")?.active);
}

/** True if the Wall Height module is active. */
export function wallHeightActive() {
  return Boolean(game.modules.get("wall-height")?.active);
}

/**
 * Read a wall's (or light's) vertical extent from Wall Height flags.
 * Wall Height 4.x stores scope "wall-height" keys top/bottom in grid units;
 * null means infinite. Falls back to the pre-4.0 "wallHeight" scope, whose
 * keys were wallHeightTop / wallHeightBottom (per its migration code).
 * @returns {{bottom: number|null, top: number|null}}
 */
export function getWallHeightRange(doc) {
  const wh = doc?.flags?.["wall-height"] ?? {};
  if (wh.top !== undefined || wh.bottom !== undefined) {
    return {
      bottom: Number.isFinite(wh.bottom) ? wh.bottom : null,
      top: Number.isFinite(wh.top) ? wh.top : null,
    };
  }
  const legacy = doc?.flags?.wallHeight ?? {};
  return {
    bottom: Number.isFinite(legacy.wallHeightBottom) ? legacy.wallHeightBottom : null,
    top: Number.isFinite(legacy.wallHeightTop) ? legacy.wallHeightTop : null,
  };
}

/**
 * Write the Wall Height extent for a wall or light.
 * Either bound may be null (infinite); both null clears the override.
 */
export async function setWallHeightRange(doc, bottom, top) {
  const hasB = Number.isFinite(bottom);
  const hasT = Number.isFinite(top);
  await doc.setFlag("wall-height", "bottom", hasB ? bottom : null);
  await doc.setFlag("wall-height", "top", hasT ? top : null);
}

/**
 * Read the effective elevation of an emitter.
 * Tokens own their elevation; lights/sounds have their own elevation field;
 * walls sit on the floor plane (0) unless Levels says otherwise.
 */
export function getEmitterElevation(emitter) {
  switch (emitter.kind) {
    case "token":
      return emitter.doc?.elevation ?? 0;
    case "light":
    case "sound":
      return emitter.doc?.elevation ?? 0;
    case "wall":
      return emitter.doc?.flags?.[FLAG_SCOPE]?.elevation ?? 0;
    default:
      return 0;
  }
}

/**
 * Read the Levels floor range for a document, if any.
 * @returns {{bottom: number|null, top: number|null}}
 */
export function getLevelsRange(doc) {
  const range = doc?.flags?.levels;
  const bottom = Number.isFinite(range?.rangeBottom) ? range.rangeBottom : null;
  const top = Number.isFinite(range?.rangeTop) ? range.rangeTop : null;
  return { bottom, top };
}

/**
 * Write the Levels floor range for a document. Either bound may be null for a
 * one-sided range (e.g. only a ceiling); both null clears the override.
 */
export async function setLevelsRange(doc, bottom, top) {
  const hasB = Number.isFinite(bottom);
  const hasT = Number.isFinite(top);
  await doc.setFlag("levels", "rangeBottom", hasB ? bottom : null);
  await doc.setFlag("levels", "rangeTop", hasT ? top : null);
}

/** One-off sonar ping for a document (used after elevation changes). */
export function pingDocument(doc, kind) {
  const obj = doc.object;
  if (!obj) return;
  const pos = obj.center ?? obj.source ?? obj.midpoint ?? null;
  if (!pos) return;
  // Same precedence as the pinger: Levels floor ranges win, Wall Height
  // extents are the fallback.
  const lvRange = getLevelsRange(doc);
  const whRange = getWallHeightRange(doc);
  const hasLv = lvRange.bottom !== null || lvRange.top !== null;
  const lv = hasLv ? lvRange : whRange;
  window.touch?.pinger?.emitOne({
    id: `${kind}.${doc.id}`,
    kind,
    name: doc.name ?? "",
    x: pos.x,
    y: pos.y,
    elevation: kind === "wall" ? (doc.getFlag(FLAG_SCOPE, "elevation") ?? 0) : (doc.elevation ?? 0),
    levels: {
      bottom: lv.bottom ?? null,
      top: lv.top ?? null,
    },
    color: null,
    config: { intensity: 80, muted: false },
  });
}
