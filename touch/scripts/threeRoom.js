/** Trigger-rendered Three.js room used by the live Foundry scene overlay. */
import * as THREE from "../vendor/three.module.min.js";

const LASER = new THREE.Color(0x5eead4);
const CONTACT = new THREE.Color(0xfbbf24);
const VOXEL_GAP = 0.08;
const VERTICES_PER_CUBE = 24;
const MAX_RENDER_EDGE = 1536;
const FLASH_MS = 650;
const EDGE_PAIRS = [
  [0, 1], [0, 2], [0, 4], [7, 3], [7, 5], [7, 6],
  [1, 3], [1, 5], [2, 3], [2, 6], [4, 5], [4, 6],
];

function validAxis(axis) {
  const value = Math.floor(Number(axis));
  if (!Number.isFinite(value) || value < 1 || value > 100) throw new RangeError("Room axis must be between 1 and 100");
  return value;
}

function cubePoints(x, y, z, axis, gap) {
  const half = axis / 2;
  const low = gap;
  const high = 1 - gap;
  return [
    [x + low - half, y + low - half, z + low - half],
    [x + high - half, y + low - half, z + low - half],
    [x + low - half, y + high - half, z + low - half],
    [x + high - half, y + high - half, z + low - half],
    [x + low - half, y + low - half, z + high - half],
    [x + high - half, y + low - half, z + high - half],
    [x + low - half, y + high - half, z + high - half],
    [x + high - half, y + high - half, z + high - half],
  ];
}

/** Build one GPU-ready line buffer containing every edge of every cube. */
export function buildRoomLineData(axis = 10, gap = VOXEL_GAP) {
  const size = validAxis(axis);
  const cubeCount = size ** 3;
  const edgeCount = cubeCount * EDGE_PAIRS.length;
  const positions = new Float32Array(edgeCount * 2 * 3);
  const colors = new Float32Array(positions.length);
  let offset = 0;
  for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const points = cubePoints(x, y, z, size, gap);
      for (const [from, to] of EDGE_PAIRS) {
        for (const point of [points[from], points[to]]) {
          positions.set(point, offset);
          const depth = 0.28 + 0.5 * ((point[0] + point[1] + point[2] + size * 1.5) / (size * 3));
          colors.set([LASER.r * depth, LASER.g * depth, LASER.b * depth], offset);
          offset += 3;
        }
      }
    }
  }
  return { positions, colors, cubeCount, edgeCount, verticesPerCube: VERTICES_PER_CUBE };
}

function rendererSize(width, height) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function cellPixels(dimensions, cellFeet) {
  const distance = Math.max(1, Number(dimensions?.distance) || cellFeet);
  return Math.max(1, Number(dimensions?.size) || 100) * cellFeet / distance;
}

/** Resolve a scene ping to the cube that received the contact. */
export function contactCell(ping, dimensions, axis = 10, cellFeet = 10) {
  if (!ping?.latticeContact || !dimensions) return null;
  const destination = ping.latticeContact.to;
  if (destination && [destination.x, destination.y, destination.z].every(Number.isFinite)) {
    const { x, y, z } = destination;
    if (x >= 0 && y >= 0 && z >= 0 && x < axis && y < axis && z < axis) {
      return { x, y, z, index: (y * axis + z) * axis + x };
    }
  }
  const step = cellPixels(dimensions, cellFeet);
  const x = Math.floor((Number(ping.x) - (Number(dimensions.sceneX) || 0)) / step);
  const z = Math.floor((Number(ping.y) - (Number(dimensions.sceneY) || 0)) / step);
  const y = Math.floor(Math.max(0, Number(ping.elevation) || 0) / cellFeet);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || z < 0 || x >= axis || y >= axis || z >= axis) return null;
  return { x, y, z, index: (y * axis + z) * axis + x };
}

function makeContext(canvas) {
  const options = { alpha: true, antialias: false, depth: true, powerPreference: "low-power", preserveDrawingBuffer: true };
  const context = canvas.getContext?.("webgl2", options);
  return context && typeof context.getParameter === "function" ? { context, options } : null;
}

