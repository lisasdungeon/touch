/** Live scene grid-zone labels: A-Z columns, numbered rows, and 1A cell ids. */
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
await check("canvas positions resolve to a unique level and five-foot cube", async () => {
  assert.deepStrictEqual(zoneAddress(500, 500, 0), {
    zone: "6F", row: 6, column: "F", level: 1, levelElevation: 0,
    cubeTier: 1, cube: "6F-L01-T01",
  });
  assert.deepStrictEqual(zoneAddress(700, 800, 10), {
    zone: "9H", row: 9, column: "H", level: 2, levelElevation: 10,
    cubeTier: 3, cube: "9H-L02-T03",
  });
  assert.deepStrictEqual(zoneAddress(150, 250, 100, {
    dimensions: { sceneX: 100, sceneY: 200, sceneWidth: 1000, sceneHeight: 1000, size: 50 },
  }), {
    zone: "2B", row: 2, column: "B", level: 10, levelElevation: 90,
    cubeTier: 20, cube: "2B-L10-T20",
  });
  assert.strictEqual(zoneAddress(-1, 100, 0), null, "off-scene pings have no room address");
});

console.log("== Live scene overlay ==");
await setupCanvasLayers();
await check("zone layer is drawn directly in Foundry's live interface group", async () => {
  assert.strictEqual(canvas.touchZones?.parent, canvas.interface);
  assert.ok(canvas.interface.children.includes(canvas.touchZones));
});
await check("ten elevation planes receive the full physical zone layout", async () => {
  const layer = canvas.touchZones;
  assert.ok(layer, "zone layer instantiated");
  assert.strictEqual(layer.columns, 20);
  assert.strictEqual(layer.rows, 15);
  assert.strictEqual(layer.levelCount, 10);
  assert.deepStrictEqual(layer.elevations, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.strictEqual(layer.cubeTiers, 20, "ten-foot levels are split into five-foot cubes");
  assert.strictEqual(layer.cubeCount, 6000, "every plan cell contains twenty stacked cubes");
  assert.strictEqual(layer.wireElevations.length, 21, "twenty tiers share twenty-one boundary grids");
  assert.strictEqual(layer.wireElevations.at(-1), 100, "the cube room reaches one hundred feet");
  assert.strictEqual(layer.zoneCount, 3000);
  assert.strictEqual(layer.labels.children.length, 20, "ten shared address planes + ten level titles");
  assert.strictEqual(layer.children.length, 2, "stacked grid lines and address labels both render");
  assert.ok(layer.labels.children.some((label) => label.text === "LVL 2 · 10 FT"), "second plane is labeled at ten feet");
  assert.deepStrictEqual(layer.zoneAt(0, 0, 1), { id: "1A", level: 1, elevation: 0 });
  assert.deepStrictEqual(layer.zoneAt(14, 19, 10), { id: "15T", level: 10, elevation: 90 });
  assert.strictEqual(layer.labels.children.filter((child) => child.texture === layer.labelTexture).length, 10, "one static address texture is shared by every level");
  assert.strictEqual(layer.labels.eventMode, "none", "labels never block map clicks");
});

const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
