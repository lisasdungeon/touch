/** Fixed 4D room: deterministic SVG lattice with memory-bearing corners. */
import { getPathways } from "./pathways.js";

export const CELL_FEET = 5;
export const ROOM_FEET = 100;
export const GRID_AXIS = ROOM_FEET / CELL_FEET;
export const WAYPOINT_AXIS = GRID_AXIS + 1;
export const TIME_CELL_SECONDS = 5;
export const PHYSICAL_CUBE_COUNT = GRID_AXIS ** 3;
export const PHYSICAL_WAYPOINT_COUNT = WAYPOINT_AXIS ** 3;
export const HYPERCELL_COUNT = GRID_AXIS ** 4;
export const HYPERWAYPOINT_COUNT = PHYSICAL_WAYPOINT_COUNT * GRID_AXIS;
export const LATTICE_SEGMENT_COUNT = 3 * WAYPOINT_AXIS ** 2;
export const VOXEL_EDGE_COUNT = PHYSICAL_CUBE_COUNT * 12;

const SVG_NS = "http://www.w3.org/2000/svg";
const VOXEL_GAP = 0.08;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function pointId(x, y, z) {
  return `${x}:${y}:${z}`;
}

function sourceColor(source) {
  if (source?.mode === "sound") return "#a78bfa";
  if (source?.mode === "light") return "#fbbf24";
  if (typeof source?.color === "number") return `#${source.color.toString(16).padStart(6, "0")}`;
  return typeof source?.color === "string" ? source.color : "#5eead4";
}

function trackColor(id) {
  let hue = 0;
  for (const character of String(id)) hue = (hue * 31 + character.charCodeAt(0)) % 360;
  return `hsl(${hue} 82% 68%)`;
}

/** Maps scene coordinates to a shared corner in the five-foot 4D lattice. */
export function sceneWaypoint(x, y, elevation, born, {
  dimensions = canvas?.dimensions ?? {},
  now = Date.now(),
} = {}) {
  const pixelGrid = Math.max(1, number(dimensions.size, 100));
  const sceneGridFeet = Math.max(1, number(dimensions.distance, CELL_FEET));
  const toFeet = (pixels, origin) => (number(pixels) - number(origin)) / pixelGrid * sceneGridFeet;
  const age = Math.max(0, now - number(born, now)) / 1000;
  return {
    x: clamp(Math.round(toFeet(x, dimensions.sceneX) / CELL_FEET), 0, GRID_AXIS),
    y: clamp(Math.round(number(elevation) / CELL_FEET), 0, GRID_AXIS),
    z: clamp(Math.round(toFeet(y, dimensions.sceneY) / CELL_FEET), 0, GRID_AXIS),
    t: clamp(Math.floor(age / TIME_CELL_SECONDS), 0, GRID_AXIS - 1),
  };
}

export const sceneCell = sceneWaypoint;

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function project(x, y, z) {
  return {
    x: 320 + (x - GRID_AXIS / 2) * 13 + (z - GRID_AXIS / 2) * 6.5,
    y: 168 - y * 5.8 + (z - GRID_AXIS / 2) * 3,
  };
}

function pathPoint(point) {
  return `${Number(point.x.toFixed(2))},${Number(point.y.toFixed(2))}`;
}

function edges(points, pairs) {
  return pairs.map(([from, to]) => `M${pathPoint(points[from])}L${pathPoint(points[to])}`).join("");
}

function cubePoints(x, y, z) {
  const low = VOXEL_GAP;
  const high = 1 - VOXEL_GAP;
  return [
    project(x + low, y + low, z + low),
    project(x + high, y + low, z + low),
    project(x + low, y + high, z + low),
    project(x + high, y + high, z + low),
    project(x + low, y + low, z + high),
    project(x + high, y + low, z + high),
    project(x + low, y + high, z + high),
    project(x + high, y + high, z + high),
  ];
}

function voxelTier(y) {
  const wire = [];
  const pairs = [
    [0, 1], [0, 2], [0, 4], [7, 3], [7, 5], [7, 6],
    [1, 3], [1, 5], [2, 3], [2, 6], [4, 5], [4, 6],
  ];
  for (let z = 0; z < GRID_AXIS; z++) {
    for (let x = 0; x < GRID_AXIS; x++) {
      const points = cubePoints(x, y, z);
      wire.push(edges(points, pairs));
    }
  }
  return wire.join("");
}

