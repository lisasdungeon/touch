/** Quantum launcher and fixed 4D CSS wireframe room integration. */
import "./foundry-mock.mjs";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    results.push(["PASS", name, null]);
  } catch (error) {
    console.log(`  FAIL  ${name}\n        ${error.message}`);
    results.push(["FAIL", name, error]);
  }
}

async function waitForGrid(viewer) {
  for (let index = 0; index < 100 && !viewer.hypergrid; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(viewer.hypergrid, "lazy CSS lattice mounted");
  await viewer.hypergrid.ready;
  return viewer.hypergrid;
}

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.canvasInit ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await setupCanvasLayers();
const T = window.touch;
const moduleRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "touch");
const hyperCss = fs.readFileSync(path.join(moduleRoot, "styles", "hypergrid.css"), "utf8");

console.log("== Fixed CSS room registration ==");
await check("manifest registers the fixed cube stylesheet", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, "module.json"), "utf8"));
  assert.ok(manifest.styles.includes("styles/hypergrid.css"));
  assert.ok(manifest.flags.hotReload.includes("styles/hypergrid.css"));
});

await check("CSS defines wireframe cubes and corner waypoints without WebGL or orbit controls", async () => {
  assert.match(hyperCss, /\.touch-hyper-cube/);
  assert.match(hyperCss, /border: 1px solid/);
  assert.match(hyperCss, /\.touch-hyper-waypoint/);
  assert.match(hyperCss, /touch-hyper-memory/);
  assert.doesNotMatch(hyperCss, /canvas|webgl|rotate.*animation/i);
});

await check("the zero-size 3D root does not paint-clip its transformed room", async () => {
  const rootRule = hyperCss.match(/\.touch-hypergrid-space\s*\{[^}]+\}/s)?.[0] ?? "";
  assert.doesNotMatch(rootRule, /contain:[^;]*paint/, "paint containment clips the 3D children");
});

console.log("== Scene and viewer surfaces ==");
await check("the fixed wireframe lattice is a live Foundry canvas layer", async () => {
  assert.ok(canvas.touchHypergrid, "registered scene layer");
  assert.strictEqual(canvas.touchHypergrid.waypointCount, 21 ** 3, "every physical corner has a waypoint");
  assert.strictEqual(canvas.touchHypergrid.children.length, 2, "laser lattice and memory graphics");
});

await check("Hub launcher opens the viewer while the viewer itself has no orbit controls", async () => {
  await T.openHub();
  assert.strictEqual(T.hub.element.querySelectorAll(".touch-quantum-face").length, 6, "Hub launcher keeps six faces");
  T.hub.element.querySelector('[data-action="openQuantum"]').click();
  for (let index = 0; index < 30 && !T.viewer?.rendered; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(T.viewer?.rendered, "viewer opened");
  assert.ok(T.viewer.element.querySelector("[data-hypergrid]"));
  assert.strictEqual(T.viewer.element.querySelector("[data-action=orbitLeft]"), null);
  assert.strictEqual(T.viewer.element.querySelector(".touch-quantum-face"), null);
});

await check("viewer materializes the stacked spatial cubes and shared corners lazily", async () => {
  const grid = await waitForGrid(T.viewer);
  assert.strictEqual(grid.cubes.size, 20 ** 3, "one CSS cube for every five-foot spatial cell");
  assert.strictEqual(grid.waypoints.size, 21 ** 3, "shared corner nodes avoid duplicated memory");
  assert.strictEqual(T.viewer.element.querySelectorAll(".touch-hyper-cube").length, 20 ** 3);
  assert.strictEqual(T.viewer.element.querySelectorAll(".touch-hyper-waypoint").length, 21 ** 3);
});

await check("a ping lights memory-bearing waypoints at separate elevations", async () => {
  T.pinger.pulse({ broadcast: false, local: true });
  const grid = await waitForGrid(T.viewer);
  assert.ok(grid.active.size > 0, "incoming contacts activate corners");
  const heights = new Set([...grid.active].map((point) => point.dataset.y));
  assert.ok(heights.size > 1, "contacts map to vertically stacked cubes");
  assert.ok([...grid.active].some((point) => point.classList.contains("touch-hyper-memory")), "memory is held by a corner waypoint");
});

const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
