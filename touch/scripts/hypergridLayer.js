/** Lightweight live-scene projection of Touch's voxel room and memory. */
import {
  CELL_FEET,
  GRID_AXIS,
  PHYSICAL_CUBE_COUNT,
  PHYSICAL_WAYPOINT_COUNT,
  ROOM_FEET,
  VOXEL_EDGE_COUNT,
  sceneWaypoint,
} from "./hypergrid.js?release=0.1.14";
import { fillCircle, strokeCircle, strokePath } from "./pixiCompat.js?release=0.1.14";

const LASER = 0x5eead4;
const VOXEL_GAP = 0.08;
let threeRoomPromise;

function loadThreeRoom() {
  threeRoomPromise ??= import("./threeRoom.js?release=0.1.14");
  return threeRoomPromise;
}

function gridPixels(dimensions) {
  const distance = Math.max(1, Number(dimensions.distance) || CELL_FEET);
  const native = Math.max(1, Number(dimensions.size) || 100) * CELL_FEET / distance;
  const widthFit = Math.max(1, Number(dimensions.sceneWidth) || native * GRID_AXIS) / (GRID_AXIS * 1.32);
  const heightFit = Math.max(1, Number(dimensions.sceneHeight) || native * GRID_AXIS) / (GRID_AXIS * 0.5);
  return Math.min(native, widthFit, heightFit);
}

