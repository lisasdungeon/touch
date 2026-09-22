/**
 * Touch — waypoint canvas layer.
 * Draws deployable waypoints (diamond + facing cone) and hosts their
 * interaction: click-to-deploy while the tool is armed, drag to move.
 * Ring emission stays in rings.js; this layer is the persistent visual.
 */
import { getWaypoints } from "./waypoints.js";

const DEG = Math.PI / 180;
const WP_COLOR = 0x5eead4;

export class WaypointLayer extends foundry.canvas.layers.CanvasLayer {
  constructor() {
    super();
    this._armed = false;
    this._drag = null;
  }

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "touchWaypoints",
      zIndex: 62,
    });
  }

  get armed() { return this._armed; }

  setArmed(value, { notify = true } = {}) {
    this._armed = Boolean(value);
    if (this._armed && canvas.touchPathways?.armed) canvas.touchPathways.setArmed(false, { notify: false });
    if (canvas.stage) canvas.stage.cursor = (canvas.touchWaypoints?.armed || canvas.touchPathways?.armed) ? "crosshair" : "default";
    if (notify) ui.notifications?.info(
      this._armed ? "Touch | Click the scene to deploy a waypoint" : "Touch | Waypoint deploy disarmed"
    );
    return this._armed;
  }

  /** @override */
  async _draw() {
    await super._draw();
    this.waypoints = new PIXI.Container();
    this.addChild(this.waypoints);
    this.refreshWaypoints();
  }

  /** Redraw all waypoint markers from scene flags. */
  refreshWaypoints() {
    if (!this.waypoints) return;
    this.waypoints.removeChildren().forEach((c) => c.destroy({ children: true }));
    const scene = canvas.scene;
    if (!scene) return;
    for (const wp of getWaypoints(scene)) {
      const cfg = wp.config ?? {};
      const holder = new PIXI.Container();
      holder.position.set(wp.x, wp.y);
      holder.eventMode = "static";
      holder.cursor = "grab";
      holder.wpId = wp.id;

      // Facing cone (underneath the marker)
      const cone = new PIXI.Graphics();
      this.#drawCone(cone, cfg.angle ?? 0, cfg.fov ?? 360);
      holder.addChild(cone);

      // Diamond marker (junction waypoints get a cross-in-diamond look)
      const marker = new PIXI.Graphics();
      marker.moveTo(0, -7).lineTo(6, 0).lineTo(0, 7).lineTo(-6, 0).closePath()
        .fill({ color: wp.junction ? 0xfbbf24 : WP_COLOR, alpha: 0.9 })
        .stroke({ width: 1, color: 0x0a0f14, alpha: 0.8 });
      if (wp.junction) {
        marker.moveTo(-4, 0).lineTo(4, 0).moveTo(0, -4).lineTo(0, 4)
          .stroke({ width: 1.5, color: 0x0a0f14, alpha: 0.9 });
      }
      holder.addChild(marker);

      // Hit area + drag handlers
      holder.hitArea = new PIXI.Rectangle(-10, -10, 20, 20);
      holder.on("pointerdown", (e) => this.#onDragStart(e, wp.id));
      holder.on("pointerup", (e) => this.#onDragEnd(e, wp.id));
      holder.on("pointerupoutside", (e) => this.#onDragEnd(e, wp.id));
      this.waypoints.addChild(holder);
    }
  }

  /** Sector (or full circle) from a facing angle with a given field of view. */
  #drawCone(g, angleDeg, fovDeg, radius = 34) {
    const half = (fovDeg / 2) * DEG;
    const center = (angleDeg - 90) * DEG; // 0° = up in screen space
    g.moveTo(0, 0);
    if (fovDeg >= 360) {
      g.circle(0, 0, radius).fill({ color: WP_COLOR, alpha: 0.18 });
      return;
    }
    g.arc(0, 0, radius, center - half, center + half)
      .lineTo(0, 0)
      .closePath()
      .fill({ color: WP_COLOR, alpha: 0.28 });
    g.arc(0, 0, radius, center - half, center + half)
      .stroke({ width: 1, color: WP_COLOR, alpha: 0.5 });
  }

  // ------------------------------------------------------------- interaction

  /** Deploy at a scene position (called by the tool's click handler). */
  async deployAt(scenePoint) {
    const { deployWaypoint } = await import("./waypoints.js");
    const wp = await deployWaypoint(canvas.scene, {
      x: scenePoint.x,
      y: scenePoint.y,
      elevation: 0,
    });
    this.refreshWaypoints();
    window.touch?.pinger?.emitOne({
      id: wp.id, kind: "waypoint", name: wp.name,
      x: wp.x, y: wp.y, elevation: wp.elevation ?? 0,
      color: null, config: wp.config,
    });
    return wp;
  }

  #onDragStart(event, id) {
    if (this._armed) return; // deploy mode: clicks deploy, not drag
    this._drag = { id, offsetX: event.global.x, offsetY: event.global.y };
    event.stopPropagation();
  }

  async #onDragEnd(event, id) {
    if (!this._drag || this._drag.id !== id) return;
    this._drag = null;
    const nx = event.global.x;
    const ny = event.global.y;
    const wp = getWaypoints(canvas.scene).find((w) => w.id === id);
    if (!wp) return;
    if (Math.hypot(nx - wp.x, ny - wp.y) < 3) {
      event.stopPropagation();
      return; // treat as click, not move
    }
    const { updateWaypoint } = await import("./waypoints.js");
    await updateWaypoint(canvas.scene, id, { x: nx, y: ny });
    this.refreshWaypoints();
    window.touch?.pinger?.emitOne({
      id, kind: "waypoint", name: wp.name, x: nx, y: ny,
      elevation: wp.elevation ?? 0, color: null, config: wp.config,
    });
    event.stopPropagation();
  }
}
