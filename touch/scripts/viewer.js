/** Touch viewer application and interaction handlers. */
import { CAMERAS } from "./constants.js";
import { levelsActive, getLevelsRange, getWallHeightRange } from "./elevation.js";
import { flushWaves as paintWaves, flushFrames as paintFrames, syncStatus } from "./viewer-paint.js";

const hexColor = (color, fallback) =>
  typeof color === "number" ? `#${color.toString(16).padStart(6, "0")}` : (color ?? fallback);

export class SonarViewer extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "touch-viewer",
    tag: "div",
    window: {
      title: "TOUCH.Viewer.Title",
      icon: "fa-solid fa-tower-broadcast",
      contentTag: "div",
      contentClasses: ["touch-viewer"],
    },
    position: { width: 760, height: 560 },
    actions: {
      scan: SonarViewer.#onScan,
      calibrate: SonarViewer.#onCalibrate,
      togglePause: SonarViewer.#onTogglePause,
    },
  };

  static PARTS = { main: { template: "modules/touch/templates/viewer.hbs" } };

  frames = new Map();
  paused = false;
  floorFilter = null;
  hypergrid = null;
  #gridMount = 0;

  get title() {
    return `${game.i18n.localize("TOUCH.Viewer.Title")} — ${canvas.scene?.name ?? ""}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const count = window.touch?.emitters?.().length ?? 0;
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    return {
      ...context,
      scene: { id: canvas.scene?.id ?? "", name: canvas.scene?.name ?? "" },
      cameras: CAMERAS.map((camera) => ({ ...camera })),
      paused: this.paused,
      storeyHeight,
      floors: this.#floorLines(),
      floorOptions: this.#floorOptions(),
      floorFilter: this.floorFilter,
      bands: this.#bands(),
      levelsOn: levelsActive(),
      objects: game.i18n.format("TOUCH.Viewer.Objects", { count }),
    };
  }

  #floorLines() {
    const height = game.settings.get("touch", "storeyHeight") ?? 10;
    const storeys = new Set([0]);
    for (const emitter of window.touch?.emitters?.() ?? []) {
      const levels = emitter.doc?.flags?.levels ?? {};
      const z = Number.isFinite(levels.rangeBottom)
        ? levels.rangeBottom
        : Number.isFinite(levels.rangeTop)
          ? levels.rangeTop - height
          : (emitter.elevation ?? 0);
      storeys.add(Math.floor(z / height));
    }
    return [...storeys].sort((a, b) => b - a).map((storey) => ({ storey }));
  }

  #floorOptions() {
    const height = game.settings.get("touch", "storeyHeight") ?? 10;
    const options = [{ value: "", label: game.i18n.localize("TOUCH.Viewer.FloorAll") }];
    for (const { storey } of [...this.#floorLines()].sort((a, b) => a.storey - b.storey)) {
      options.push({
        value: String(storey),
        label: game.i18n.format("TOUCH.Viewer.FloorOption", {
          storey,
          from: storey * height,
          to: (storey + 1) * height,
        }),
        selected: this.floorFilter === storey,
      });
    }
    return options;
  }

  #bands() {
    const unit = Math.abs(Number(game.settings.get("touch", "storeyHeight")) || 10);
    const bands = [];
    for (const emitter of window.touch?.emitters?.() ?? []) {
      if (emitter.kind !== "wall" && emitter.kind !== "light") continue;
      const levels = getLevelsRange(emitter.doc);
      const wallHeight = getWallHeightRange(emitter.doc);
      const hasLevels = levels.bottom !== null || levels.top !== null;
      const hasWallHeight = wallHeight.bottom !== null || wallHeight.top !== null;
      if (!hasLevels && !hasWallHeight) continue;
      const bottom = hasLevels ? levels.bottom : wallHeight.bottom;
      const top = hasLevels ? levels.top : wallHeight.top;
      const rawBottom = bottom ?? (top !== null ? top - unit : null);
      const rawTop = top ?? (bottom !== null ? bottom + unit : null);
      if (rawBottom == null && rawTop == null) continue;
      const low = Math.max(rawBottom ?? rawTop - unit, -unit);
      const high = Math.min(rawTop ?? low + unit, unit * 3);
      const format = (value) => value == null ? "∞" : `${value}u`;
      bands.push({
        key: emitter.id,
        kind: emitter.kind,
        label: `${emitter.name ?? game.i18n.localize(emitter.kind === "wall" ? "TOUCH.Viewer.BandWall" : "TOUCH.Viewer.BandLight")} — ${hasLevels ? "Levels" : "Wall Height"} ${format(rawBottom)}→${format(rawTop)}`,
        x: emitter.x,
        y: emitter.y,
        bottomElevation: low,
        topElevation: high,
        accent: emitter.kind === "wall" ? "#94a3b8" : hexColor(emitter.color, "#ffd88a"),
      });
    }
    return bands;
  }

  getBands() {
    return this.#bands();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.dataset.paused = String(this.paused);
    this.element.querySelector(".touch-floor-select")?.addEventListener("change", (event) => {
      this.floorFilter = event.target.value === "" ? null : Number(event.target.value);
      this.flush();
    });
    this.#syncStatus();
    this.#startBeatTicker();
    this.#mountHypergrid();
  }

  async #mountHypergrid() {
    const host = this.element?.querySelector("[data-hypergrid]");
    const mount = ++this.#gridMount;
    this.hypergrid?.destroy?.();
    this.hypergrid = null;
    if (!host) return;
    const { HyperGrid } = await import("./hypergrid.js");
    if (mount !== this.#gridMount || !this.rendered || host !== this.element?.querySelector("[data-hypergrid]")) return;
    this.hypergrid = new HyperGrid(host);
    this.refreshHypergrid();
  }

  #beatTicker = null;

  #startBeatTicker() {
    this.#stopBeatTicker();
    const step = () => {
      if (!this.rendered || !this.element) {
        this.#beatTicker = null;
        return;
      }
      const status = this.element.querySelector("[data-status]");
      if (status) {
        let heart = status.querySelector(".touch-heart");
        if (!heart) {
          heart = document.createElement("i");
          heart.className = "touch-heart fa-solid fa-heart-pulse";
          heart.setAttribute("aria-hidden", "true");
          status.appendChild(heart);
        }
        const beats = window.touch?.heartbeats?.() ?? new Map();
        let dueIn = null;
        for (const value of beats.values()) dueIn = dueIn === null ? value : Math.min(dueIn, value);
        if (dueIn !== null && !this.paused) {
          heart.style.animationDuration = `${Math.max(0.3, Math.min(1.3, 0.3 + dueIn * 0.12))}s`;
          heart.dataset.due = String(dueIn);
          heart.title = game.i18n.format("TOUCH.Viewer.NextBeat", { n: dueIn });
        } else {
          heart.style.animationDuration = "1.6s";
          heart.dataset.due = "";
        }
      }
      this.#beatTicker = setTimeout(step, 1000);
      this.#beatTicker.unref?.();
    };
    step();
  }

  #stopBeatTicker() {
    if (this.#beatTicker) {
      clearTimeout(this.#beatTicker);
      this.#beatTicker = null;
    }
  }

  async close(options) {
    this.#gridMount++;
    this.hypergrid?.destroy?.();
    this.hypergrid = null;
    this.#stopBeatTicker();
    return super.close(options);
  }

  flushWaves() { paintWaves(this); }
  ingestFrame(frame) {
    if (!this.frames.has(frame.cam)) this.frames.set(frame.cam, new Map());
    this.frames.get(frame.cam).set(frame.id, frame);
  }
  flush() { paintFrames(this); }
  refreshHypergrid() {
    if (!this.hypergrid || !this.element) return;
    const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
    this.hypergrid.update({
      frames: this.frames,
      floorFilter: this.floorFilter,
      tracks: window.touch?.trackList?.() ?? [],
      wavefield: window.touch?.wavefield,
      memory: window.touch?.memoryMap?.() ?? [],
      memoryColor: window.touch?.heatColor,
      bands: this.#bands(),
      scene: canvas.scene,
      storeyHeight,
      waveSpeed: game.settings.get("touch", "waveSpeed") ?? 400,
    });
  }
  #syncStatus() { syncStatus(this); }

  static #onScan() { window.touch?.pinger?.pulse({ broadcast: true }); }

  static #onCalibrate() {
    this.frames.clear();
    this.floorFilter = null;
    this.element?.querySelectorAll(".touch-blip").forEach((element) => element.remove());
    const select = this.element?.querySelector(".touch-floor-select");
    if (select) select.value = "";
    this.refreshHypergrid();
  }

  static #onTogglePause() {
    this.paused = !this.paused;
    this.element.dataset.paused = String(this.paused);
    this.#syncStatus();
  }
}
