/** Touch module bootstrap: settings, layers, sockets, and canvas lifecycle. */
import { MODULE_ID, SOCKET_NAME, SOCKET_MESSAGES, DEFAULTS, CAMERAS, SETTINGS } from "./constants.js";
import { collectWalls } from "./emitters.js";
import { registerHelpers } from "./helpers.js";
import { registerRuntime } from "./runtime.js";
import { bindCanvasInteractions, unbindCanvasInteractions } from "./canvasInteractions.js";

let viewerClassPromise;
let hubClassPromise;
let canvasLayersPromise;

async function loadViewerClass() {
  viewerClassPromise ??= import("./viewer.js").then(({ SonarViewer }) => SonarViewer);
  return viewerClassPromise;
}

async function loadHubClass() {
  hubClassPromise ??= import("./hub.js").then(({ SonarHub }) => SonarHub);
  return hubClassPromise;
}

async function loadCanvasLayers() {
  canvasLayersPromise ??= import("./canvasLayers.js");
  return canvasLayersPromise;
}

function addSceneControlGroup(controls) {
  const actionTool = (name, title, icon, action) => ({
    name, title, icon, button: true, toggle: false, visible: true,
    onClick: action,
    onChange: (...args) => {
      const active = args.length > 1 ? args.at(-1) : args[0];
      return active ? action() : undefined;
    },
  });
  const modeTool = (name, title, icon, armed, setArmed) => ({
    name, title, icon, button: false, toggle: true, visible: true, active: armed(),
    onClick: () => setArmed(!armed()),
    onChange: (...args) => setArmed(Boolean(args.length > 1 ? args.at(-1) : args[0])),
  });
  const tools = [
    actionTool("touch-viewer", "TOUCH.Controls.Viewer", "fa-solid fa-display", () => window.touch?.openViewer()),
  ];
  if (game.user.isGM) tools.push(actionTool("touch-hub", "TOUCH.Controls.Hub", "fa-solid fa-sliders", () => window.touch?.openHub()));
  tools.push(
    modeTool("touch-waypoint", "TOUCH.Controls.Waypoint", "fa-solid fa-location-dot", () => Boolean(canvas?.touchWaypoints?.armed), (active) => window.touch?.setWaypointDeploy(active)),
    modeTool("touch-pathway", "TOUCH.Controls.Pathway", "fa-solid fa-route", () => Boolean(canvas?.touchPathways?.armed), (active) => window.touch?.setPathwayDraw(active)),
  );
  const group = {
    name: "touch",
    title: "TOUCH.Controls.Touch",
    icon: "fa-solid fa-tower-broadcast",
    order: 100,
    layer: "tokens",
    visible: true,
    tools: Array.isArray(controls) ? tools : Object.fromEntries(tools.map((tool, index) => [tool.name, { ...tool, order: index }])),
  };
  if (Array.isArray(controls)) {
    if (!controls.some((control) => control?.name === group.name)) controls.push(group);
  } else if (controls && typeof controls === "object") controls[group.name] = group;
}

