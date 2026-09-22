/** Touch surfaces attach through the real canvasReady lifecycle. */
import "./foundry-mock.mjs";
import assert from "node:assert";

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

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();

console.log("== Live canvas lifecycle ==");
await check("canvasReady creates and draws every Touch surface", async () => {
  assert.strictEqual(canvas.touchHypergrid, undefined);
  for (const fn of Hooks.events.canvasReady ?? []) await fn();
  for (const property of ["touchHypergrid", "touchZones", "touchPathways", "touchWaypoints", "touchRings"]) {
    assert.ok(canvas[property], `${property} missing`);
    const expectedParent = ["touchHypergrid", "touchZones"].includes(property) ? canvas.primary.group : canvas.interface;
    assert.strictEqual(canvas[property].parent, expectedParent, `${property} attached to the wrong Foundry group`);
    assert.ok(canvas[property].children.length > 0, `${property} was not drawn`);
    assert.strictEqual(canvas[property].visible, true, `${property} is hidden`);
    assert.strictEqual(canvas[property].renderable, true, `${property} is not renderable`);
    assert.ok(canvas[property].zIndex >= 900, `${property} is behind core canvas surfaces`);
  }
  assert.strictEqual(canvas.touchRings.active, true, "scene rings are active without opening the Viewer");
  assert.strictEqual(canvas.stage.listenerCount("pointerdown"), 1, "placement listener attached once");
});

await check("canvasTearDown removes every owned surface", async () => {
  for (const fn of Hooks.events.canvasTearDown ?? []) await fn();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const property of ["touchHypergrid", "touchZones", "touchPathways", "touchWaypoints", "touchRings"]) {
    assert.strictEqual(canvas[property], undefined, `${property} survived teardown`);
  }
  assert.strictEqual(canvas.stage.listenerCount("pointerdown"), 0);
});

await check("one failed surface cannot block waypoints, pathways, or rings", async () => {
  const { ZoneGridLayer } = await import("../touch/scripts/zoneGridLayer.js?release=0.1.13");
  const { ensureTouchCanvasLayers, teardownTouchCanvasLayers } = await import("../touch/scripts/canvasLayers.js?release=0.1.13");
  const original = ZoneGridLayer.prototype.draw;
  const logged = console.error;
  ZoneGridLayer.prototype.draw = async () => { throw new Error("simulated zone failure"); };
  console.error = () => {};
  try {
    await ensureTouchCanvasLayers();
    assert.strictEqual(canvas.touchZones, undefined, "failed layer should be discarded");
    for (const property of ["touchHypergrid", "touchPathways", "touchWaypoints", "touchRings"]) {
      assert.ok(canvas[property]?.parent, `${property} was blocked by the failed zone layer`);
    }
  } finally {
    console.error = logged;
    ZoneGridLayer.prototype.draw = original;
    await teardownTouchCanvasLayers();
  }
});

const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
