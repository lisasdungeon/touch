/**
 * e2e/groups-test.mjs — marching groups: tracks moving together (matching
 * speed ±30u/s and heading ±15°) share one group contact with a stable id;
 * counter-marchers and drifters stay independent; groups persist, dissolve,
 * and re-associate on the next crossing.
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

// Two horizontal zones so an east-march crosses both each step.
const zA = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "ZoneA", elevation: 0,
});
const zB = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 500 }, b: { x: 2000, y: 500 }, name: "ZoneB", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
const hero = sampleScene.tokens.get("tok-hero");
const sniper = sampleScene.tokens.get("tok-balcony");

// Deterministic clock — COHERENT (250ms per Date.now() call): a fix never
// ages 30s+ mid-update, so the vector-freshness rule sees real cadence.
const realNow = Date.now.bind(Date);
let fake = realNow();
const tick = () => { Date.now = () => (fake += 250); };
const untick = () => { Date.now = realNow; };

console.log("== Association ==");
await checkAsync("lockstep marchers share one group contact", async () => {
  await T.clearMemory();
  T.memory.load(sampleScene); // bind write target
  tick();
  for (const x of [200, 400, 600, 800]) {
    await orc.update({ x, y: 300 });
    await hero.update({ x, y: 500 });
  }
  untick();
  const gOrc = T.groupOf(orc);
  const gHero = T.groupOf(hero);
  assert.ok(gOrc, "orc grouped");
  assert.strictEqual(gOrc, gHero, "same group id");
  const groups = T.groups();
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].members.length, 2);
  assert.ok(groups[0].vector.heading < 15, "heading due east");
});

await checkAsync("counter-marchers and non-movers stay independent", async () => {
  // Sniper marches west while the pair marches east.
  tick();
  for (const x of [1000, 1200, 1400]) {
    await orc.update({ x, y: 300 });
    await hero.update({ x, y: 500 });
    await sniper.update({ x: 3400 - x, y: 700 });
  }
  untick();
  assert.notStrictEqual(T.groupOf(sniper), T.groupOf(orc), "opposite heading ≠ shared group");
  const pair = T.groups().find((g) => g.members.length === 2);
  assert.ok(pair, "the east pair persists as its own group");
  assert.ok(pair.members.every((m) => m.label !== "Balcony Sniper"));
});

await checkAsync("lastTrackEvent carries the groupId", async () => {
  tick();
  await orc.update({ x: 1600, y: 300 });
  untick();
  assert.strictEqual(T.lastTrackEvent.groupId, T.groupOf(orc));
});

console.log("== Stability ==");
await checkAsync("group id stays stable as the group keeps marching", async () => {
  const before = T.groupOf(orc);
  tick();
  for (const x of [1800, 2000]) {
    await orc.update({ x, y: 300 });
    await hero.update({ x, y: 500 });
  }
  untick();
  assert.strictEqual(T.groupOf(orc), before, "no id churn");
});

await checkAsync("association survives persistence round-trip", async () => {
  const before = T.groupOf(orc);
  T.memory._dirty = true;
  await T.memory.flush();
  T.tracks.load(sampleScene);
  assert.strictEqual(T.groupOf(orc), before);
  assert.strictEqual(T.groups()[0].members.length, 2);
});

await checkAsync("a member leaving the formation dissolves its membership", async () => {
  // Hero stops marching (no updates) while orc keeps going: vectors diverge
  // only if the hero stops being re-observed. Reverse the orc instead — a
  // heading flip is incompatible with the group, so the group must shed it.
  const before = T.groupOf(orc);
  tick();
  for (const x of [1800, 1600, 1400]) {
    await orc.update({ x, y: 300 }); // now marching WEST
  }
  untick();
  assert.notStrictEqual(T.groupOf(orc), before, "re-grouped after heading flip");
});

console.log("== Lifecycle ==");
await checkAsync("dissolveGroup splits a group; members keep tracks", async () => {
  // Re-form the pair first (the heading flip above left the orc solo).
  tick();
  for (const x of [1400, 1600]) {
    await orc.update({ x, y: 300 });
    await hero.update({ x, y: 500 });
  }
  untick();
  const gid = T.groupOf(orc);
  assert.ok(gid, "group re-formed before dissolving");
  const trackId = T.trackOf(orc);
  assert.ok(T.dissolveGroup(gid));
  assert.strictEqual(T.groupOf(orc), null);
  assert.strictEqual(T.trackOf(orc), trackId, "track itself untouched");
  assert.strictEqual(T.groups().length, 0);
});

await checkAsync("re-association happens automatically on later crossings", async () => {
  tick();
  for (const x of [1400, 1600]) {
    await orc.update({ x, y: 300 });
    await hero.update({ x, y: 500 });
  }
  untick();
  const gid = T.groupOf(orc);
  assert.ok(gid, "grouped again");
  assert.strictEqual(gid, T.groupOf(hero));
});

console.log("== Hub & viewer ==");
await checkAsync("hub renders group chips with a dissolve action", async () => {
  await T.openHub();
  const chips = T.hub.element.querySelectorAll(".touch-group-chip");
  assert.ok(chips.length >= 1, "group chip present");
  const memberChip = T.hub.element.querySelector(".touch-track-chip.touch-track-grouped");
  assert.ok(memberChip, "member track chip marked as grouped");
});

await checkAsync("grouped member trails share the group hue in the room view", async () => {
  await T.openViewer();
  const v = T.viewer;
  v.flush();
  const hues = new Set(
    [...v.element.querySelectorAll(".touch-track-dot")]
      .filter((d) => d.dataset.group)
      .map((d) => d.style.getPropertyValue("--hue"))
  );
  assert.strictEqual(hues.size, 1, "all group members' trails share one hue");
  const tagged = v.element.querySelector(".touch-track-dot[data-group]");
  assert.ok(tagged?.title.includes("group"), "tooltip mentions the group");
});

// Cleanup
await pwMod.removePathway(sampleScene, zA.id);
await pwMod.removePathway(sampleScene, zB.id);
await T.clearMemory();
await T.viewer?.close();
await T.hub?.close();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