function buildVoxels() {
  const voxels = svgNode("g", { class: "touch-hyper-voxels" });
  for (let y = 0; y < GRID_AXIS; y++) {
    const tier = svgNode("g", {
      class: "touch-hyper-voxel-tier",
      "data-tier": y + 1,
      "data-cubes": GRID_AXIS ** 2,
    });
    tier.append(svgNode("path", { class: "touch-hyper-voxel-edges", d: voxelTier(y) }));
    voxels.appendChild(tier);
  }
  return voxels;
}

function framesForRoom(frames) {
  const source = frames?.get?.("front") ?? frames?.get?.("top");
  return source ? [...source.values()] : [];
}

function waypointForMemory(memory, options) {
  const match = /^cell\.(-?\d+),(-?\d+)@(-?\d+)$/.exec(memory?.key ?? "");
  if (!match) return null;
  const [, cellX, cellZ, storey] = match;
  return sceneWaypoint(
    Number(cellX) * 100,
    Number(cellZ) * 100,
    Number(storey) * options.storeyHeight,
    memory.lastSeen,
    options
  );
}

export class HyperGrid {
  constructor(host) {
    this.host = host;
    this.active = new Set();
    this.waypoints = new Map();
    this.destroyed = false;
    this.physicalCubeCount = PHYSICAL_CUBE_COUNT;
    this.physicalWaypointCount = PHYSICAL_WAYPOINT_COUNT;
    this.voxelEdgeCount = VOXEL_EDGE_COUNT;
    this.svg = svgNode("svg", {
      class: "touch-hypergrid-svg",
      viewBox: "0 0 640 220",
      preserveAspectRatio: "xMidYMid meet",
      "aria-hidden": "true",
    });
    this.voxels = buildVoxels();
    this.tiers = [...this.voxels.querySelectorAll(".touch-hyper-voxel-tier")];
    this.lattice = this.voxels;
    this.markers = svgNode("g", { class: "touch-hyper-markers" });
    this.svg.append(this.voxels, this.markers);
    host.replaceChildren(this.svg);
    host.dataset.hypergridRenderer = "voxels";
    host.dataset.hypergridState = "ready";
    host.dataset.cubes = String(PHYSICAL_CUBE_COUNT);
    host.dataset.waypoints = String(PHYSICAL_WAYPOINT_COUNT);
    this.ready = Promise.resolve(this);
  }

