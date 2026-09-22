/** Small helpers shared by Touch's ready-time runtime wiring. */
import { MODULE_ID } from "./constants.js";
import { getConfig } from "./emitters.js";
import { getLevelsRange, getWallHeightRange } from "./elevation.js";
import { CELL_FEET, GRID_AXIS } from "./hypergrid.js";

export function changedPosition(change) {
  return change?.x !== undefined || change?.y !== undefined ||
    change?.elevation !== undefined || Array.isArray(change?.c);
}

export function insideScene(x, y, dimensions = canvas?.dimensions) {
  if (!dimensions || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false;
  const left = Number(dimensions.sceneX) || 0;
  const top = Number(dimensions.sceneY) || 0;
  const right = left + (Number(dimensions.sceneWidth) || 0);
  const bottom = top + (Number(dimensions.sceneHeight) || 0);
  return Number(x) >= left && Number(x) < right && Number(y) >= top && Number(y) < bottom;
}

/** Resolve a point inside the fixed room to one physical ten-foot cube. */
export function latticeCell(position, dimensions = canvas?.dimensions) {
  if (!position || !dimensions) return null;
  const gridDistance = Math.max(1, Number(dimensions.distance) || CELL_FEET);
  const step = Math.max(1, Number(dimensions.size) || 100) * CELL_FEET / gridDistance;
  const x = Math.floor((Number(position.x) - (Number(dimensions.sceneX) || 0)) / step);
  const z = Math.floor((Number(position.y) - (Number(dimensions.sceneY) || 0)) / step);
  const y = Math.floor(Math.max(0, Number(position.elevation) || 0) / CELL_FEET);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || z < 0 || x >= GRID_AXIS || y >= GRID_AXIS || z >= GRID_AXIS) return null;
  return { x, y, z, key: `${x}:${y}:${z}` };
}

export function isWaypointId(id) {
  return typeof id === "string" && id.startsWith("wp.");
}

export function isPathwayId(id) {
  return typeof id === "string" && id.startsWith("pw.");
}

export function pathwayBaseId(id) {
  return id.split("#")[0];
}

export function findDocumentByEmitterId(id) {
  if (typeof id !== "string" || !id) return null;
  const dot = id.indexOf(".");
  if (dot === -1 || !canvas.scene) return null;
  const collection = {
    token: canvas.scene.tokens,
    light: canvas.scene.lights,
    sound: canvas.scene.sounds,
    wall: canvas.scene.walls,
    tile: canvas.scene.tiles,
  }[id.slice(0, dot)];
  return collection?.get(id.slice(dot + 1)) ?? null;
}

export function pingWaypoint(waypoint) {
  window.touch?.pinger?.emitOne({
    id: waypoint.id,
    kind: "waypoint",
    name: waypoint.name,
    x: waypoint.x,
    y: waypoint.y,
    elevation: waypoint.elevation ?? 0,
    color: null,
    config: waypoint.config,
  });
}

/** Read the current scene-space center without applying sonar visibility rules. */
export function documentPosition(doc, kind) {
  if (!doc) return null;
  let position = doc.object?.center ?? doc.object?.source ?? doc.object?.sound ?? doc.object?.midpoint;
  if (kind === "wall" && Array.isArray(doc.c) && doc.c.length >= 4) {
    position = { x: (doc.c[0] + doc.c[2]) / 2, y: (doc.c[1] + doc.c[3]) / 2 };
  }
  position ??= Number.isFinite(doc.x) && Number.isFinite(doc.y) ? { x: doc.x, y: doc.y } : null;
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) return null;
  return { x: Number(position.x), y: Number(position.y), elevation: Number(doc.elevation) || 0 };
}

export function makeEmitter(doc, kind) {
  const object = doc.object;
  if ((kind === "token" && object?.visible === false) || doc.hidden || object?.visible === false) return null;
  const position = documentPosition(doc, kind);
  if (!position) return null;
  const config = getConfig(doc);
  if (config.muted || config.intensity <= 0) return null;
  const levels = getLevelsRange(doc);
  const wallHeight = getWallHeightRange(doc);
  return {
    id: `${kind}.${doc.id}`,
    kind,
    name: doc.name ?? "",
    x: Number(position.x),
    y: Number(position.y),
    elevation: doc.elevation ?? 0,
    levels: levels.bottom !== null || levels.top !== null ? levels : wallHeight,
    color: null,
    config,
    identity: doc.getFlag?.(MODULE_ID, "identity") ?? doc.getFlag?.(MODULE_ID, "trackId") ?? null,
  };
}
