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
assert.strictEqual(CONFIG.Canvas.layers.touchWaypoints?.group, "interface", "waypoint layer registered during init");
await setupCanvasLayers();
for (const fn of Hooks.events.ready ?? []) fn();
for (const fn of Hooks.events.canvasReady ?? []) fn();
await window.touch.openViewer(); // frames need a rendered viewer to ingest into

const wpMod = await import("../touch/scripts/waypoints.js");

await checkAsync("waypoint tool arms, consumes a map click, and draws the stored waypoint", async () => {
  const controls = {};
  for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
  const tool = controls.touch.tools["touch-waypoint"];
  assert.strictEqual(tool.button, false, "placement mode is not a one-shot button");
  assert.strictEqual(tool.toggle, true, "placement mode remains visibly armed");
  await tool.onChange({}, true);
  assert.strictEqual(canvas.touchWaypoints.armed, true, "waypoint layer armed");
  assert.strictEqual(canvas.stage.cursor, "crosshair", "scene cursor signals placement mode");
  assert.strictEqual(canvas.stage.listenerCount("pointerdown"), 1, "one scene placement listener bound");
  let stopped = false;
  await canvas.stage.emit("pointerdown", {
    button: 0,
    getLocalPosition: () => ({ x: 640, y: 420 }),
    stopPropagation: () => { stopped = true; },
  });
  const placed = wpMod.getWaypoints(sampleScene).find((waypoint) => waypoint.x === 640 && waypoint.y === 420);
  assert.ok(placed, "scene click persisted a waypoint at the canvas coordinate");
  assert.strictEqual(placed.config.mode, "both", "new waypoint exposes a configurable ping mode");
  assert.strictEqual(canvas.touchWaypoints.waypoints.children.length, 1, "placed waypoint has a live scene marker");
  assert.strictEqual(stopped, true, "placement click does not leak into other canvas tools");
  await tool.onChange({}, false);
  assert.strictEqual(canvas.touchWaypoints.armed, false, "toolbar deactivation disarms placement");
  await wpMod.removeWaypoint(sampleScene, placed.id);
  canvas.touchWaypoints.refreshWaypoints();
});

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
