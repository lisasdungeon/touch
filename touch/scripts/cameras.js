/**
 * Touch — camera array.
 * Six cameras form a 360° perimeter around the scene: top, bottom, and the
 * four sides. Each camera converts a ping into a small frame of CSS custom
 * properties; the viewer consumes frames and styles the 4D room with pure CSS.
 *
 * Vertical placement is storey-based: when the Levels module defines a floor
 * range (flags.levels.rangeBottom/rangeTop) the ping is placed on that floor
 * storey; otherwise the raw elevation is converted with the world's
 * "grid units per storey" setting. Ground floor = storey 0.
 */
import { CAMERAS, clamp } from "./constants.js";

const DEG = Math.PI / 180;

/** Which cameras are enabled, read from world settings keyed by camera id. */
function enabledCameraIds() {
  const conf = game.settings.get("touch", "cameras") ?? {};
  return CAMERAS.filter((c) => conf[c.id]?.enabled !== false);
}

/**
 * Compute the effective world height (z) of a ping in grid units.
 * Levels rangeBottom wins (token stands on that floor); rangeTop minus one
 * storey approximates a token below a ceiling; otherwise raw elevation.
 */
export function effectiveZ(p, settings) {
  const unit = Math.abs(Number(settings?.storeyHeight)) || 10;
  const lv = p.levels ?? {};
  if (Number.isFinite(lv.bottom)) return lv.bottom;
  if (Number.isFinite(lv.top)) return lv.top - unit;
  return Number(p.elevation ?? 0);
}

/**
 * Storey index (float) of a ping: z divided by grid units per storey.
 * Storey 0 is the ground floor.
 */
export function storeyOf(p, settings) {
  const unit = Math.abs(Number(settings?.storeyHeight)) || 10;
  return effectiveZ(p, settings) / unit;
}

export class CameraArray {
  constructor() {
    this.cameras = CAMERAS;
  }

  /**
   * One ping seen by all enabled cameras.
   * @param {object} p       ping payload from the pinger
   * @param {object} settings pinger settings snapshot
   * @returns {Array<object>} frames, one per camera
   */
  observe(p, settings) {
    const d = canvas.dimensions;
    const storey = storeyOf(p, settings);
    const ping = {
      ...p,
      nx: clamp((p.x - d.sceneX) / d.sceneWidth, 0, 1),
      ny: clamp((p.y - d.sceneY) / d.sceneHeight, 0, 1),
      storey,
    };
    if (p.trace && Number.isFinite(p.x2) && Number.isFinite(p.y2)) {
      ping.nx2 = clamp((p.x2 - d.sceneX) / d.sceneWidth, 0, 1);
      ping.ny2 = clamp((p.y2 - d.sceneY) / d.sceneHeight, 0, 1);
    }
    const frames = [];
    for (const cam of enabledCameraIds()) {
      frames.push({
        cam: cam.id,
        camLabel: cam.label,
        ping: ping.uid,
        id: p.id,
        x: p.x,
        y: p.y,
        kind: p.kind,
        name: p.name,
        born: p.born,
        color: p.color,
        intensity: p.intensity,
        storey,
        floor: Math.round(storey),
        levels: p.levels ?? null,
        facing: projectFacing(p, cam),
        mode: p.config?.mode ?? "both",
        trace: Boolean(p.trace),
        chord: p.chord ?? null,
        surface: p.surface ?? null,
        trackId: p.trackId ?? null,
        trackContinued: Boolean(p.trackContinued),
        identity: p.identity ?? null,
        tone: p.config?.tone ?? "mid",
        vars: project(ping, cam, settings),
      });
    }
    return frames;
  }
}

/**
 * Compute the emitter's facing as seen by a camera, for CSS cone rendering.
 * For top/bottom (plan) cameras the cone appears as a rotated wedge; for side
 * cameras it reduces to a horizontal spread factor.
 */
