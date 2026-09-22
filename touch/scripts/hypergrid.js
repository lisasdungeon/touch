/** Fixed 4D CSS room: stacked five-foot wireframe cubes and memory waypoints. */
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

function latticePosition(x, y, z) {
  const step = 10;
  return { x: `${(x - GRID_AXIS / 2) * step}px`, y: `${(GRID_AXIS / 2 - y) * step}px`, z: `${(z - GRID_AXIS / 2) * step}px` };
}

function place(element, x, y, z) {
  const point = latticePosition(x, y, z);
  element.style.setProperty("--tx", point.x);
  element.style.setProperty("--ty", point.y);
  element.style.setProperty("--tz", point.z);
  return element;
}

function makeCube(x, y, z) {
  const cube = document.createElement("i");
  cube.className = "touch-hyper-cube";
  cube.dataset.x = String(x);
  cube.dataset.y = String(y);
  cube.dataset.z = String(z);
  cube.setAttribute("aria-hidden", "true");
  return place(cube, x, y, z);
}

function makeWaypoint(x, y, z) {
  const waypoint = document.createElement("i");
  waypoint.className = "touch-hyper-waypoint";
  waypoint.dataset.x = String(x);
  waypoint.dataset.y = String(y);
  waypoint.dataset.z = String(z);
  waypoint.setAttribute("aria-hidden", "true");
  return place(waypoint, x, y, z);
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
    this.cubes = new Map();
    this.waypoints = new Map();
    this.active = new Set();
    this.lastPayload = null;
    this.destroyed = false;
    this.nextCube = 0;
    this.nextWaypoint = 0;
    this.root = document.createElement("div");
    this.root.className = "touch-hypergrid-space";
    host.replaceChildren(this.root);
    host.dataset.hypergridState = "loading";
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.#buildChunk();
  }

  #schedule(callback) {
    if (globalThis.requestAnimationFrame) return globalThis.requestAnimationFrame(callback);
    return setTimeout(callback, 0);
  }

  #buildChunk() {
    if (this.destroyed) return;
    const fragment = document.createDocumentFragment();
    if (this.nextCube < PHYSICAL_CUBE_COUNT) {
      const end = Math.min(PHYSICAL_CUBE_COUNT, this.nextCube + 160);
      for (; this.nextCube < end; this.nextCube++) {
        const x = this.nextCube % GRID_AXIS;
        const z = Math.floor(this.nextCube / GRID_AXIS) % GRID_AXIS;
        const y = Math.floor(this.nextCube / (GRID_AXIS * GRID_AXIS));
        const cube = makeCube(x, y, z);
        this.cubes.set(pointId(x, y, z), cube);
        fragment.appendChild(cube);
      }
    } else {
      const end = Math.min(PHYSICAL_WAYPOINT_COUNT, this.nextWaypoint + 240);
      for (; this.nextWaypoint < end; this.nextWaypoint++) {
        const x = this.nextWaypoint % WAYPOINT_AXIS;
        const z = Math.floor(this.nextWaypoint / WAYPOINT_AXIS) % WAYPOINT_AXIS;
        const y = Math.floor(this.nextWaypoint / (WAYPOINT_AXIS * WAYPOINT_AXIS));
        const waypoint = makeWaypoint(x, y, z);
        this.waypoints.set(pointId(x, y, z), waypoint);
        fragment.appendChild(waypoint);
      }
    }
    this.root.appendChild(fragment);
    if (this.nextCube < PHYSICAL_CUBE_COUNT || this.nextWaypoint < PHYSICAL_WAYPOINT_COUNT) {
      this.buildTimer = this.#schedule(() => this.#buildChunk());
      return;
    }
    this.host.dataset.hypergridState = "ready";
    this.resolveReady?.(this);
    if (this.lastPayload) this.update(this.lastPayload);
  }

  #clear() {
    for (const waypoint of this.active) {
      waypoint.classList.remove("touch-hyper-active", "touch-hyper-memory");
      delete waypoint.dataset.time;
      delete waypoint.dataset.memory;
      delete waypoint.dataset.track;
      delete waypoint.dataset.group;
      delete waypoint.dataset.trackHead;
      delete waypoint.dataset.priority;
      waypoint.removeAttribute("title");
      waypoint.style.removeProperty("--touch-cell-color");
      waypoint.style.removeProperty("--touch-cell-energy");
      waypoint.style.removeProperty("--touch-time-opacity");
    }
    this.active.clear();
  }

  #activate(cell, source, energy = 1, memory = false) {
    const waypoint = this.waypoints.get(pointId(cell.x, cell.y, cell.z));
    if (!waypoint) return;
    if (memory) {
      waypoint.classList.add("touch-hyper-memory");
      waypoint.dataset.memory = "true";
      this.active.add(waypoint);
    }
    const priority = number(source?.priority, 0);
    const currentPriority = number(waypoint.dataset.priority, 0);
    const currentTime = Number(waypoint.dataset.time ?? GRID_AXIS);
    if (priority < currentPriority || (priority === currentPriority && cell.t > currentTime)) return;
    waypoint.classList.add("touch-hyper-active");
    waypoint.dataset.time = String(cell.t);
    waypoint.dataset.priority = String(priority);
    waypoint.style.setProperty("--touch-cell-color", sourceColor(source));
    waypoint.style.setProperty("--touch-cell-energy", String(clamp(energy, 0.16, 1)));
    waypoint.style.setProperty("--touch-time-opacity", String(1 - cell.t / GRID_AXIS * 0.78));
    if (source?.trail) {
      waypoint.dataset.track = source.trackId;
      if (source.groupId) waypoint.dataset.group = source.groupId;
      else delete waypoint.dataset.group;
      waypoint.dataset.trackHead = source.head ? "1" : "0";
      waypoint.title = source.groupId ? `${source.label ?? source.trackId}\n${source.groupId}` : (source.label ?? source.trackId);
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
        this.#activate(sceneWaypoint(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, elevation, options.now, options), {
          color: pathway.lattice ? "#5eead4" : "#9cbaff",
        }, pathway.lattice ? 0.56 : 0.4);
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
    this.lastPayload = payload;
    this.#clear();
    const options = {
      floorFilter: payload.floorFilter ?? null,
      storeyHeight: Math.max(1, number(payload.storeyHeight, 10)),
      now: payload.now ?? Date.now(),
      dimensions: payload.dimensions ?? canvas?.dimensions ?? {},
      memoryColor: payload.memoryColor,
    };
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
        if (this.#inFloor(elevation, options.floorFilter, options.storeyHeight)) {
          const recency = index / Math.max(1, points.length - 1);
          this.#activate(sceneWaypoint(point.x, point.y, elevation, point.t, options), {
            color: trackColor(track.groupId ?? track.id),
            priority: 2,
            trail: true,
            trackId: track.id,
            groupId: track.groupId,
            label: track.label,
            head: index === points.length - 1,
          }, 0.16 + 0.72 * recency);
        }
      }
    }
    for (const wave of [...(payload.wavefield?.waves ?? []), ...(payload.wavefield?.echos ?? [])]) {
      if (!this.#inFloor(number(wave.elevation), options.floorFilter, options.storeyHeight)) continue;
      const radius = Math.max(0, (options.now - number(wave.born, options.now)) / 1000 * number(payload.waveSpeed, 400));
      for (let index = 0; index < 48; index++) {
        const angle = index / 48 * Math.PI * 2;
        this.#activate(sceneWaypoint(wave.x + Math.cos(angle) * radius, wave.y + Math.sin(angle) * radius, wave.elevation, wave.born, options), {
          color: wave.echo ? "#fbbf24" : "#5eead4",
        }, 0.5);
      }
    }
    this.#activatePathways(payload.scene, options);
    this.#activateBands(payload.bands, options);
    return this.active;
  }

  destroy() {
    this.destroyed = true;
    if (this.buildTimer) {
      globalThis.cancelAnimationFrame?.(this.buildTimer);
      clearTimeout(this.buildTimer);
    }
    this.active.clear();
    this.cubes.clear();
    this.waypoints.clear();
    this.host.replaceChildren();
  }
}