function roomSurface(dimensions) {
  const distance = Math.max(1, Number(dimensions.distance) || CELL_FEET);
  const physicalPixels = Math.max(1, Number(dimensions.size) || 100) * ROOM_FEET / distance;
  return {
    x: Number(dimensions.sceneX) || 0,
    y: Number(dimensions.sceneY) || 0,
    width: Math.min(Math.max(1, Number(dimensions.sceneWidth) || physicalPixels), physicalPixels),
    height: Math.min(Math.max(1, Number(dimensions.sceneHeight) || physicalPixels), physicalPixels),
  };
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

export class HypergridLayer extends foundry.canvas.layers.CanvasLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "touchHypergrid", zIndex: 59 });
  }

  async _draw() {
    await super._draw();
    await this.rebuildGeometry();
  }

  /** Rebuild static geometry only when Foundry creates or resizes the scene. */
  async rebuildGeometry() {
    const build = (this.buildId ?? 0) + 1;
    this.buildId = build;
    this.#disposeWebGL();
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.voxels = null;
    this.memory = null;
    if (!canvas.scene || !canvas.dimensions) return;
    const dimensions = canvas.dimensions;
    const surface = roomSurface(dimensions);
    try {
      const { createThreeRoomRenderer } = await loadThreeRoom();
      if (build !== this.buildId || this.destroyed) return;
      const room = createThreeRoomRenderer({
        width: surface.width,
        height: surface.height,
        axis: GRID_AXIS,
      });
      if (room) {
        this.#mountWebGL(room, surface);
        this.refreshHypergrid();
        return;
      }
    } catch (error) {
      console.warn("Touch | WebGL room unavailable; using PIXI wireframe fallback.", error);
    }
    if (build !== this.buildId || this.destroyed) return;
    this.#buildPixiFallback(dimensions);
  }

  #buildPixiFallback(dimensions) {
    const step = gridPixels(dimensions);
    const voxels = new PIXI.Graphics();
    const memory = new PIXI.Graphics();
    voxels.eventMode = "none";
    memory.eventMode = "none";
    this.#drawVoxels(voxels, step, dimensions);
    this.addChild(voxels);
    this.addChild(memory);
    if (typeof voxels.cacheAsTexture === "function") {
      voxels.cacheAsTexture({ resolution: 0.5, antialias: false });
      this.cacheMode = "texture";
    } else {
      voxels.cacheAsBitmap = true;
      this.cacheMode = "bitmap";
    }
    this.voxels = voxels;
    this.lattice = voxels;
    this.memory = memory;
    this.step = step;
    this.cubeCount = PHYSICAL_CUBE_COUNT;
    this.waypointCount = PHYSICAL_WAYPOINT_COUNT;
    this.voxelEdgeCount = VOXEL_EDGE_COUNT;
    this.refreshHypergrid();
  }

  /** Pings update only the small memory surface; static voxels stay cached. */
  refreshHypergrid(pings = []) {
    if (this.threeRoom) {
      const dimensions = canvas.dimensions;
      const options = {
        dimensions,
        storeyHeight: Math.max(1, Number(game.settings.get("touch", "storeyHeight")) || 10),
      };
      const markers = [];
      for (const record of window.touch?.memoryMap?.() ?? []) {
        const point = memoryPoint(record, options);
        if (point) markers.push({ ...point, color: heatColor(record.currentHeat) });
      }
      this.threeRoom.setMarkers(markers);
      this.threeRoom.flashContacts(pings, dimensions, CELL_FEET);
      this.#updateTexture();
      return;
    }
    if (!this.voxels || !this.memory) return this.rebuildGeometry();
    this.memory.clear?.();
    this.#drawMemory(this.memory, this.step, canvas.dimensions);
  }

  #mountWebGL(room, surface) {
    const texture = PIXI.Texture.from(room.canvas);
    const sprite = new PIXI.Sprite(texture);
    sprite.eventMode = "none";
    sprite.position.set(surface.x, surface.y);
    sprite.width = surface.width;
    sprite.height = surface.height;
    sprite.alpha = 0.9;
    this.addChild(sprite);
    this.threeRoom = room;
    this.webglTexture = texture;
    room.onRender = () => this.#updateTexture();
    this.voxels = sprite;
    this.lattice = sprite;
    this.memory = sprite;
    this.cacheMode = "webgl";
    this.renderMode = "three-webgl";
    this.cubeCount = PHYSICAL_CUBE_COUNT;
    this.waypointCount = PHYSICAL_WAYPOINT_COUNT;
    this.voxelEdgeCount = VOXEL_EDGE_COUNT;
  }

  #updateTexture() {
    this.webglTexture?.source?.update?.();
    this.webglTexture?.baseTexture?.update?.();
  }

  #disposeWebGL() {
    if (!this.threeRoom) return;
    this.threeRoom.onRender = null;
    this.threeRoom.dispose();
    this.webglTexture?.destroy?.(true);
    this.threeRoom = null;
    this.webglTexture = null;
  }

  destroy(options) {
    this.buildId = (this.buildId ?? 0) + 1;
    this.#disposeWebGL();
    return super.destroy(options);
  }

  #drawVoxels(graphics, step, dimensions) {
    const pairs = [
      [0, 1], [0, 2], [0, 4], [7, 3], [7, 5], [7, 6],
      [1, 3], [1, 5], [2, 3], [2, 6], [4, 5], [4, 6],
    ];
    strokePath(graphics, { width: 0.5, color: LASER, alpha: 0.14 }, (target) => {
      const line = (from, to) => target.moveTo(from.x, from.y).lineTo(to.x, to.y);
      for (let y = 0; y < GRID_AXIS; y++) for (let z = 0; z < GRID_AXIS; z++) {
        for (let x = 0; x < GRID_AXIS; x++) {
          const low = VOXEL_GAP;
          const high = 1 - VOXEL_GAP;
          const points = [
            project(x + low, y + low, z + low, step, dimensions),
            project(x + high, y + low, z + low, step, dimensions),
            project(x + low, y + high, z + low, step, dimensions),
            project(x + high, y + high, z + low, step, dimensions),
            project(x + low, y + low, z + high, step, dimensions),
            project(x + high, y + low, z + high, step, dimensions),
            project(x + low, y + high, z + high, step, dimensions),
            project(x + high, y + high, z + high, step, dimensions),
          ];
          for (const [from, to] of pairs) line(points[from], points[to]);
        }
      }
    });
  }

  #drawMemory(graphics, step, dimensions) {
    if (!dimensions) return;
    const options = {
      dimensions,
      storeyHeight: Math.max(1, Number(game.settings.get("touch", "storeyHeight")) || 10),
    };
    for (const record of window.touch?.memoryMap?.() ?? []) {
      const point = memoryPoint(record, options);
      if (!point) continue;
      const position = project(point.x, point.y, point.z, step, dimensions);
      const color = heatColor(record.currentHeat);
      fillCircle(graphics, position.x, position.y, Math.max(2, step / 20), { color, alpha: 0.88 });
      strokeCircle(graphics, position.x, position.y, Math.max(3, step / 15), { width: 1, color, alpha: 0.82 });
    }
  }
}
