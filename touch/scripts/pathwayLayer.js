/**
 * Touch — pathway canvas layer.
 * Draws sonar pathways (rail line + sample ticks + endpoints) and hosts the
 * draw interaction: with the Pathway tool armed, click one point, click a
 * second — the pathway between them is created and immediately pings.
 * Endpoints drag to reshape. Ring emission stays in rings.js.
 */
import { getPathways, samplePathway, createPathway } from "./pathways.js";
import { fillCircle, fillStrokeCircle, strokePath } from "./pixiCompat.js?release=0.1.12";

const PW_COLOR = 0x5eead4;

export class PathwayLayer extends foundry.canvas.layers.CanvasLayer {
  constructor() {
    super();
    this._armed = false;
    this._pending = null; // first clicked point {x, y}
    this._drag = null;    // { pathwayId, end: 0 | 1 }
  }

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "touchPathways",
      zIndex: 61,
    });
  }

  get armed() { return this._armed; }

  setArmed(value, { notify = true } = {}) {
    this._armed = Boolean(value);
    if (this._armed && canvas.touchWaypoints?.armed) canvas.touchWaypoints.setArmed(false, { notify: false });
    if (canvas.stage) canvas.stage.cursor = (canvas.touchWaypoints?.armed || canvas.touchPathways?.armed) ? "crosshair" : "default";
    if (notify) ui.notifications?.info(
      this._armed ? "Touch | Click two points to draw a sonar pathway" : "Touch | Pathway drawing disarmed"
    );
    return this._armed;
  }

  /** @override */
  async _draw() {
    await super._draw();
    this.paths = new PIXI.Container();
    this.addChild(this.paths);
    this.refreshPathways();
  }

  /** Redraw all pathway visuals from scene flags. */
  refreshPathways() {
    if (!this.paths) return;
    this.paths.removeChildren().forEach((c) => c.destroy({ children: true }));
    const scene = canvas.scene;
    if (!scene) return;
    for (const pw of getPathways(scene)) {
      const holder = new PIXI.Container();
      holder.position.set(0, 0);
      this.paths.addChild(holder);

      const rail = new PIXI.Graphics();
      const pts = samplePathway(pw);
      const [ax, ay, bx, by] = pw.c;
      strokePath(rail, { width: 3, color: PW_COLOR, alpha: 0.35, cap: "round" }, (target) =>
        target.moveTo(ax, ay).lineTo(bx, by));
      // Sample ticks: one small node per emitter point.
      for (const p of pts) {
        fillCircle(rail, p.x, p.y, 3, { color: PW_COLOR, alpha: 0.8 });
      }
      // Endpoint handles.
      for (const [hx, hy] of [[ax, ay], [bx, by]]) {
        fillStrokeCircle(
          rail, hx, hy, 6,
          { color: PW_COLOR, alpha: 0.9 },
          { width: 1, color: 0x0a0f14, alpha: 0.8 }
        );
      }
      holder.addChild(rail);

      // Endpoint drag handles.
      for (const end of [0, 1]) {
        const hit = new PIXI.Container();
        hit.position.set(pw.c[end * 2], pw.c[end * 2 + 1]);
        hit.eventMode = "static";
        hit.cursor = "grab";
        hit.hitArea = new PIXI.Rectangle(-10, -10, 20, 20);
        hit.on("pointerdown", (e) => this.#onDragStart(e, pw.id, end));
        hit.on("pointerup", (e) => this.#onDragEnd(e, pw.id, end));
        hit.on("pointerupoutside", (e) => this.#onDragEnd(e, pw.id, end));
        holder.addChild(hit);
      }
    }
  }

  // ------------------------------------------------------------- draw mode

  /**
   * Called by the scene-stage click handler when the tool is armed.
   * First click sets the pending point; second click creates the pathway.
   */
  async clickAt(scenePoint) {
    if (!this._armed) return;
    if (!this._pending) {
      this._pending = { x: scenePoint.x, y: scenePoint.y };
      this.#drawPreview(scenePoint);
      return;
    }
    const a = this._pending;
    this._pending = null;
    this.#drawPreview(null);
    const pw = await createPathway(canvas.scene, { a, b: scenePoint });
    this.refreshPathways();
    await this.pingPathway(pw);
    const { syncJunctionWaypoints } = await import("./pathways.js");
    await syncJunctionWaypoints(canvas.scene);
    this.refreshPathways();
    const { getWaypoints } = await import("./waypoints.js");
    canvas.touchWaypoints?.refreshWaypoints();
    return pw;
  }

  /** Optional rubber-band line while choosing the second point. */
  #drawPreview(at) {
    this.preview?.destroy();
    this.preview = null;
    if (!at || !this._pending) return;
    const g = new PIXI.Graphics();
    strokePath(g, { width: 2, color: PW_COLOR, alpha: 0.6, cap: "round" }, (target) =>
      target.moveTo(this._pending.x, this._pending.y).lineTo(at.x, at.y));
    this.preview = g;
    this.addChild(g);
  }

  /** Fire one ping per sample point (staggered ids), via the pinger's
   * standard makePing so master intensity and config normalization apply. */
  async pingPathway(pw) {
    const { samplePathway: samples } = await import("./pathways.js");
    const pts = samples(pw, pw.spacing);
    const emitters = pts.map((p, i) => ({
      id: `${pw.id}#${i}`,
      pathwayId: pw.id,
      kind: "pathway",
      name: pw.name,
      x: p.x,
      y: p.y,
      elevation: pw.elevation ?? 0,
      color: null,
      config: pw.config,
      doc: null,
    }));
    window.touch?.pinger?.emitMany(emitters);
  }

  // ------------------------------------------------------------- dragging

  #onDragStart(event, id, end) {
    if (this._armed) return; // draw mode: clicks draw, not drag
    this._drag = { id, end, offsetX: event.global.x, offsetY: event.global.y };
    event.stopPropagation();
  }

  async #onDragEnd(event, id, end) {
    if (!this._drag || this._drag.id !== id || this._drag.end !== end) return;
    this._drag = null;
    const nx = event.global.x;
    const ny = event.global.y;
    const pw = getPathways(canvas.scene).find((p) => p.id === id);
    if (!pw) return;
    const c = [...pw.c];
    c[end * 2] = Math.round(nx);
    c[end * 2 + 1] = Math.round(ny);
    if (c[0] === c[2] && c[1] === c[3]) {
      event.stopPropagation();
      return; // zero-length: ignore
    }
    const { updatePathway, syncJunctionWaypoints } = await import("./pathways.js");
    const next = await updatePathway(canvas.scene, id, { c });
    this.refreshPathways();
    if (next) await this.pingPathway(next);
    await syncJunctionWaypoints(canvas.scene);
    this.refreshPathways();
    canvas.touchWaypoints?.refreshWaypoints();
    event.stopPropagation();
  }

  /** Test/public hook: simulate finishing an endpoint drag. */
  async handleDragEnd(event, id, end) {
    return this.#onDragEnd(event, id, end);
  }
}
