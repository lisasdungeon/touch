/** Track trails in the fixed room: memory corners retain position history. */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { sampleScene } from "./foundry-mock.mjs";

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

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.canvasInit ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await setupCanvasLayers();
const T = window.touch;
const pathways = await import("../touch/scripts/pathways.js");

const zone = await pathways.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "Zone", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
const hero = sampleScene.tokens.get("tok-hero");
await orc.update({ x: 500, y: 100 });
await hero.update({ x: 800, y: 100 });
await T.clearMemory();
await T.openViewer();
const viewer = T.viewer;

async function grid() {
  for (let index = 0; index < 100 && !viewer.hypergrid; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(viewer.hypergrid, "fixed CSS room mounted");
  await viewer.hypergrid.ready;
  return viewer.hypergrid;
}

const corners = (trackId = null) => [...viewer.hypergrid.active]
  .filter((point) => point.dataset.track && (!trackId || point.dataset.track === trackId));

console.log("== Trail waypoints ==");
let orcTrailId = null;
await check("each fix becomes a memory-bearing corner waypoint", async () => {
  await orc.update({ x: 500, y: 300 });
  await orc.update({ x: 900, y: 300 });
  await orc.update({ x: 1300, y: 300 });
  orcTrailId = T.lastTrackEvent.id;
  viewer.flush();
  await grid();
  assert.strictEqual(corners(orcTrailId).length, 3, "one corner per distinct ten-foot fix");
});

await check("the newest fix is tagged as the trail head", async () => {
  const heads = corners(orcTrailId).filter((point) => point.dataset.trackHead === "1");
  assert.strictEqual(heads.length, 1, "one current memory head");
});

await check("trail corners brighten with recency", async () => {
  const energy = corners(orcTrailId).map((point) => Number(point.style.getPropertyValue("--touch-cell-energy")));
  assert.ok(Math.max(...energy) > Math.min(...energy), "newer corner has greater energy");
});

console.log("== Multi-track ==");
await check("separate tracks retain separate stable hues", async () => {
  await hero.update({ x: 700, y: 300 });
  viewer.flush();
  await grid();
  const colors = new Map();
  for (const point of corners()) {
    const color = point.style.getPropertyValue("--touch-cell-color");
    if (colors.has(point.dataset.track)) assert.strictEqual(colors.get(point.dataset.track), color, "color stable per track");
    else colors.set(point.dataset.track, color);
  }
  assert.strictEqual(colors.size, 2, "two tracks shown");
  assert.strictEqual(new Set(colors.values()).size, 2, "tracks use different colors");
});

await check("track corners expose a label on hover", async () => {
  assert.ok(corners().every((point) => point.title.length > 0));
});

console.log("== Integration ==");
await check("floor filtering hides tracks outside the selected cube stack", async () => {
  viewer.floorFilter = 5;
  viewer.flush();
  assert.strictEqual(corners().length, 0, "F5 has no track corners");
  viewer.floorFilter = 0;
  viewer.flush();
  assert.strictEqual(corners().length, 4, "F0 restores every track corner");
});

await check("the room materializes at most 24 recent corners per track", async () => {
  for (let x = 100; x <= 1900 && corners(orcTrailId).length < 24; x += 70) {
    await orc.update({ x, y: 300 });
    orcTrailId = T.lastTrackEvent.id;
  }
  viewer.flush();
  await grid();
  assert.ok(corners(orcTrailId).length <= 24, "per-track materialization cap respected");
});

await check("Forget All removes track waypoints", async () => {
  await T.clearMemory();
  viewer.flush();
  assert.strictEqual(corners().length, 0);
});

await pathways.removePathway(sampleScene, zone.id);
await T.clearMemory();
await T.viewer?.close();

const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
