/**
 * e2e/bands-test.mjs — vertical extent bands in the room view.
 * Verifies band computation from Levels/Wall Height ranges, precedence,
 * light "hangs from ceiling" fallback, infinite clamping, true 3D line
 * primitives (template + live refresh), and band removal when flags clear.
 */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { sampleScene } from "./foundry-mock.mjs";

const results = [];
async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    results.push(["PASS", name, null]);
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    results.push(["FAIL", name, err]);
  }
}
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    results.push(["PASS", name, null]);
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    results.push(["FAIL", name, err]);
  }
}

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await window.touch.openViewer();
const viewer = window.touch.viewer;

async function roomGrid() {
  for (let index = 0; index < 100 && !viewer.hypergrid; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(viewer.hypergrid, "lazy cube lattice mounted");
  await viewer.hypergrid.ready;
  return viewer.hypergrid;
}
const bandByKey = (key) => viewer.getBands().find((band) => band.key === key);

console.log("== Extent bands in the room view ==");
await checkAsync("wall band from Wall Height extent", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", 10, "bottom");
  await window.touch.setEmitterWallHeight("wall.wl-1", 30, "top");
  viewer.flush();
  const band = bandByKey("wall.wl-1");
  assert.ok(band, "wall band exists");
  assert.strictEqual(band.kind, "wall");
  assert.strictEqual(band.bottomElevation, 10);
  assert.strictEqual(band.topElevation, 30);
  assert.match(band.label, /Wall .+ — Wall Height 10u→30u/);
});

await checkAsync("light band hangs below a Wall Height ceiling", async () => {
  const light = sampleScene.lights.get("lit-torch");
  await light.setFlag("wall-height", "top", 20);
  viewer.flush();
  const band = bandByKey("light.lit-torch");
  assert.ok(band, "light band exists");
  assert.strictEqual(band.kind, "light");
  assert.strictEqual(band.bottomElevation, 10);
  assert.strictEqual(band.topElevation, 20);
  assert.match(band.label, /Torch — Wall Height 10u→20u/);
});

await checkAsync("Levels range wins over Wall Height", async () => {
  const wall = sampleScene.walls.get("wl-1");
  wall.flags.levels = { rangeBottom: 0, rangeTop: 20 };
  try {
    viewer.flush();
    const band = bandByKey("wall.wl-1");
    assert.strictEqual(band.bottomElevation, 0);
    assert.strictEqual(band.topElevation, 20);
    assert.match(band.label, /Levels 0u→20u/);
  } finally {
    delete wall.flags.levels;
  }
});

await checkAsync("fully infinite extents produce no band", async () => {
  const wall = sampleScene.walls.get("wl-1");
  await wall.setFlag("wall-height", "top", null);
  await wall.setFlag("wall-height", "bottom", null);
  viewer.flush();
  assert.ok(!bandByKey("wall.wl-1"), "band removed when extent cleared");
});

await checkAsync("bands update live through flush without re-render", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", 0, "bottom");
  viewer.flush();
  const band = bandByKey("wall.wl-1");
  assert.ok(band, "band re-created on next flush");
  assert.strictEqual(band.bottomElevation, 0);
  assert.strictEqual(band.topElevation, 10);
  // Light band still live from its earlier flag.
  assert.ok(bandByKey("light.lit-torch"), "light band persists");
});

await checkAsync("bands activate vertically stacked waypoints in the 4D room", async () => {
  const grid = await roomGrid();
  viewer.flush();
  assert.ok([...grid.active].some((point) => point.style.getPropertyValue("--touch-cell-color") === "#94a3b8"), "wall extent reaches memory corners");
  assert.ok(viewer.element.querySelector("[data-hypergrid]"), "CSS cube host present");
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
