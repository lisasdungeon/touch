/**
 * e2e/foundry-mock.mjs — Foundry VTT environment mock for Touch end-to-end tests.
 * Simulates game/canvas/Hooks/ui/CONFIG, ApplicationV2 + Handlebars rendering
 * with a real DOM (happy-dom), a socket layer, and a sample scene.
 */
import { Window } from "happy-dom";
import Handlebars from "handlebars";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
export const MODULE_ROOT = path.resolve(__dirname, "..", "touch");

// ---------------------------------------------------------------- DOM setup
const window = new Window();
const document = window.document;
document.body.innerHTML = "<div id='ui'></div>";
globalThis.window = window;
globalThis.document = document;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.CustomEvent = window.CustomEvent;
globalThis.performance = window.performance ?? globalThis.performance;
window.HTMLCanvasElement.prototype.getContext = () => ({
  scale() {}, strokeText() {}, fillText() {},
  textAlign: "center", textBaseline: "middle", lineJoin: "round",
  globalAlpha: 1, font: "", lineWidth: 1, strokeStyle: "", fillStyle: "",
});

// ------------------------------------------------------------ localization
const LANG = JSON.parse(fs.readFileSync(path.join(MODULE_ROOT, "lang", "en.json"), "utf8"));
function lookup(obj, key) {
  let cur = obj;
  for (const part of key.split(".")) {
    cur = cur?.[part];
    if (cur === undefined) return null;
  }
  return typeof cur === "string" ? cur : null;
}
const i18n = {
  localize(key) {
    const v = lookup(LANG, key);
    if (v === null) throw new Error(`Missing localization: ${key}`);
    return v;
  },
  format(key, data) {
    let v = lookup(LANG, key);
    if (v === null) throw new Error(`Missing localization: ${key}`);
    for (const [k, val] of Object.entries(data ?? {})) v = v.replaceAll(`{${k}}`, String(val));
    return v;
  },
};