/** A static WebGL scene. It renders only after data or contact events change. */
export class ThreeRoomRenderer {
  constructor({ canvas, context, contextOptions, width, height, axis = 10 }) {
    this.axis = validAxis(axis);
    this.canvas = canvas;
    this.onRender = null;
    this.flashTimer = null;
    this.flashCubes = new Set();
    const size = rendererSize(width, height);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: false,
      depth: true,
      powerPreference: contextOptions.powerPreference,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size.width, size.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, size.width / size.height, 0.1, 100);
    this.camera.position.set(this.axis * 1.45, this.axis * 1.2, this.axis * 1.65);
    this.camera.lookAt(0, 0, 0);
    const data = buildRoomLineData(this.axis);
    this.baseColors = data.colors.slice();
    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    this.lineGeometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    this.lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthTest: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.scene.add(this.lines);
    const shellBox = new THREE.BoxGeometry(this.axis, this.axis, this.axis);
    this.shellGeometry = new THREE.EdgesGeometry(shellBox);
    shellBox.dispose();
    this.shellMaterial = new THREE.LineBasicMaterial({
      color: 0x99f6e4,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
    });
    this.shell = new THREE.LineSegments(this.shellGeometry, this.shellMaterial);
    this.scene.add(this.shell);
    this.markerGeometry = new THREE.BufferGeometry();
    this.markerMaterial = new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    this.markers = new THREE.Points(this.markerGeometry, this.markerMaterial);
    this.scene.add(this.markers);
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.onRender?.();
  }

  setMarkers(markers = []) {
    const positions = new Float32Array(markers.length * 3);
    const colors = new Float32Array(markers.length * 3);
    const half = this.axis / 2;
    markers.forEach((marker, index) => {
      positions.set([Number(marker.x) - half, Number(marker.y) - half, Number(marker.z) - half], index * 3);
      const color = new THREE.Color(marker.color ?? 0x5eead4);
      colors.set([color.r, color.g, color.b], index * 3);
    });
    this.markerGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.markerGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.markerGeometry.computeBoundingSphere();
    this.render();
  }

  #restoreFlashes() {
    if (!this.flashCubes.size) return;
    const colors = this.lineGeometry.getAttribute("color");
    for (const cube of this.flashCubes) {
      const start = cube * VERTICES_PER_CUBE * 3;
      colors.array.set(this.baseColors.subarray(start, start + VERTICES_PER_CUBE * 3), start);
    }
    this.flashCubes.clear();
    colors.needsUpdate = true;
  }

  flashContacts(pings, dimensions, cellFeet = 10) {
    const contacts = pings.map((ping) => contactCell(ping, dimensions, this.axis, cellFeet)).filter(Boolean);
    if (!contacts.length) return false;
    clearTimeout(this.flashTimer);
    this.#restoreFlashes();
    const colors = this.lineGeometry.getAttribute("color");
    for (const contact of contacts) {
      this.flashCubes.add(contact.index);
      const start = contact.index * VERTICES_PER_CUBE * 3;
      for (let offset = start; offset < start + VERTICES_PER_CUBE * 3; offset += 3) {
        colors.array.set([CONTACT.r, CONTACT.g, CONTACT.b], offset);
      }
    }
    colors.needsUpdate = true;
    this.render();
    this.flashTimer = setTimeout(() => {
      this.#restoreFlashes();
      this.render();
    }, FLASH_MS);
    return true;
  }

  dispose() {
    clearTimeout(this.flashTimer);
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    this.shellGeometry.dispose();
    this.shellMaterial.dispose();
    this.markerGeometry.dispose();
    this.markerMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

/** Return null when WebGL2 is unavailable so the PIXI fallback can take over. */
export function createThreeRoomRenderer(options) {
  const canvas = document.createElement("canvas");
  const webgl = makeContext(canvas);
  if (!webgl) return null;
  return new ThreeRoomRenderer({
    ...options,
    canvas,
    context: webgl.context,
    contextOptions: webgl.options,
  });
}
