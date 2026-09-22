/**
 * Touch — ring sprite layer.
 * Draws expanding sonar rings on the game canvas. Omnidirectional emitters
 * (fov 360) produce full circles; cone emitters (fov < 360) produce expanding
 * arc sweeps in their facing direction. Rings are clipped by walls when the
 * token layer provides an LOS/interior point source.
 */
export class RingLayer extends foundry.canvas.layers.CanvasLayer {
  constructor() {
    super();
    this.sprites = [];
    this._active = true;
    this._frame = null;
    /** Channel filter: "both" | "sound" | "light" | null (all). */
    this.channel = null;
  }

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "touchRings",
      zIndex: 60,
    });
  }

  /** @override */
  async _draw() {
    await super._draw();
    this.rings = new PIXI.Container();
    this.addChild(this.rings);
  }

  get active() { return this._active; }
  set active(v) { this._active = v; }

  /**
   * Spawn one expanding ring or arc.
   * @param {object} origin   {x, y} canvas-space position
   * @param {object} [opts]
   * @param {number} [opts.color]        hex tint
   * @param {number} [opts.duration]     seconds to live
   * @param {number} [opts.maxRadius]    px
   * @param {number} [opts.angle]        facing degrees (0 = up)
   * @param {number} [opts.fov]          cone width degrees (360 = circle)
   * @param {string} [opts.mode]         "both" | "sound" | "light"
   * @param {string} [opts.tone]         "low" | "mid" | "high" (ring weight)
   */
  emit(origin, { color = 0x5eead4, duration = 4, maxRadius = 1000, angle = 0, fov = 360, mode = "both", tone = "mid" } = {}) {
    if (!this.rings) return;
    if (this.channel && mode !== "both" && mode !== this.channel) return;
    const g = new PIXI.Graphics();
    g.position.set(origin.x, origin.y);
    this.rings.addChild(g);
    const t = performance.now();
    const weight = tone === "low" ? 4 : tone === "high" ? 1 : 2;
    this.sprites.push({ g, t, duration, maxRadius, color, angle, fov, weight });
    this.#startDrawing();
  }

  #startDrawing() {
    if (this._frame !== null) return;
    const draw = () => {
      this._frame = null;
      this.refresh();
      if (!this.sprites.length) return;
      if (globalThis.requestAnimationFrame) this._frame = requestAnimationFrame(draw);
      else {
        this._frame = setTimeout(draw, 16);
        this._frame.unref?.();
      }
    };
    draw();
  }

  /** Compatibility shim for the old positional signature. */
  emitLegacy(origin, color, duration, maxRadius) {
    this.emit(origin, { color, duration, maxRadius });
  }

  /** @override */
  refresh() {
    if (!this.rings) return;
    const now = performance.now();
    this.sprites = this.sprites.filter((s) => {
      const p = (now - s.t) / (s.duration * 1000);
      if (p >= 1) {
        s.g.destroy();
        return false;
      }
      const r = 6 + p * s.maxRadius;
      const alpha = 0.55 * (1 - p);
      s.g.clear();
      if (s.fov >= 360) {
        s.g.circle(0, 0, r).stroke({ width: s.weight, color: s.color, alpha });
        s.g.circle(0, 0, r * 0.86).stroke({ width: 1, color: s.color, alpha: alpha * 0.45 });
      } else {
        const half = (s.fov / 2) * (Math.PI / 180);
        const center = (s.angle - 90) * (Math.PI / 180); // 0° = up
        s.g.arc(0, 0, r, center - half, center + half).stroke({ width: s.weight, color: s.color, alpha });
        s.g.moveTo(0, 0)
          .lineTo(Math.cos(center - half) * r, Math.sin(center - half) * r)
          .moveTo(0, 0)
          .lineTo(Math.cos(center + half) * r, Math.sin(center + half) * r)
          .stroke({ width: 1, color: s.color, alpha: alpha * 0.7 });
      }
      return true;
    });
  }

  /** @override */
  tearDown() {
    if (this._frame !== null) {
      globalThis.cancelAnimationFrame?.(this._frame);
      clearTimeout(this._frame);
      this._frame = null;
    }
    this.sprites.forEach((s) => s.g?.destroy());
    this.sprites = [];
    return super.tearDown();
  }
}