function projectFacing(p, cam) {
  const planarity = Math.abs(Math.sin(cam.elev * DEG)); // 1 top/bottom, 0 sides
  const coneOnPlan = p.config?.fov != null ? p.config.fov : 360;
  // Rotate facing into camera space.
  const rel = ((p.config?.angle ?? 0) - cam.angle) * DEG;
  return {
    planarity,
    fov: coneOnPlan,
    relDeg: ((rel / DEG) % 360 + 360) % 360,
    spread: Math.abs(Math.cos(rel)) * (1 - planarity), // how side-on the cone is
  };
}

/**
 * Project a normalized ping into camera space and express it as CSS vars.
 * u:      -50..50 horizontal offset (percent from camera center)
 * v:      -50..50 vertical offset; side cameras place by storey,
 *         top/bottom cameras by plan position
 * s:      0..1  signal strength after distance attenuation
 * floor:  rounded storey (data attribute / room placement)
 * az:     0..360 azimuth (sweep highlight)
 * d:      0..1  depth (perspective scale, shrinks on far storeys)
 */
function project(p, cam, settings) {
  const a = cam.angle * DEG;
  const dx = p.nx - 0.5;
  const dy = p.ny - 0.5;
  const rx = dx * Math.cos(a) - dy * Math.sin(a); // -0.5..0.5
  const ry = dx * Math.sin(a) + dy * Math.cos(a); // -0.5..0.5

  const planarity = Math.abs(Math.sin(cam.elev * DEG)); // 1 top/bottom, 0 sides
  const span = 14; // visual percent per storey in edge-on views
  const sz = p.storey * span;

  const u = rx * 100;
  const v = (ry * 100) * planarity + sz * (1 - planarity) + ry * 100 * (1 - planarity) * 0.3;
  const depth = clamp(1 - Math.abs(ry) * (1 - planarity) * 0.5 - Math.abs(p.storey) * planarity * 0.1, 0.35, 1);

  const dist = clamp(Math.hypot(dx, dy) * 2, 0, 1);
  const att = 1 - (settings?.echoAttenuation ?? 0.5) * dist;
  const s = clamp((p.intensity / 100) * att, 0, 1);

  const az = (Math.atan2(dy, dx) / DEG + 360) % 360;

  // Surface traces: project the chord's far endpoint through the same math
  // so the blip can draw the exact line fragment crossing the object.
  let v2;
  if (p.trace && Number.isFinite(p.nx2) && Number.isFinite(p.ny2)) {
    const dx2 = p.nx2 - 0.5, dy2 = p.ny2 - 0.5;
    const rx2 = dx2 * Math.cos(a) - dy2 * Math.sin(a);
    const ry2 = dx2 * Math.sin(a) + dy2 * Math.cos(a);
    v2 = (ry2 * 100) * planarity + sz * (1 - planarity) + ry2 * 100 * (1 - planarity) * 0.3;
    return {
      "--u": u.toFixed(2),
      "--v": v.toFixed(2),
      "--v2": v2.toFixed(2),
      "--s": s.toFixed(3),
      "--floor": String(Math.round(p.storey)),
      "--az": az.toFixed(1),
      "--d": depth.toFixed(3),
    };
  }

  return {
    "--u": u.toFixed(2),
    "--v": v.toFixed(2),
    "--s": s.toFixed(3),
    "--floor": String(Math.round(p.storey)),
    "--az": az.toFixed(1),
    "--d": depth.toFixed(3),
  };
}

/**
 * Project one raw scene point (x, y, elevation) into the room view's CSS
 * variables using the same math as ping frames — used by the wave layer so
 * wavefronts, rails, and interference dots land exactly where pings do.
 * @returns {object} CSS custom properties (--u, --v, --d …)
 */
export function projectPointForRoom(x, y, elevation, cam, settings) {
  const d = canvas.dimensions;
  const storeyHeight = Math.abs(Number(settings?.storeyHeight)) || 10;
  const p = {
    x,
    y,
    nx: clamp((x - d.sceneX) / d.sceneWidth, 0, 1),
    ny: clamp((y - d.sceneY) / d.sceneHeight, 0, 1),
    storey: (Number(elevation) || 0) / storeyHeight,
    intensity: 0,
  };
  return project(p, cam, settings);
}