// -------------------------------------------------------------- sample scene
class Collection {
  #map = new Map();
  constructor(contents = []) { contents.forEach((c) => this.#map.set(c.id, c)); }
  get(id) { return this.#map.get(id) ?? null; }
  get contents() { return [...this.#map.values()]; }
  set(id, doc) { this.#map.set(id, doc); }
  get size() { return this.#map.size; }
  // Foundry collections are iterable and spreadable
  *[Symbol.iterator]() { yield* this.#map.values(); }
  forEach(fn, thisArg) { for (const v of this.#map.values()) fn.call(thisArg, v); }
  some(fn) { return this.contents.some(fn); }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  find(fn) { return this.contents.find(fn); }
}

let docCounter = 0;
class MockDoc {
  constructor(kind, data, collection, scene) {
    this.id = data.id ?? `doc${++docCounter}`;
    this.kind = kind;
    this.collection = collection;
    this.scene = scene;
    this.data = { name: "", elevation: 0, ...data };
    this.flags = data.flags ?? {};
  }
  get name() { return this.data.name; }
  get elevation() { return this.data.elevation ?? 0; }
  get x() { return this.data.x ?? 0; }
  get y() { return this.data.y ?? 0; }
  get width() { return this.data.width ?? 1; }
  get height() { return this.data.height ?? 1; }
  get hidden() { return this.data.hidden ?? false; }
  get c() { return this.data.c; }
  async update(patch) {
    for (const [k, v] of Object.entries(patch)) this.data[k] = v;
    const position = this.object?.center ?? this.object?.source ?? this.object?.sound ?? this.object?.midpoint;
    if (position && patch.x !== undefined) position.x = patch.x;
    if (position && patch.y !== undefined) position.y = patch.y;
    if (this.object?.midpoint && Array.isArray(patch.c)) {
      this.object.midpoint.x = (patch.c[0] + patch.c[2]) / 2;
      this.object.midpoint.y = (patch.c[1] + patch.c[3]) / 2;
    }
    for (const h of Hooks.events[hookName(this.kind)] ?? []) h(this, patch);
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  async unsetFlag(scope, key) {
    if (this.flags[scope]) delete this.flags[scope][key];
    for (const h of Hooks.events[hookName(this.kind)] ?? []) h(this, { flags: { [scope]: this.flags[scope] } });
  }
  async setFlag(scope, key, value) {
    this.flags[scope] = this.flags[scope] ?? {};
    this.flags[scope][key] = value;
    // Real Foundry fires the document's update hook on every setFlag/update.
    for (const h of Hooks.events[hookName(this.kind)] ?? []) h(this, { flags: { [scope]: this.flags[scope] } });
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hookName = (kind) => `update${({ light: "AmbientLight", sound: "AmbientSound" }[kind] ?? cap(kind))}`;

class MockScene {
  constructor() {
    this.id = "scene-sample";
    this.name = "Sample Dungeon";
    this.tokens = new Collection();
    this.lights = new Collection();
    this.sounds = new Collection();
    this.walls = new Collection();
    this.tiles = new Collection();
  }
}

function buildSampleScene() {
  const scene = new MockScene();
  const mk = (kind, collection, data, extras = {}) => {
    const doc = new MockDoc(kind, data, collection, scene);
    collection.set(doc.id, doc);
    for (const [k, v] of Object.entries(extras)) doc[k] = v;
    return doc;
  };

  // Four tokens at different elevations/floors
  mk("token", scene.tokens, { id: "tok-hero", name: "Hero", elevation: 0, x: 500, y: 500 }, {
    object: { center: { x: 500, y: 500 }, visible: true },
    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
  });
  mk("token", scene.tokens, { id: "tok-orc", name: "Orc Brute", elevation: 0, x: 1200, y: 300 }, {
    object: { center: { x: 1200, y: 300 }, visible: true },
    disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
  });
  mk("token", scene.tokens, {
    id: "tok-balcony", name: "Balcony Sniper", elevation: 10,
    flags: { levels: { rangeBottom: 10, rangeTop: 20 } },
  }, {
    object: { center: { x: 700, y: 800 }, visible: true },
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
  });
  mk("token", scene.tokens, { id: "tok-hidden", name: "Hidden Trap", elevation: 0, x: 200, y: 900 }, {
    object: { center: { x: 200, y: 900 }, visible: false },
    disposition: CONST.TOKEN_DISPOSITIONS.SECRET,
  });

  // A light, a sound, walls
  mk("light", scene.lights, { id: "lit-torch", name: "Torch", elevation: 0, x: 600, y: 400, hidden: false }, {
    object: { source: { x: 600, y: 400, dim: 60, active: true, color: { get: () => 0xffaa33 } } },
  });
  mk("sound", scene.sounds, { id: "snd-water", name: "Water", elevation: 0, x: 300, y: 300, hidden: false }, {
    object: { sound: { x: 300, y: 300, active: true } },
    sound: { get: () => ({ detectionModes: { audio: "GB" } }) },
  });
  mk("tile", scene.tiles, { id: "tile-platform", name: "Moving Platform", elevation: 0, x: 900, y: 900, hidden: false }, {
    object: { center: { x: 900, y: 900 }, visible: true },
  });
  mk("wall", scene.walls, { id: "wl-1", name: "Wall A", elevation: 0, x: 800, y: 500, c: [700, 500, 900, 500] }, {
    object: { midpoint: { x: 800, y: 500 } },
    flags: { touch: { sonar: { intensity: 40, muted: false } } },
  });

  return scene;
}

// ----------------------------------------------------------------- globals
globalThis.CONST = {
  TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1, SECRET: -2 },
  WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
  WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 },
};
globalThis.game = {
  i18n,
  user: { isGM: true },
  settings: {
    store: new Map(),
    register(id, key, data) { this.store.set(key, data); },
    get(id, key) { const e = this.store.get(key); return e?.value ?? e?.default; },
    async set(id, key, value) { this.store.get(key).value = value; },
  },
  socket: {
    handlers: new Map(),
    outbox: [],
    // Real Foundry SocketInterface API: `on` to subscribe, `emit` to send.
    // (`register` was a mock-only invention that crashed real v14.)
    on(name, fn) { this.handlers.set(name, fn); },
    // Real Foundry does not loop socket broadcasts back to the sender.
    emit(name, payload) { this.outbox.push({ name, payload }); },
  },
  modules: new Map([
    ["levels", { active: true }],
    ["wall-height", { active: true }],
  ]),
};
for (const [key, def] of [
  ["pingInterval", 6], ["pingDuration", 4], ["maxRings", 3],
  ["dbPerIntensity", 1], ["maxListeners", 8], ["echoAttenuation", 0.5],
  ["showRingSprites", true], ["viewerFps", 24], ["storeyHeight", 10],
  ["cameras", {}], ["globalIntensity", 100], ["globalMuted", false],
]) game.settings.register("touch", key, { default: def });

globalThis.ui = {
  notifications: {
    info: (m) => console.log(`  [notify] ${m}`),
    warn: (m) => console.log(`  [notify] ${m}`),
    error: (m) => console.log(`  [notify] ${m}`),
  },
};

// v1 Dialog.prompt: resolves via a canned return value tests can set.
globalThis.Dialog = {
  _next: undefined, // set to a string (or null to simulate cancel) before use
  async prompt({ callback }) {
    if (globalThis.Dialog._next === undefined) return null;
    const value = globalThis.Dialog._next;
    globalThis.Dialog._next = undefined;
    return typeof callback === "function" ? callback({ querySelector: () => ({ value }) }) : value;
  },
};

// Scene flag storage backing getFlag/setFlag on the scene itself
MockScene.prototype.getFlag = function (scope, key) { return this.flags?.[scope]?.[key]; };
MockScene.prototype.setFlag = async function (scope, key, value) {
  this.flags ??= {};
  this.flags[scope] ??= {};
  this.flags[scope][key] = value;
};

const sampleScene = buildSampleScene();
const gameRef = game;
globalThis.canvas = {
  ready: true,
  scene: sampleScene,
  dimensions: { sceneWidth: 2000, sceneHeight: 1500, sceneX: 0, sceneY: 0, size: 100, distance: 5 },
  touchRings: {
    active: true,
    sprites: [],
    emit(origin, opts) { this.sprites.push(opts ?? {}); },
  },
  animatePan: () => {},
};

// Stub PIXI for layer classes (not exercised visually in tests)
globalThis.PIXI = {
  VERSION: "7.4.2",
  Container: class {
    constructor() {
      this.children = [];
      this.position = { set: (x, y) => { this.x = x; this.y = y; } };
      this.destroyed = false; this.eventMode = "auto"; this.cursor = ""; this.hitArea = null; this.listeners = new Map();
    }
    addChild(c) { c.parent?.removeChild?.(c); this.children.push(c); c.parent = this; return c; }
    removeChild(c) { this.children = this.children.filter((child) => child !== c); c.parent = null; return c; }
    removeChildren() { const c = this.children; this.children = []; for (const child of c) child.parent = null; return c; }
    destroy() { this.destroyed = true; this.removeChildren(); }
    sortChildren() { this.children.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)); }
    on(name, fn) { const listeners = this.listeners.get(name) ?? []; listeners.push(fn); this.listeners.set(name, listeners); return this; }
    off(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((listener) => listener !== fn)); return this; }
    async emit(name, ...args) { return Promise.all((this.listeners.get(name) ?? []).map((listener) => listener(...args))); }
    listenerCount(name) { return (this.listeners.get(name) ?? []).length; }
  },
  Graphics: class {
    constructor() {
      this.instructions = [];
      this.position = { set: (x, y) => { this.x = x; this.y = y; } };
      this.destroyed = false;
    }
    moveTo(x, y) { this.instructions.push(["moveTo", x, y]); return this; }
    lineTo(x, y) { this.instructions.push(["lineTo", x, y]); return this; }
    closePath() { this.instructions.push(["closePath"]); return this; }
    arc(...args) { this.instructions.push(["arc", ...args]); return this; }
    lineStyle(...args) { this.instructions.push(["lineStyle", ...args]); return this; }
    beginFill(...args) { this.instructions.push(["beginFill", ...args]); return this; }
    drawCircle(...args) { this.instructions.push(["drawCircle", ...args]); return this; }
    endFill() { this.instructions.push(["endFill"]); return this; }
    clear() { this.instructions = []; return this; }
    destroy() { this.destroyed = true; }
  },
  Text: class {
    constructor(options, style) {
      this.text = typeof options === "object" ? options.text : options;
      this.style = typeof options === "object" ? options.style : style;
      if (PIXI.VERSION.startsWith("7") && typeof this.style?.stroke === "object") {
        throw new Error("PIXI 7 text stroke must be a color value");
      }
      this.anchor = { set() {} };
      this.position = { set: (x, y) => { this.x = x; this.y = y; } };
      this.eventMode = "auto";
      this.destroyed = false;
    }
    destroy() { this.destroyed = true; }
  },
  Texture: { from: (source) => ({ source, destroyed: false, destroy() { this.destroyed = true; } }) },
  Sprite: class {
    constructor(texture) {
      this.texture = texture;
      this.position = { set: (x, y) => { this.x = x; this.y = y; } };
      this.width = 0; this.height = 0; this.alpha = 1; this.eventMode = "auto"; this.destroyed = false;
    }
    destroy() { this.destroyed = true; }
  },
  Rectangle: class { constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; } },
};
canvas.stage = new PIXI.Container();
canvas.stage.worldTransform = { applyInverse: (point) => ({ x: point.x, y: point.y }) };
canvas.primary = { group: new PIXI.Container() };
canvas.interface = new PIXI.Container();
canvas.stage.addChild(canvas.primary.group);
canvas.stage.addChild(canvas.interface);
canvas.grid = { isGridless: false, isSquare: true, size: 100 };

globalThis.Hooks = {
  events: {},
  once(name, fn) { (this.events[name] ??= []).push(fn); },
  on(name, fn) { (this.events[name] ??= []).push(fn); },
  callAll(name, ...args) { for (const fn of this.events[name] ?? []) fn(...args); },
};

globalThis.CONFIG = { Canvas: { layers: {} } };

// --------------------------------------------------- ApplicationV2 mock w/ Handlebars
const hbs = Handlebars.create();
globalThis.Handlebars = hbs; // helpers.js registers on the global
hbs.registerHelper("localize", (key) => i18n.localize(key));
hbs.registerHelper("checked", (v) => (v ? "checked" : ""));
hbs.registerHelper("kindIcon", (kind) => {
  const icons = {
    token: "fa-solid fa-user", light: "fa-solid fa-lightbulb",
    sound: "fa-solid fa-volume-high", wall: "fa-solid fa-border-all",
  };
  return icons[kind] ?? "fa-solid fa-circle";
});
hbs.registerHelper("eq", (a, b) => a === b);
hbs.registerHelper("gt", (a, b) => a > b);

function makeAppBase() {
  return class MockApplication {
    static DEFAULT_OPTIONS = {};
    static PARTS = {};
    rendered = false;
    element = null;
    constructor(options = {}) { this.options = options; }
    get title() { return this.options.title ?? "App"; }
    get id() { return this.options.id ?? "app"; }
    async _prepareContext(_options) { return {}; }
    async _preRender(_context, _options) {}
    async _onRender(_context, _options) {}
    async _renderTemplate(_part, context) {
      // Resolve the template declared by the subclass, like ApplicationV2 does.
      const tpl = Object.values(this.constructor.PARTS)[0]?.template ?? "viewer.hbs";
      const tplPath = path.join(MODULE_ROOT, "templates", path.basename(tpl));
      const src = fs.readFileSync(tplPath, "utf8");
      return hbs.compile(src)(context);
    }
    async render(_opts = {}) {
      const ctx = await this._prepareContext({});
      this.element?.remove(); // re-render replaces, like ApplicationV2
      const container = document.createElement("div");
      container.className = `mock-window mock-${this.id}`;
      container.innerHTML = await this._renderTemplate("main", ctx);
      document.body.appendChild(container);
      this.element = container;
      this.rendered = true;
      // ApplicationV2's ActionsManager delegates clicks on [data-action].
      container.addEventListener("click", (event) => {
        const target = event.target?.closest?.("[data-action]");
        if (!target) return;
        const action = this.constructor.DEFAULT_OPTIONS?.actions?.[target.dataset.action];
        if (action) action.call(this, event, target);
      });
      this._onRender?.(ctx, {});
      return this;
    }
    async close(_opts = {}) {
      this.element?.remove();
      this.rendered = false;
    }
  };
}

const AppV2 = makeAppBase();
globalThis.foundry = {
  utils: {
    Color: class { constructor(v) { this.v = v; } },
    mergeObject: (base, patch) => ({ ...(base ?? {}), ...patch }),
  },
  applications: { api: { ApplicationV2: AppV2, HandlebarsApplicationMixin: (base) => base } },
  canvas: {
    layers: {
      CanvasLayer: class extends PIXI.Container {
        static get layerOptions() { return {}; }
        constructor() { super(); this.options = this.constructor.layerOptions; }
        async _draw() {}
        async draw() { await this._draw(); return this; }
        async tearDown() { this.removeChildren(); }
      },
    },
  },
};

// ---------------------------------- Wall Height module reaction simulator
// Mirrors wall-height 4.1.x (patches.js/const.js): updateWall hook ->
// schedulePerceptionUpdate + wall refresh (drawWallRange prints top/bottom),
// and ClockwiseSweepPolygon._testEdgeInclusion extent filtering.
globalThis.mockState = { whLog: [] };
globalThis.ChatMessage = {
  create: async (msg) => { globalThis.mockState.whLog.push({ type: "chat", content: msg?.content ?? "" }); },
};
globalThis.libWrapper = {
  register(_scope, path) { globalThis.mockState.whLog.push({ type: "wrap", path }); },
};
canvas.perception = {
  update: (opts) => globalThis.mockState.whLog.push({ type: "perception", opts }),
};
canvas.tokens = { controlled: [] };
function makeWallHeightSim() {
  const log = globalThis.mockState.whLog;
  const getWallBounds = (wall) => {
    const doc = wall.document ?? wall;
    return {
      top: doc.flags?.["wall-height"]?.top ?? Infinity,
      bottom: doc.flags?.["wall-height"]?.bottom ?? -Infinity,
    };
  };
  class Sim {
    constructor() {
      this._currentTokenElevation = null;
      this.isLevels = game.modules.get("levels")?.active ?? false;
    }
    // Real signature: schedulePerceptionUpdate(reinitializeLightSources = true)
    schedulePerceptionUpdate(reinitialize = true) {
      if (!canvas.ready) return;
      if (reinitialize) this.reinitializeLightSources();
      canvas.perception.update({
        initializeLightSources: true, initializeSounds: true, initializeVision: true,
        refreshLighting: true, refreshSounds: true, refreshOcclusion: true, refreshVision: true,
      }, true);
    }
    reinitializeLightSources() { log.push({ type: "reinitLightSources" }); }
    updateCurrentTokenElevation() {
      const token = canvas.tokens.controlled.find((t) => t.document?.sight?.enabled) ?? canvas.tokens.controlled[0];
      this._token = token ?? null;
      this._currentTokenElevation = token?.document?.elevation ?? null;
    }
  }
  const sim = new Sim();
  sim.getWallBounds = getWallBounds;
  sim.sweepIncludes = (wall, sourceElevation, sourceTop) => {
    // Emulates _testEdgeInclusion: source band must fit inside [bottom, top].
    const { top, bottom } = getWallBounds(wall);
    const b = sourceElevation ?? -Infinity;
    const t = sourceTop ?? sourceElevation ?? Infinity;
    return b >= bottom && t <= top;
  };
  sim.registerHooks = () => {
    Hooks.on("updateWall", (wall, updates) => {
      if (updates.flags && updates.flags["wall-height"]) sim.schedulePerceptionUpdate(false);
      const { top, bottom } = getWallBounds(wall);
      log.push({ type: "wallRefresh", id: wall.id, top, bottom }); // drawWallRange effect
    });
    Hooks.on("updateToken", () => sim.updateCurrentTokenElevation());
    Hooks.on("controlToken", () => sim.updateCurrentTokenElevation());
  };
  return sim;
}
globalThis.WallHeightSim = makeWallHeightSim();
WallHeightSim.registerHooks();

/** Attach the same direct interface surfaces used in Foundry. */
globalThis.setupCanvasLayers = async () => {
  const { ensureTouchCanvasLayers } = await import("../touch/scripts/canvasLayers.js");
  return ensureTouchCanvasLayers();
};

export { document, sampleScene, i18n, hbs, gameRef as game };
