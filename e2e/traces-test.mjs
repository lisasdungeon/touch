/**
 * e2e/traces-test.mjs — surface traces (pathway × token crossing) and
 * junction waypoints (pathway × pathway crossings).
 */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { sampleScene, game } from "./foundry-mock.mjs";

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
await window.touch.openViewer();
const T = window.touch;
const pwMod = await import("../touch/scripts/pathways.js");

console.log("== Surface traces ==");
await checkAsync("clipSegmentToRect clips and rejects correctly", () => {
  // Horizontal segment through a 100x100 rect centered at origin
  const hit = pwMod.clipSegmentToRect([-200, 0, 200, 0], 50, 50);
  assert.deepStrictEqual(hit, [-50, 0, 50, 0]);
  // Miss
  assert.strictEqual(pwMod.clipSegmentToRect([-200, 60, 200, 60], 50, 50), null);
  // Corner graze still clips (tiny chord)
  const graze = pwMod.clipSegmentToRect([-200, 49, 200, 49], 50, 50);
  assert.ok(graze, "grazing segment clipped");
});

await checkAsync("moving token across pathway emits trace pings", async () => {
  const pw = await pwMod.createPathway(sampleScene, {
    a: { x: 1000, y: 1000 }, b: { x: 1000, y: 1400 }, name: "Tripwire", config: { intensity: 50 },
  });
  const captured = [];
  const orig = T.pinger.receive.bind(T.pinger);
  T.pinger.receive = (payload) => captured.push(payload);
  try {
    // tok-hero is 1x1 squares (100u); move its center onto the line
    const doc = sampleScene.tokens.get("tok-hero");
    await doc.update({ x: 1000, y: 1200 });
  } finally {
    T.pinger.receive = orig;
  }
  // Replay captured payloads (a remote client would have received them).
  for (const payload of captured) orig(payload);
  const pings = captured.flatMap((p) => p.pings);
  const traces = pings.filter((p) => p.trace);
  assert.ok(traces.length >= 1, "trace pings emitted");
  const t0 = traces[0];
  assert.strictEqual(t0.traceTokenId, "tok-hero");
  assert.ok(t0.chord > 0 && t0.chord <= 100, `chord ~ footprint width, got ${t0.chord}`);
  // entry/exit y within token footprint (1200±50)
  assert.ok(Math.abs(t0.y - 1200) <= 55, `entry y near footprint, got ${t0.y}`);
  assert.ok(Math.abs(t0.y2 - 1200) <= 55, `exit y near footprint, got ${t0.y2}`);
  // trace far endpoint projected onto --v2 var in camera frames
  T.viewer.flush();
  const frame = [...T.viewer.frames.get("front").values()].find((f) => f.trace);
  assert.ok(frame, "trace frame exists");
  assert.ok(frame.vars["--v2"] !== undefined, "--v2 projected");
  await pwMod.removePathway(sampleScene, pw.id);
});

await checkAsync("token not touching the line emits nothing", async () => {
  const pw = await pwMod.createPathway(sampleScene, {
    a: { x: 1500, y: 1500 }, b: { x: 1500, y: 1900 },
  });
  const pings = [];
  const orig = T.pinger.receive.bind(T.pinger);
  T.pinger.receive = (payload) => pings.push(...payload.pings);
  try {
    const doc = sampleScene.tokens.get("tok-orc"); // at 1200,300 — far away
    await doc.update({ x: 1200, y: 320 });
  } finally {
    T.pinger.receive = orig;
  }
  assert.strictEqual(pings.filter((p) => p.trace).length, 0);
  await pwMod.removePathway(sampleScene, pw.id);
});

console.log("== Junction waypoints ==");
await checkAsync("crossing two pathways creates exactly one junction", async () => {
  const A = await pwMod.createPathway(sampleScene, { a: { x: 0, y: 500 }, b: { x: 1000, y: 500 } });
  const B = await pwMod.createPathway(sampleScene, { a: { x: 500, y: 0 }, b: { x: 500, y: 1000 } });
  const res = await pwMod.syncJunctionWaypoints(sampleScene);
  assert.strictEqual(res.added, 1, "one junction added");
  const wps = (await import("../touch/scripts/waypoints.js")).getWaypoints(sampleScene);
  const j = wps.find((w) => w.junction);
  assert.ok(j, "junction waypoint stored");
  assert.strictEqual(j.x, 500);
  assert.strictEqual(j.y, 500);
  assert.deepStrictEqual(j.junction, { a: A.id, b: B.id });
  // Idempotence: second sync adds nothing
  const res2 = await pwMod.syncJunctionWaypoints(sampleScene);
  assert.strictEqual(res2.added, 0);
  assert.strictEqual(res2.kept, 1);
  // Crossing appears in the geometry helper
  const crossings = pwMod.findPathwayCrossings(sampleScene);
  assert.strictEqual(crossings.length, 1);
  assert.strictEqual(Math.round(crossings[0].x), 500);
  // Junction also shows in the viewer pipeline (as waypoint emitter)
  const list = T.emitters();
  assert.ok(list.some((e) => e.id === j.id), "junction is an emitter");
  await pwMod.removePathway(sampleScene, A.id);
  await pwMod.removePathway(sampleScene, B.id);
  const res3 = await pwMod.syncJunctionWaypoints(sampleScene);
  assert.strictEqual(res3.removed, 1, "stale junction removed");
  const wpsAfter = (await import("../touch/scripts/waypoints.js")).getWaypoints(sampleScene);
  assert.ok(!wpsAfter.some((w) => w.junction), "junction gone");
});

await checkAsync("moving a pathway relocates its junction", async () => {
  const A = await pwMod.createPathway(sampleScene, { a: { x: 0, y: 800 }, b: { x: 800, y: 800 } });
  const B = await pwMod.createPathway(sampleScene, { a: { x: 400, y: 600 }, b: { x: 400, y: 1000 } });
  await pwMod.syncJunctionWaypoints(sampleScene);
  let j = (await import("../touch/scripts/waypoints.js")).getWaypoints(sampleScene).find((w) => w.junction);
  assert.strictEqual(j.x, 400); assert.strictEqual(j.y, 800);
  // Drag pathway A's endpoint 0 to (0, 950): crossing moves to (400, 950)
  await pwMod.updatePathway(sampleScene, A.id, { c: [0, 950, 800, 950] });
  await pwMod.syncJunctionWaypoints(sampleScene);
  j = (await import("../touch/scripts/waypoints.js")).getWaypoints(sampleScene).find((w) => w.junction);
  assert.strictEqual(j.y, 950, "junction followed the moved line");
  assert.strictEqual(j.x, 400);
  await pwMod.removePathway(sampleScene, A.id);
  await pwMod.removePathway(sampleScene, B.id);
  await pwMod.syncJunctionWaypoints(sampleScene);
});

await checkAsync("parallel pathways create no junctions", async () => {
  const A = await pwMod.createPathway(sampleScene, { a: { x: 0, y: 100 }, b: { x: 800, y: 100 } });
  const B = await pwMod.createPathway(sampleScene, { a: { x: 0, y: 300 }, b: { x: 800, y: 300 } });
  const res = await pwMod.syncJunctionWaypoints(sampleScene);
  assert.strictEqual(res.added, 0);
  await pwMod.removePathway(sampleScene, A.id);
  await pwMod.removePathway(sampleScene, B.id);
  await pwMod.syncJunctionWaypoints(sampleScene);
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
