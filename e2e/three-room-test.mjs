/** GPU geometry checks for the bounded live-scene room. */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { buildRoomLineData, contactCell } from "../touch/scripts/threeRoom.js";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    results.push(["PASS", name]);
  } catch (error) {
    console.log(`  FAIL  ${name}\n        ${error.message}`);
    results.push(["FAIL", name, error]);
  }
}

const moduleRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "touch");
const source = fs.readFileSync(path.join(moduleRoot, "scripts", "threeRoom.js"), "utf8");

console.log("== Bounded Three.js room ==");
await check("one static line buffer contains 1,000 gapped cubes", () => {
  const data = buildRoomLineData(10);
  assert.strictEqual(data.cubeCount, 1000);
  assert.strictEqual(data.edgeCount, 12000);
  assert.strictEqual(data.verticesPerCube, 24);
  assert.strictEqual(data.positions.length, 12000 * 2 * 3);
  assert.strictEqual(data.colors.length, data.positions.length);
  assert.ok(Math.min(...data.positions) > -5, "cube gaps stay inside the room shell");
  assert.ok(Math.max(...data.positions) < 5, "cube gaps stay inside the room shell");
});

await check("the room uses a perspective camera, outer shell, and no animation loop", () => {
  assert.match(source, /new THREE\.WebGLRenderer/);
  assert.match(source, /new THREE\.PerspectiveCamera/);
  assert.match(source, /new THREE\.LineSegments/);
  assert.match(source, /new THREE\.EdgesGeometry/);
  assert.doesNotMatch(source, /requestAnimationFrame|setAnimationLoop/);
});

await check("only a lattice contact resolves a cube to flash", () => {
  const dimensions = { sceneX: 0, sceneY: 0, size: 100, distance: 5 };
  assert.strictEqual(contactCell({ x: 650, y: 550, elevation: 0 }, dimensions), null);
  const ping = {
    x: 650, y: 550, elevation: 0,
    latticeContact: { to: { x: 3, y: 0, z: 2 } },
  };
  assert.deepStrictEqual(contactCell(ping, dimensions), { x: 3, y: 0, z: 2, index: 23 });
});

await check("Three.js and its license are bundled locally", () => {
  assert.ok(fs.statSync(path.join(moduleRoot, "vendor", "three.module.min.js")).size > 300000);
  assert.ok(fs.statSync(path.join(moduleRoot, "vendor", "three.core.js")).size > 300000);
  assert.match(fs.readFileSync(path.join(moduleRoot, "vendor", "THREE-LICENSE.txt"), "utf8"), /MIT License/);
  assert.doesNotMatch(source, /https?:\/\//);
});

const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
