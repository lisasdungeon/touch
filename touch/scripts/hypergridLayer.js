/** Canvas projection of Touch's fixed CSS-cube room and its memory corners. */
import { CELL_FEET, GRID_AXIS, PHYSICAL_WAYPOINT_COUNT, sceneWaypoint } from "./hypergrid.js";

const LASER = 0x5eead4;

function gridPixels(dimensions) {
  const distance = Math.max(1, Number(dimensions.distance) || CELL_FEET);
  const native = Math.max(1, Number(dimensions.size) || 100) * CELL_FEET / distance;
  const widthFit = Math.max(1, Number(dimensions.sceneWidth) || native * GRID_AXIS) / (GRID_AXIS * 1.32);
  const heightFit = Math.max(1, Number(dimensions.sceneHeight) || native * GRID_AXIS) / (GRID_AXIS * 0.5);
  return Math.min(native, widthFit, heightFit);
}

function project(x, y, z, step, dimensions) {
  const width = GRID_AXIS * step * 1.32;
  const height = GRID_AXIS * step * 0.5;
  return {
    x: dimensions.sceneX + ((dimensions.sceneWidth - width) / 2) + (x + z * 0.32) * step,
    y: dimensions.sceneY + ((dimensions.sceneHeight + height) / 2) + (z * 0.16 - y * 0.34) * step,
  };
}

function memoryPoint(memory, options) {
  const match = /^cell\.(-?\d+),(-?\d+)@(-?\d+)$/.exec(memory?.key ?? "");
  if (!match) return null;
  const [, x, z, storey] = match;
  return sceneWaypoint(
    Number(x) * 100,
    Number(z) * 100,
    Number(storey) * options.storeyHeight,
    memory.lastSeen,
    options
  );
}

function heatColor(heat) {
  const value = Math.max(0, Math.min(1, Number(heat) || 0));
  const start = value <= 0.5 ? [0x5e, 0xea, 0xd4] : [0xfb, 0xbf, 0x24];
  const end = value <= 0.5 ? [0xfb, 0xbf, 0x24] : [0xf8, 0x71, 0x71];
  const ratio = value <= 0.5 ? value / 0.5 : (value - 0.5) / 0.5;
  return start.reduce((hex, channel, index) => (hex << 8) + Math.round(channel + (end[index] - channel) * ratio), 0);
}

/**
 * A static isometric canvas view of the same 20 × 20 × 20 cube stack used
 * by the CSS viewer. It is scene-relative, uses no polling, and redraws only
 * after canvas setup or an incoming Touch event.
 */
export class HypergridLayer extends foundry.canvas.layers.CanvasLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "touchHypergrid", zIndex: 59 });
  }

  async _draw() {
    await super._draw();
    this.refreshHypergrid();
  }

  refreshHypergrid() {
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!canvas.scene || !canvas.dimensions) return;
    const dimensions = canvas.dimensions;
    const step = gridPixels(dimensions);
    const lattice = new PIXI.Graphics();
    const memory = new PIXI.Graphics();
    this.#drawLattice(lattice, step, dimensions);
    this.#drawWaypoints(lattice, step, dimensions);
    this.#drawMemory(memory, step, dimensions);
    this.addChild(lattice);
    this.addChild(memory);
    this.lattice = lattice;
    this.memory = memory;
    this.waypointCount = PHYSICAL_WAYPOINT_COUNT;
  }

  #drawLattice(graphics, step, dimensions) {
    const line = (from, to) => graphics.moveTo(from.x, from.y).lineTo(to.x, to.y);
    for (let y = 0; y <= GRID_AXIS; y++) for (let z = 0; z <= GRID_AXIS; z++) {
      line(project(0, y, z, step, dimensions), project(GRID_AXIS, y, z, step, dimensions));
    }
    for (let x = 0; x <= GRID_AXIS; x++) for (let z = 0; z <= GRID_AXIS; z++) {
      line(project(x, 0, z, step, dimensions), project(x, GRID_AXIS, z, step, dimensions));
    }
    for (let x = 0; x <= GRID_AXIS; x++) for (let y = 0; y <= GRID_AXIS; y++) {
      line(project(x, y, 0, step, dimensions), project(x, y, GRID_AXIS, step, dimensions));
    }
    graphics.stroke({ width: 1, color: LASER, alpha: 0.5, cap: "round" });
  }

  #drawWaypoints(graphics, step, dimensions) {
    const radius = Math.max(0.7, Math.min(1.5, step / 70));
    for (let x = 0; x <= GRID_AXIS; x++) for (let y = 0; y <= GRID_AXIS; y++) for (let z = 0; z <= GRID_AXIS; z++) {
      const point = project(x, y, z, step, dimensions);
      graphics.circle(point.x, point.y, radius);
    }
    graphics.fill({ color: LASER, alpha: 0.62 });
  }

  #drawMemory(graphics, step, dimensions) {
    const options = {
      dimensions,
      storeyHeight: Math.max(1, Number(game.settings.get("touch", "storeyHeight")) || 10),
    };
    for (const record of window.touch?.memoryMap?.() ?? []) {
      const point = memoryPoint(record, options);
      if (!point) continue;
      const position = project(point.x, point.y, point.z, step, dimensions);
      const color = heatColor(record.currentHeat);
      graphics.circle(position.x, position.y, Math.max(2, step / 20)).fill({ color, alpha: 0.88 });
      graphics.circle(position.x, position.y, Math.max(3, step / 15)).stroke({ width: 1, color, alpha: 0.82 });
    }
  }
}
