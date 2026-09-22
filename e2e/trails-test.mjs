/**
 * e2e/trails-test.mjs — track trails in the room view: dotted position
 * history per track, age fading, pulsing head dot, per-track stable hue,
 * floor-filter integration, 24-dot cap, and Forget All cleanup.
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
    console.log(`  FAIL  ${name}\n        ${err.stack.split("\n").slice(1, 3).join("\n        ")}`);
    results.push(["FAIL", name, err]);
  }
}

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.canvasInit ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await setupCanvasLayers();
const T = window.touch;
const pwMod = await import("../touch/scripts/pathways.js");

const zone = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "Zone", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
const hero = sampleScene.tokens.get("tok-hero");
await orc.update({ x: 500, y: 100 });
await hero.update({ x: 800, y: 100 });
await T.clearMemory();
await T.openViewer();
const v = T.viewer;
const dots = () => [...v.element.querySelectorAll(".touch-track-dot")];

console.log("== Trail rendering ==");
await checkAsync("each fix becomes a dot on the track's trail", async () => {
  await orc.update({ x: 500, y: 300 });
  await orc.update({ x: 900, y: 300 });
  await orc.update({ x: 1300, y: 300 });
  v.flush();
  assert.strictEqual(dots().length, 3, "one dot per fix");
  assert.ok(dots().every((d) => d.dataset.track), "dots tagged with their track id");
});

await checkAsync("the newest fix pulses as the trail head", async () => {
  const heads = dots().filter((d) => d.dataset.head === "1");
  assert.strictEqual(heads.length, 1, "exactly one head");
  const last = dots().at(-1);
  assert.strictEqual(heads[0], last, "head is the most recent fix");
});

await checkAsync("trail fades with age: older dots are dimmer and smaller", async () => {
  const ds = dots();
  const aFirst = Number(ds[0].style.getPropertyValue("--a"));
  const aLast = Number(ds.at(-1).style.getPropertyValue("--a"));
  assert.ok(aLast > aFirst, `newest brighter (${aLast} > ${aFirst})`);
  const sFirst = Number(ds[0].style.getPropertyValue("--s"));
  const sLast = Number(ds.at(-1).style.getPropertyValue("--s"));
  assert.ok(sLast > sFirst, `newest larger (${sLast} > ${sFirst})`);
});

console.log("== Multi-track ==");
await checkAsync("separate tracks get separate stable hues", async () => {
  await hero.update({ x: 700, y: 300 });
  v.flush();
  const byTrack = new Map();
  for (const d of dots()) {
    const hue = d.style.getPropertyValue("--hue");
    if (byTrack.has(d.dataset.track)) {
      assert.strictEqual(byTrack.get(d.dataset.track), hue, "hue stable per track");
    } else {
      byTrack.set(d.dataset.track, hue);
    }
  }
  assert.strictEqual(byTrack.size, 2, "two tracks on screen");
  assert.strictEqual(new Set(byTrack.values()).size, 2, "hues differ");
});

await checkAsync("dots carry the track label on hover", async () => {
  assert.ok(dots().every((d) => d.title.length > 0), "every dot has a title");
});

console.log("== Integration ==");
await checkAsync("floor filter hides trails off the selected storey", async () => {
  v.floorFilter = 5;
  v.flush();
  assert.strictEqual(dots().length, 0, "F5 has no trail dots");
  v.floorFilter = 0;
  v.flush();
  assert.strictEqual(dots().length, 4, "F0 shows everything again");
});

await checkAsync("trail view caps at 24 dots per track", async () => {
  for (let x = 100; x <= 1900 && dots().filter((d) => d.dataset.track === T.trackOf(orc)).length < 30; x += 70) {
    await orc.update({ x, y: 300 });
  }
  v.flush();
  const orcDots = dots().filter((d) => d.dataset.track === T.trackOf(orc));
  assert.ok(orcDots.length <= 24, `capped (${orcDots.length} ≤ 24)`);
});

await checkAsync("Forget All clears all trails", async () => {
  await T.clearMemory();
  v.flush();
  assert.strictEqual(dots().length, 0);
});

// Cleanup
await pwMod.removePathway(sampleScene, zone.id);
await T.clearMemory();
await T.viewer?.close();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