Hooks.once("init", () => {
  console.debug("Touch | init");
  Hooks.on("getSceneControlButtons", addSceneControlGroup);
  registerHelpers();
  game.touch = { viewer: null, hub: null, pinger: null, cameras: null };
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  const settings = [
    [SETTINGS.PING_INTERVAL, "PingInterval", "world", true, Number, DEFAULTS.pingInterval],
    [SETTINGS.PING_DURATION, "PingDuration", "world", true, Number, DEFAULTS.pingDuration],
    [SETTINGS.MAX_RINGS, "MaxRings", "world", true, Number, DEFAULTS.maxRings],
    [SETTINGS.DB_PER_INTENSITY, "DbPerIntensity", "world", false, Number, DEFAULTS.dbPerIntensity],
    [SETTINGS.MAX_LISTENERS, "MaxListeners", "world", false, Number, DEFAULTS.maxListeners],
    [SETTINGS.ECHO_ATTENUATION, "EchoAttenuation", "world", true, Number, DEFAULTS.echoAttenuation],
    [SETTINGS.SHOW_RING_SPRITES, "ShowRingSprites", "world", true, Boolean, DEFAULTS.showRingSprites],
    [SETTINGS.WAVE_ENABLED, "WaveEnabled", "world", true, Boolean, DEFAULTS.wavePhysics],
    [SETTINGS.WAVE_REFLECTIONS, "WaveReflections", "world", true, Boolean, DEFAULTS.waveReflections],
    [SETTINGS.WAVE_SPEED, "WaveSpeed", "world", true, Number, DEFAULTS.waveSpeed],
    [SETTINGS.MEMORY_ENABLED, "MemoryEnabled", "world", true, Boolean, DEFAULTS.memoryEnabled],
    [SETTINGS.MEMORY_RETENTION, "MemoryRetention", "world", true, Number, DEFAULTS.memoryRetention],
    [SETTINGS.TRACK_MATCH_TOLERANCE, "TrackTolerance", "world", true, Number, DEFAULTS.trackMatchTolerance],
    [SETTINGS.VIEWER_FPS, "ViewerFps", "client", true, Number, DEFAULTS.viewerFps],
  ];
  for (const [key, label, scope, config, type, value] of settings) {
    register(key, {
      name: `TOUCH.Settings.${label}Name`,
      hint: `TOUCH.Settings.${label}Hint`,
      scope,
      config,
      type,
      default: value,
      ...(key === SETTINGS.TRACK_MATCH_TOLERANCE ? { range: { min: 0, max: 0.9, step: 0.05 } } : {}),
    });
  }
  register(SETTINGS.CAMS, {
    scope: "world",
    config: false,
    type: Object,
    default: Object.fromEntries(CAMERAS.map((camera) => [camera.id, { enabled: true }])),
  });
  register(SETTINGS.STOREY_HEIGHT, {
    name: "TOUCH.Settings.StoreyHeightName",
    hint: "TOUCH.Settings.StoreyHeightHint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.storeyHeight,
  });
  register("globalIntensity", { scope: "world", config: false, type: Number, default: 60 });
  register("globalMuted", { scope: "world", config: false, type: Boolean, default: false });

  game.socket.on(SOCKET_NAME, (payload) => {
    if (!payload?.type) return;
    if (payload.type === SOCKET_MESSAGES.PINGS) window.touch?.pinger?.receive(payload);
    if (payload.type === SOCKET_MESSAGES.REQUEST_SYNC && game.user.isGM) window.touch?.syncTo?.(payload.userId);
  });
});

Hooks.once("ready", () => {
  const refresh = setTimeout(() => ui.controls?.render?.(true), 500);
  refresh?.unref?.();
});

Hooks.on("canvasReady", async () => {
  try {
    const { ensureTouchCanvasLayers } = await loadCanvasLayers();
    await ensureTouchCanvasLayers();
  } catch (error) {
    console.error("Touch | Live canvas surfaces failed to initialize", error);
    ui.notifications?.error("Touch | Live scene overlay failed to initialize. Check the console for details.");
  }
  if (game.user.isGM) window.touch?.pinger?.start();
  if (window.touch?.viewer?.rendered) window.touch.viewer.render();
  window.touch?.wavefield?.setWalls(canvas.scene?.id, collectWalls(canvas.scene));
  window.touch?.wavefield?.clear();
  window.touch?.memory?.load(canvas.scene);
  window.touch?.tracks?.load(canvas.scene);
  canvas.touchHypergrid?.refreshHypergrid();
  canvas.touchZones?.refreshZones();
  bindCanvasInteractions();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene?.id !== canvas?.scene?.id) return;
  if (["width", "height", "padding", "grid"].some((key) => key in (changes ?? {}))) {
    canvas.touchHypergrid?.rebuildGeometry?.();
    canvas.touchZones?.refreshZones();
  }
});

Hooks.on("canvasTearDown", () => {
  unbindCanvasInteractions();
  window.touch?.pinger?.stop();
  canvasLayersPromise?.then(({ teardownTouchCanvasLayers }) => teardownTouchCanvasLayers());
});
registerRuntime(loadViewerClass, loadHubClass);