  #clear() {
    this.markers.replaceChildren();
    this.active.clear();
    this.waypoints.clear();
  }

  #filterTiers(floorFilter, storeyHeight) {
    const filtered = floorFilter !== null;
    const bottom = filtered ? floorFilter * storeyHeight : 0;
    const top = filtered ? bottom + storeyHeight : ROOM_FEET;
    this.host.dataset.floorMode = filtered ? "filtered" : "all";
    for (let index = 0; index < this.tiers.length; index++) {
      const elevation = index * CELL_FEET;
      this.tiers[index].style.display = !filtered || (elevation >= bottom && elevation < top) ? "" : "none";
    }
  }

  #marker(cell) {
    const id = pointId(cell.x, cell.y, cell.z);
    let waypoint = this.waypoints.get(id);
    if (waypoint) return waypoint;
    const point = project(cell.x, cell.y, cell.z);
    waypoint = svgNode("circle", {
      class: "touch-hyper-waypoint touch-hyper-active",
      cx: point.x,
      cy: point.y,
      r: 2,
      "data-x": cell.x,
      "data-y": cell.y,
      "data-z": cell.z,
    });
    this.waypoints.set(id, waypoint);
    this.markers.appendChild(waypoint);
    return waypoint;
  }

  #activate(cell, source, energy = 1, memory = false) {
    const id = pointId(cell.x, cell.y, cell.z);
    const existing = this.waypoints.get(id);
    const priority = number(source?.priority, 0);
    const currentPriority = number(existing?.dataset.priority, 0);
    const currentTime = Number(existing?.dataset.time ?? GRID_AXIS);
    if (existing && (priority < currentPriority || (priority === currentPriority && cell.t > currentTime))) return;
    const waypoint = existing ?? this.#marker(cell);
    if (memory) {
      waypoint.classList.add("touch-hyper-memory");
      waypoint.dataset.memory = "true";
    }
    waypoint.dataset.time = String(cell.t);
    waypoint.dataset.priority = String(priority);
    waypoint.style.setProperty("--touch-cell-color", sourceColor(source));
    waypoint.style.setProperty("--touch-cell-energy", String(clamp(energy, 0.16, 1)));
    waypoint.style.setProperty("--touch-time-opacity", String(1 - cell.t / GRID_AXIS * 0.78));
    waypoint.setAttribute("r", String(1.5 + clamp(energy, 0.16, 1) * 2.2));
    if (source?.trail) {
      waypoint.dataset.track = source.trackId;
      if (source.groupId) waypoint.dataset.group = source.groupId;
      else delete waypoint.dataset.group;
      waypoint.dataset.trackHead = source.head ? "1" : "0";
      waypoint.title = source.groupId
        ? `${source.label ?? source.trackId}\n${source.groupId}`
        : (source.label ?? source.trackId);
    }
    this.active.add(waypoint);
  }

  #inFloor(elevation, filter, storeyHeight) {
    return filter === null || Math.floor(elevation / storeyHeight) === filter;
  }

  #activateMemory(records, options) {
    for (const memory of records ?? []) {
      const cell = waypointForMemory(memory, options);
      if (!cell || !this.#inFloor(cell.y * CELL_FEET, options.floorFilter, options.storeyHeight)) continue;
      this.#activate(cell, { color: options.memoryColor?.(memory.currentHeat) ?? "#5eead4" }, memory.currentHeat, true);
    }
  }

  #activatePathways(scene, options) {
    for (const pathway of getPathways(scene)) {
      const [x1, y1, x2, y2] = pathway.c ?? [];
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      const elevation = number(pathway.elevation);
      if (!this.#inFloor(elevation, options.floorFilter, options.storeyHeight)) continue;
      for (let index = 0; index <= 40; index++) {
        const ratio = index / 40;
        const cell = sceneWaypoint(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, elevation, options.now, options);
        this.#activate(cell, { color: pathway.lattice ? "#5eead4" : "#9cbaff" }, pathway.lattice ? 0.56 : 0.4);
      }
    }
  }

  #activateBands(bands, options) {
    for (const band of bands ?? []) {
      const low = number(band.bottomElevation);
      const high = Math.max(low, number(band.topElevation));
      for (let elevation = low; elevation <= high; elevation += CELL_FEET) {
        if (!this.#inFloor(elevation, options.floorFilter, options.storeyHeight)) continue;
        this.#activate(sceneWaypoint(band.x, band.y, elevation, options.now, options), { color: band.accent }, 0.36);
      }
    }
  }

  update(payload = {}) {
    this.#clear();
    const options = {
      floorFilter: payload.floorFilter ?? null,
      storeyHeight: Math.max(1, number(payload.storeyHeight, 10)),
      now: payload.now ?? Date.now(),
      dimensions: payload.dimensions ?? canvas?.dimensions ?? {},
      memoryColor: payload.memoryColor,
    };
    this.#filterTiers(options.floorFilter, options.storeyHeight);
    this.#activateMemory(payload.memory, options);
    for (const frame of framesForRoom(payload.frames)) {
      const elevation = number(frame.storey) * options.storeyHeight;
      if (!this.#inFloor(elevation, options.floorFilter, options.storeyHeight)) continue;
      this.#activate(sceneWaypoint(frame.x, frame.y, elevation, frame.born, options), frame, number(frame.intensity, 60) / 100);
    }
    for (const track of (payload.tracks ?? []).slice(0, 16)) {
      const points = (track.points ?? []).slice(-24);
      for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const elevation = number(point.storey) * options.storeyHeight;
        if (!this.#inFloor(elevation, options.floorFilter, options.storeyHeight)) continue;
        const recency = index / Math.max(1, points.length - 1);
        this.#activate(sceneWaypoint(point.x, point.y, elevation, point.t, options), {
          color: trackColor(track.groupId ?? track.id), priority: 2, trail: true,
          trackId: track.id, groupId: track.groupId, label: track.label,
          head: index === points.length - 1,
        }, 0.16 + 0.72 * recency);
      }
    }
    for (const wave of [...(payload.wavefield?.waves ?? []), ...(payload.wavefield?.echos ?? [])]) {
      if (!this.#inFloor(number(wave.elevation), options.floorFilter, options.storeyHeight)) continue;
      const radius = Math.max(0, (options.now - number(wave.born, options.now)) / 1000 * number(payload.waveSpeed, 400));
      for (let index = 0; index < 48; index++) {
        const angle = index / 48 * Math.PI * 2;
        const cell = sceneWaypoint(wave.x + Math.cos(angle) * radius, wave.y + Math.sin(angle) * radius, wave.elevation, wave.born, options);
        this.#activate(cell, { color: wave.echo ? "#fbbf24" : "#5eead4" }, 0.5);
      }
    }
    this.#activatePathways(payload.scene, options);
    this.#activateBands(payload.bands, options);
    return this.active;
  }

  destroy() {
    this.destroyed = true;
    this.active.clear();
    this.waypoints.clear();
    this.host.replaceChildren();
  }
}
