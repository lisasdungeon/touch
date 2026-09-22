/**
 * e2e/waypoints-test.mjs — covers deployable waypoints, per-waypoint height,
 * emission mode (sound/light/both), and facing cones (angle/fov).
 */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { sampleScene, document, game } from "./foundry-mock.mjs";

const results = [];
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

console.log("== Loading module ==");
await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await window.touch.openViewer(); // frames need a rendered viewer to ingest into

const wpMod = await import("../touch/scripts/waypoints.js");

// ------------------------------------------------------------- waypoint CRUD
console.log("== Waypoint deploy & storage ==");
await checkAsync("deploy waypoint stores config in scene flags", async () => {
  const wp = await wpMod.deployWaypoint(sampleScene, {
    x: 1000, y: 700, elevation: 5,
    config: { intensity: 75, mode: "sound", angle: 90, fov: 60 },
  });
  assert.ok(wp.id.startsWith("wp."), "waypoint id prefix");
  const stored = wpMod.getWaypoints(sampleScene);
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].config.mode, "sound");
  assert.strictEqual(stored[0].config.fov, 60);
  assert.strictEqual(stored[0].elevation, 5);
});
check("waypoints appear in collectEmitters", () => {
  const emitters = window.touch.emitters();
  const wp = emitters.find((e) => e.kind === "waypoint");
  assert.ok(wp, "waypoint emitter present");
  assert.strictEqual(wp.config.mode, "sound");
  assert.strictEqual(wp.elevation, 5);
});
await checkAsync("rename waypoint", async () => {
  const id = wpMod.getWaypoints(sampleScene)[0].id;
  await window.touch.renameWaypoint(id, "Sonar Beacon");
  assert.strictEqual(wpMod.getWaypoints(sampleScene)[0].name, "Sonar Beacon");
});
await checkAsync("set waypoint elevation through API", async () => {
  const id = wpMod.getWaypoints(sampleScene)[0].id;
  await window.touch.setWaypointElevation(id, 12);
  assert.strictEqual(wpMod.getWaypoints(sampleScene)[0].elevation, 12);
});
await checkAsync("config normalization clamps out-of-range values", async () => {
  const id = wpMod.getWaypoints(sampleScene)[0].id;
  await wpMod.updateWaypoint(sampleScene, id, { config: { fov: 999, angle: -50, intensity: 500 } });
  const cfg = wpMod.getWaypoints(sampleScene)[0].config;
  assert.strictEqual(cfg.fov, 360, "fov clamped to max 360");
  assert.strictEqual(cfg.angle, 0, "angle clamped to min 0");
  assert.strictEqual(cfg.intensity, 100, "intensity clamped to max 100");
  assert.strictEqual(cfg.mode, "sound", "mode preserved through unrelated patch");
});

// --------------------------------------------------------- mode & cone flow
console.log("== Emission mode & facing through pipeline ==");
await checkAsync("ping carries mode/angle/fov through frames", async () => {
  const id = wpMod.getWaypoints(sampleScene)[0].id;
  await window.touch.setEmitterFacing(id, { angle: 180, fov: 120 });
  window.touch.pinger.pulse({ broadcast: true, local: true });
  const frames = window.touch.viewer.frames.get("front");
  let wpFrame = null;
  for (const f of frames.values()) if (f.kind === "waypoint") wpFrame = f;
  assert.ok(wpFrame, "waypoint frame exists");
  assert.strictEqual(wpFrame.mode, "sound", "mode flows through pipeline");
  assert.ok(wpFrame.facing, "facing projection present");
  assert.strictEqual(wpFrame.facing.fov, 120);
});
check("camera facing projection rotates into camera space", () => {
  const frames = window.touch.viewer.frames.get("top");
  let wpFrame = null;
  for (const f of frames.values()) if (f.kind === "waypoint") wpFrame = f;
  assert.ok(wpFrame, "waypoint on top camera");
  assert.strictEqual(Math.round(wpFrame.facing.relDeg), 180, "facing 180 rel. to top camera");
});
await checkAsync("setEmitterMode switches a document emitter to light-only", async () => {
  await window.touch.setEmitterMode("token.tok-orc", "light");
  assert.strictEqual(sampleScene.tokens.get("tok-orc").getFlag("touch", "sonar").mode, "light");
});
await checkAsync("setEmitterFacing on a document emitter", async () => {
  await window.touch.setEmitterFacing("token.tok-orc", { angle: 45, fov: 120 });
  const cfg = sampleScene.tokens.get("tok-orc").getFlag("touch", "sonar");
  assert.strictEqual(cfg.angle, 45);
  assert.strictEqual(cfg.fov, 120);
});

// ------------------------------------------------------------------ deletion
console.log("== Waypoint deletion ==");
await checkAsync("removeWaypoint deletes and updates emitters", async () => {
  const id = wpMod.getWaypoints(sampleScene)[0].id;
  await window.touch.removeWaypoint(id);
  assert.strictEqual(wpMod.getWaypoints(sampleScene).length, 0);
  assert.ok(!window.touch.emitters().some((e) => e.kind === "waypoint"));
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
