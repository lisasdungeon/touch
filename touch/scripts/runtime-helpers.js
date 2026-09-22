/** Small helpers shared by Touch's ready-time runtime wiring. */
import { MODULE_ID } from "./constants.js";
import { getConfig } from "./emitters.js";
import { getLevelsRange, getWallHeightRange } from "./elevation.js";

export function changedPosition(change) {
  return change?.x !== undefined || change?.y !== undefined;
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

export function makeEmitter(doc, kind) {
  const object = doc.object;
  if (!object?.center && !object?.source) return null;
  const position = object.center ?? object.source;
  const config = getConfig(doc);
  if (config.muted || config.intensity <= 0) return null;
  const levels = getLevelsRange(doc);
  const wallHeight = getWallHeightRange(doc);
  return {
    id: `${kind}.${doc.id}`,
    kind,
    name: doc.name ?? "",
    x: position.x,
    y: position.y,
    elevation: doc.elevation ?? 0,
    levels: levels.bottom !== null || levels.top !== null ? levels : wallHeight,
    color: null,
    config,
    identity: doc.getFlag?.(MODULE_ID, "identity") ?? doc.getFlag?.(MODULE_ID, "trackId") ?? null,
  };
}
