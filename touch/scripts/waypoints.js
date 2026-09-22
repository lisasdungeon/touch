/**
 * Touch — deployable sonar waypoints.
 * Free-standing emitters stored in scene flags (no documents needed), deployed
 * by clicking the scene with the Waypoint tool. Each carries full sonar config:
 * intensity, emission mode (sound/light/both), facing angle + cone, elevation,
 * mute.
 */
import { MODULE_ID, FLAG_SCOPE, normalizeConfig } from "./constants.js";

const WAYPOINTS_KEY = "waypoints";

/** Read all waypoints for a scene (never null). */
export function getWaypoints(scene) {
  const raw = scene?.getFlag(MODULE_ID, WAYPOINTS_KEY);
  return Array.isArray(raw) ? raw : [];
}

/** Read one waypoint by id. */
export function getWaypoint(scene, id) {
  return getWaypoints(scene).find((w) => w.id === id) ?? null;
}

/** Deploy a new waypoint at a scene position. */
export async function deployWaypoint(scene, { x, y, name, elevation = 0, config = {} }) {
  const list = getWaypoints(scene);
  const wp = {
    id: `wp.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name ?? game.i18n.format("TOUCH.Waypoint.DefaultName", { n: list.length + 1 }),
    x: Math.round(x),
    y: Math.round(y),
    elevation,
    config: normalizeConfig(config),
  };
  await scene.setFlag(MODULE_ID, WAYPOINTS_KEY, [...list, wp]);
  return wp;
}

/** Update one waypoint's data/config. */
export async function updateWaypoint(scene, id, patch) {
  const list = getWaypoints(scene);
  const idx = list.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  const next = { ...current };
  if (Number.isFinite(patch.x)) next.x = Math.round(patch.x);
  if (Number.isFinite(patch.y)) next.y = Math.round(patch.y);
  if (Number.isFinite(patch.elevation)) next.elevation = patch.elevation;
  if (patch.name !== undefined) next.name = String(patch.name);
  if (patch.config) next.config = normalizeConfig({ ...current.config, ...patch.config });
  const copy = [...list];
  copy[idx] = next;
  await scene.setFlag(MODULE_ID, WAYPOINTS_KEY, copy);
  return next;
}

/** Remove a waypoint. */
export async function removeWaypoint(scene, id) {
  const list = getWaypoints(scene).filter((w) => w.id !== id);
  await scene.setFlag(MODULE_ID, WAYPOINTS_KEY, list);
  return list.length;
}
