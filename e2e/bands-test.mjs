/**
 * e2e/bands-test.mjs — vertical extent bands in the room view.
 * Verifies band computation from Levels/Wall Height ranges, precedence,
 * light "hangs from ceiling" fallback, infinite clamping, DOM rendering
 * (template + live reconcile), and band removal when flags clear.
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

// #bands is private; exercise it through the reconcile output in flush().
const domBands = () => [...viewer.element.querySelectorAll(".touch-extent-band")];
const bandByKey = (key) => domBands().find((el) => el.dataset.key === key);

console.log("== Extent bands in the room view ==");
await checkAsync("wall band from Wall Height extent", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", 10, "bottom");
  await window.touch.setEmitterWallHeight("wall.wl-1", 30, "top");
  viewer.flush();
  const el = bandByKey("wall.wl-1");
  assert.ok(el, "band element exists");
  assert.strictEqual(el.dataset.kind, "wall");
  // bottom=10u -> --b = 14% (one storey span); height = 2 storeys = 28%
  assert.strictEqual(el.style.getPropertyValue("--b"), "14.00%");
  assert.strictEqual(el.style.getPropertyValue("--bh"), "28.00%");
  assert.match(el.title, /Wall .+ — Wall Height 10u→30u/);
});

await checkAsync("light band hangs below a Wall Height ceiling", async () => {
  const light = sampleScene.lights.get("lit-torch");
  await light.setFlag("wall-height", "top", 20);
  viewer.flush();
  const el = bandByKey("light.lit-torch");
  assert.ok(el, "light band exists");
  assert.strictEqual(el.dataset.kind, "light");
  // top=20 with no bottom -> hangs 20-10=10 -> bottom storey 1 (14%), 1 storey tall
  assert.strictEqual(el.style.getPropertyValue("--b"), "14.00%");
  assert.strictEqual(el.style.getPropertyValue("--bh"), "14.00%");
  assert.match(el.title, /Torch — Wall Height 10u→20u/);
});

await checkAsync("Levels range wins over Wall Height", async () => {
  const wall = sampleScene.walls.get("wl-1");
  wall.flags.levels = { rangeBottom: 0, rangeTop: 20 };
  try {
    viewer.flush();
    const el = bandByKey("wall.wl-1");
    assert.strictEqual(el.style.getPropertyValue("--b"), "0.00%");
    assert.strictEqual(el.style.getPropertyValue("--bh"), "28.00%");
    assert.match(el.title, /Levels 0u→20u/);
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
  const el = bandByKey("wall.wl-1");
  assert.ok(el, "band re-created on next flush");
  assert.strictEqual(el.style.getPropertyValue("--b"), "0.00%"); // ground floor
  assert.strictEqual(el.style.getPropertyValue("--bh"), "14.00%"); // clamped 1 storey
  // light band still live from its earlier flag
  assert.ok(bandByKey("light.lit-torch"), "light band persists");
});

check("template render includes band container", () => {
  assert.ok(viewer.element.querySelector(".touch-extent-bands"), "container present");
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
