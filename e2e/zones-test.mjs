/** Internal A-Z/number addressing without a scene-label overlay. */
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
const { columnLabel, zoneAddress, zoneId } = await import("../touch/scripts/zoneGridLayer.js");

console.log("== Zone addressing ==");
await check("columns continue from A-Z into AA", async () => {
  assert.strictEqual(columnLabel(0), "A");
  assert.strictEqual(columnLabel(25), "Z");
  assert.strictEqual(columnLabel(26), "AA");
  assert.strictEqual(columnLabel(51), "AZ");
});
await check("cell ids use row then column", async () => {
  assert.strictEqual(zoneId(0, 0), "1A");
  assert.strictEqual(zoneId(1, 25), "2Z");
});
await check("canvas positions resolve to a unique level and readable ten-foot cube", async () => {
  assert.deepStrictEqual(zoneAddress(500, 500, 0), {
    zone: "3C", row: 3, column: "C", level: 1, levelElevation: 0,
    cubeTier: 1, cube: "3C-L01-T01",
  });
  assert.deepStrictEqual(zoneAddress(700, 800, 10), {
    zone: "5D", row: 5, column: "D", level: 2, levelElevation: 10,
    cubeTier: 2, cube: "5D-L02-T02",
  });
  assert.deepStrictEqual(zoneAddress(150, 250, 100, {
    dimensions: { sceneX: 100, sceneY: 200, sceneWidth: 1000, sceneHeight: 1000, size: 50 },
  }), {
    zone: "1A", row: 1, column: "A", level: 10, levelElevation: 90,
    cubeTier: 10, cube: "1A-L10-T10",
  });
  assert.strictEqual(zoneAddress(-1, 100, 0), null, "off-scene pings have no room address");
});

console.log("== Clean live scene ==");
await setupCanvasLayers();
await check("A1/B1 labels remain data-only and never mount over the scene", async () => {
  assert.strictEqual(canvas.touchZones, undefined);
  assert.ok(!canvas.primary.group.children.some((child) => child.options?.name === "touchZones"));
});

const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
