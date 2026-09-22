/**
 * Touch — sonar constants and shared helpers.
 * All spatial data is in Foundry scene units (pixels) with Y+ pointing down.
 */

export const MODULE_ID = "touch";
export const SOCKET_NAME = `module.${MODULE_ID}`;

/** Socket message types. */
export const SOCKET_MESSAGES = {
  SYNC: "sync",             // full state broadcast (GM -> all)
  PING: "ping",             // individual ping emission (any client with canvas)
  PINGS: "pings",           // batch of pings
  REQUEST_SYNC: "request",  // a client asks the GM for the current state
};

/** The six perimeter cameras. elev: degrees above the scene plane; angle: degrees about Z. */
export const CAMERAS = [
  { id: "top",    label: "Top",    elev: 90,  angle: 0,   side: "top" },
  { id: "bottom", label: "Bottom", elev: -90, angle: 0,   side: "bottom" },
  { id: "left",   label: "Left",   elev: 0,   angle: -90, side: "left" },
  { id: "right",  label: "Right",  elev: 0,   angle: 90,  side: "right" },
  { id: "front",  label: "Front",  elev: 0,   angle: 180, side: "front" },
  { id: "back",   label: "Back",   elev: 0,   angle: 0,   side: "back" },
];

/** Camera -> first-letter CSS custom property suffixes used by the viewer. */
export const CAMERA_VARS = Object.fromEntries(CAMERAS.map((c) => [c.id, c.id]));

/** Store flag under which per-object sonar config is kept. */
export const FLAG_SCOPE = MODULE_ID;
export const FLAG_KEY = "sonar";

export const DEFAULTS = {
  /** Seconds between automatic pings. */
  pingInterval: 6,
  /** Seconds a ring takes to travel to the scene edge. */
  pingDuration: 4,
  /** Max simultaneous rings per emitter. */
  maxRings: 3,
  /** dB per intensity point (reserved for audio feedback). */
  dbPerIntensity: 1,
  /** Max simultaneous listeners (reserved). */
  maxListeners: 8,
  /** 0..1 how much distance dims a returned echo. */
  echoAttenuation: 0.5,
  /** Wave physics: walls bounce echos back. */
  waveReflections: true,
  /** Wavefront travel speed, scene px per second. */
  waveSpeed: 400,
  /** Interference + lattice excitation simulation on. */
  wavePhysics: true,
  /** Persistent per-coordinate node memory on. */
  memoryEnabled: true,
  /** Seconds a memory stays warm (0 = never fades). */
  memoryRetention: 3600,
  /** Snapshot-match tolerance: 0 = strict image, 0.9 = loose. */
  trackMatchTolerance: 0.25,
  /** Draw expanding rings on the game canvas. */
  showRingSprites: true,
  /** Viewer refresh rate. */
  viewerFps: 24,
  /** Grid units of height per floor storey (Levels-aware projection). */
  storeyHeight: 10,
};

export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 100;

/** What an emitter broadcasts: sound sweeps, light flashes, or both. */
export const EMISSION_MODES = new Set(["both", "sound", "light"]);

/** Facing convention: degrees, 0 = up (−Y), clockwise. fov 360 = omnidirectional. */
export const ANGLE_MIN = 0;
export const ANGLE_MAX = 359;
export const FOV_MIN = 5;
export const FOV_MAX = 360;

/** Per-emitter ping rate: 0 = use the global interval, else seconds between pings. */
export const RATE_MIN = 0;
export const RATE_MAX = 60;

/** Feedback tones: distinct return signatures (ring weight + blink rate). */
export const TONES = {
  low: { blink: 3.2, weight: 3 },
  mid: { blink: 2.0, weight: 2 },
  high: { blink: 1.1, weight: 1 },
};
export const TONE_IDS = Object.keys(TONES);

/** Clamp helper. */
export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Default sonar config for an object. */
export function defaultObjectConfig() {
  return {
    intensity: 60,
    muted: false,
    mode: "both",
    angle: 0,
    fov: 360,
    rate: 0,
    tone: "mid",
  };
}

/** Normalize a raw object config from flags. */
export function normalizeConfig(raw) {
  const cfg = defaultObjectConfig();
  if (!raw || typeof raw !== "object") return cfg;
  if (Number.isFinite(raw.intensity)) cfg.intensity = clamp(Math.round(raw.intensity), INTENSITY_MIN, INTENSITY_MAX);
  if (typeof raw.muted === "boolean") cfg.muted = raw.muted;
  if (EMISSION_MODES.has(raw.mode)) cfg.mode = raw.mode;
  if (Number.isFinite(raw.angle)) cfg.angle = clamp(Math.round(raw.angle), ANGLE_MIN, ANGLE_MAX);
  if (Number.isFinite(raw.fov)) cfg.fov = clamp(Math.round(raw.fov), FOV_MIN, FOV_MAX);
  if (Number.isFinite(raw.rate)) cfg.rate = clamp(Math.max(0, raw.rate), RATE_MIN, RATE_MAX);
  if (TONE_IDS.includes(raw.tone)) cfg.tone = raw.tone;
  return cfg;
}

/** Distance helper. */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Scene diagonal, used for ring travel time and attenuation falloff. */
export function sceneDiagonal(scene) {
  return Math.hypot(scene?.dimensions?.width ?? 0, scene?.dimensions?.height ?? 0) || 1;
}

/** Convert scene coords to normalized 0..1 within scene bounds. */
export function normalizePos(x, y, scene) {
  const w = scene?.dimensions?.width ?? 1;
  const h = scene?.dimensions?.height ?? 1;
  return {
    nx: clamp(x / w, 0, 1),
    ny: clamp(y / h, 0, 1),
  };
}

/** Settings keys (registered in touch.js). */
export const SETTINGS = {
  PING_INTERVAL: "pingInterval",
  PING_DURATION: "pingDuration",
  MAX_RINGS: "maxRings",
  DB_PER_INTENSITY: "dbPerIntensity",
  MAX_LISTENERS: "maxListeners",
  ECHO_ATTENUATION: "echoAttenuation",
  SHOW_RING_SPRITES: "showRingSprites",
  VIEWER_FPS: "viewerFps",
  STOREY_HEIGHT: "storeyHeight",
  CAMS: "cameras",
  WAVE_REFLECTIONS: "waveReflections",
  WAVE_SPEED: "waveSpeed",
  WAVE_ENABLED: "wavePhysics",
  MEMORY_ENABLED: "memoryEnabled",
  MEMORY_RETENTION: "memoryRetention",
  TRACK_MATCH_TOLERANCE: "trackMatchTolerance",
};
