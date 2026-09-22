/**
 * e2e/lattice-test.mjs — 3D sonar lattice: generation, elevation-gated
 * crossings, junction nodes, cap guard, clear behavior, and hub controls.
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

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.canvasInit ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await setupCanvasLayers();
await window.touch.openHub();
const T = window.touch;
const lat = await import("../touch/scripts/lattice.js");
const pwMod = await import("../touch/scripts/pathways.js");
const wpMod = await import("../touch/scripts/waypoints.js");

console.log("== Lattice generation ==");
await checkAsync("generate creates gridlines per storey, tagged", async () => {
  const res = await T.generateLattice({ cellW: 3, cellD: 2, storeys: 2, intensity: 30 });
  // 4 v-lines + 3 h-lines = 7 per storey × 2 storeys
  assert.strictEqual(res.added, 14);
  const lines = pwMod.getPathways(sampleScene).filter((p) => p.lattice);
  assert.strictEqual(lines.length, 14);
  const storeys = new Set(lines.map((p) => p.lattice.storey));
  assert.deepStrictEqual([...storeys].sort(), [0, 1]);
  // Storey 1 lines carry elevation = storeyHeight
  const s1 = lines.filter((p) => p.lattice.storey === 1);
  assert.ok(s1.every((p) => p.elevation === 10), "storey 1 elevation 10");
  assert.ok(s1.every((p) => p.config.intensity === 30));
});

await checkAsync("same-storey crossings become junction nodes", async () => {
  // 4 v × 3 h intersections per storey = 12 per storey × 2 = 24
  const jwps = wpMod.getWaypoints(sampleScene).filter((w) => w.junction);
  assert.strictEqual(jwps.length, 24);
  // Storey 1 junctions elevated to 10
  const s1 = jwps.filter((w) => w.elevation === 10);
  assert.strictEqual(s1.length, 12);
  // Names reference pathway names
  assert.match(jwps[0].name, /gridline/);
});

await checkAsync("regeneration never duplicates or keeps stale lines", async () => {
  await T.generateLattice({ cellW: 2, cellD: 2, storeys: 1, intensity: 25 });
  const lines = pwMod.getPathways(sampleScene).filter((p) => p.lattice);
  assert.strictEqual(lines.length, 6); // 3 v + 3 h, 1 storey
  const jwps = wpMod.getWaypoints(sampleScene).filter((w) => w.junction);
  assert.strictEqual(jwps.length, 9);
});

await checkAsync("hand-drawn pathways survive regeneration and clear", async () => {
  const hand = await pwMod.createPathway(sampleScene, {
    a: { x: 10, y: 10 }, b: { x: 200, y: 10 }, name: "Hand-drawn",
  });
  await T.generateLattice({ cellW: 2, cellD: 2, storeys: 1 });
  let list = pwMod.getPathways(sampleScene);
  assert.ok(list.some((p) => p.id === hand.id && !p.lattice), "hand-drawn kept");
  const res = await T.clearLattice();
  assert.strictEqual(res.removed, 6);
  list = pwMod.getPathways(sampleScene);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, hand.id);
  assert.strictEqual(wpMod.getWaypoints(sampleScene).filter((w) => w.junction).length, 0);
  await pwMod.removePathway(sampleScene, hand.id);
});

await checkAsync("3D gate: crossing elevation bands is required", async () => {
  // A hand-drawn elevated line crossing lattice v-lines on the ground floor
  // must NOT create junctions (storey band differs by a full storey).
  const A = await pwMod.createPathway(sampleScene, {
    a: { x: 0, y: 500 }, b: { x: 1000, y: 500 }, elevation: 0,
  });
  const B = await pwMod.createPathway(sampleScene, {
    a: { x: 500, y: 0 }, b: { x: 500, y: 1000 }, elevation: 10,
  });
  await pwMod.syncJunctionWaypoints(sampleScene);
  assert.strictEqual(wpMod.getWaypoints(sampleScene).filter((w) => w.junction).length, 0);
  // Same storey: junction appears
  await pwMod.updatePathway(sampleScene, B.id, { elevation: 0 });
  await pwMod.syncJunctionWaypoints(sampleScene);
  assert.strictEqual(wpMod.getWaypoints(sampleScene).filter((w) => w.junction).length, 1);
  await pwMod.removePathway(sampleScene, A.id);
  await pwMod.removePathway(sampleScene, B.id);
  await pwMod.syncJunctionWaypoints(sampleScene);
});

await checkAsync("cap guard refuses oversized lattices", async () => {
  // (24+1)+(24+1) = 50 lines per storey × 13 storeys = 650 > MAX_LATTICE_LINES (600).
  const res = await T.generateLattice({ cellW: 24, cellD: 24, storeys: 13 });
  assert.strictEqual(res.capped, true);
  assert.strictEqual(res.added, 0);
  // Lattice lines were not written
  assert.strictEqual(pwMod.getPathways(sampleScene).filter((p) => p.lattice).length, 0);
  assert.strictEqual(T.getLattice().enabled, false);
});

console.log("== Hub controls ==");
await checkAsync("hub renders lattice section and wires actions", async () => {
  await T.hub.render();
  const gen = T.hub.element.querySelector('[data-action="latticeGenerate"]');
  const clr = T.hub.element.querySelector('[data-action="latticeClear"]');
  assert.ok(gen && clr, "buttons present");
  // Input reflects the current lattice config (whatever prior tests left there)
  assert.strictEqual(Number(T.hub.element.querySelector('[name="latticeStoreys"]').value), Number(T.getLattice().storeys));
  // set small lattice through the UI inputs and click generate
  T.hub.element.querySelector('[name="latticeCellW"]').value = "2";
  T.hub.element.querySelector('[name="latticeCellD"]').value = "2";
  T.hub.element.querySelector('[name="latticeStoreys"]').value = "1";
  T.hub.element.querySelector('[name="latticeIntensity"]').value = "20";
  gen.click();
  await new Promise((r) => setTimeout(r, 80));
  const lines = pwMod.getPathways(sampleScene).filter((p) => p.lattice);
  assert.strictEqual(lines.length, 6); // 3 v + 3 h, 1 storey
  assert.ok(lines.every((p) => p.config.intensity === 20));
  clr.click();
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(pwMod.getPathways(sampleScene).filter((p) => p.lattice).length, 0);
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
