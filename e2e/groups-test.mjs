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
const sessionId = { orc: null, hero: null, sniper: null };
const cross = async (who, doc, data) => {
  const before = T.lastTrackEvent;
  await doc.update(data);
  if (T.lastTrackEvent && T.lastTrackEvent !== before) sessionId[who] = T.lastTrackEvent.id;
};
const groupOfSession = (who) => (sessionId[who] ? T.groupOf(sessionId[who]) : null);

console.log("== Association ==");
await checkAsync("lockstep marchers share one group contact", async () => {
  await T.clearMemory();
  T.memory.load(sampleScene); // bind write target
  tick();
  for (const x of [200, 400, 600, 800]) {
    await cross("orc", orc, { x, y: 300 });
    await cross("hero", hero, { x, y: 500 });
  }
  untick();
  const gOrc = groupOfSession("orc");
  const gHero = groupOfSession("hero");
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
    await cross("orc", orc, { x, y: 300 });
    await cross("hero", hero, { x, y: 500 });
    await cross("sniper", sniper, { x: 3400 - x, y: 700 });
  }
  untick();
  assert.notStrictEqual(groupOfSession("sniper"), groupOfSession("orc"), "opposite heading ≠ shared group");
  const pair = T.groups().find((g) => g.members.length === 2);
  assert.ok(pair, "the east pair persists as its own group");
  assert.ok(pair.members.every((m) => m.label !== "Balcony Sniper"));
});

await checkAsync("lastTrackEvent carries the groupId", async () => {
  tick();
  await cross("orc", orc, { x: 1600, y: 300 });
  untick();
  assert.strictEqual(T.lastTrackEvent.groupId, groupOfSession("orc"));
});

console.log("== Stability ==");
await checkAsync("group id stays stable as the group keeps marching", async () => {
  const before = groupOfSession("orc");
  tick();
  for (const x of [1800, 2000]) {
    await cross("orc", orc, { x, y: 300 });
    await cross("hero", hero, { x, y: 500 });
  }
  untick();
  assert.strictEqual(groupOfSession("orc"), before, "no id churn");
});

await checkAsync("association survives persistence round-trip", async () => {
  const before = groupOfSession("orc");
  T.memory._dirty = true;
  await T.memory.flush();
  T.tracks.load(sampleScene);
  assert.strictEqual(groupOfSession("orc"), before);
  assert.strictEqual(T.groups()[0].members.length, 2);
});

await checkAsync("a member leaving the formation dissolves its membership", async () => {
  // Hero stops marching (no updates) while orc keeps going: vectors diverge
  // only if the hero stops being re-observed. Reverse the orc instead — a
  // heading flip is incompatible with the group, so the group must shed it.
  const before = groupOfSession("orc");
  tick();
  for (const x of [1800, 1600, 1400]) {
    await cross("orc", orc, { x, y: 300 }); // now marching WEST
  }
  untick();
  assert.notStrictEqual(groupOfSession("orc"), before, "re-grouped after heading flip");
});

console.log("== Lifecycle ==");
await checkAsync("dissolveGroup splits a group; members keep tracks", async () => {
  // Re-form the pair first (the heading flip above left the orc solo).
  tick();
  for (const x of [1400, 1600]) {
    await cross("orc", orc, { x, y: 300 });
    await cross("hero", hero, { x, y: 500 });
  }
  untick();
  const gid = groupOfSession("orc");
  assert.ok(gid, "group re-formed before dissolving");
  const trackId = sessionId.orc;
  assert.ok(T.dissolveGroup(gid));
  assert.strictEqual(groupOfSession("orc"), null);
  assert.strictEqual(sessionId.orc, trackId, "track itself untouched");
  assert.ok(T.trackGet(trackId), "track itself untouched");
  assert.strictEqual(T.groups().length, 0);
});

await checkAsync("re-association happens automatically on later crossings", async () => {
  tick();
  for (const x of [1400, 1600]) {
    await cross("orc", orc, { x, y: 300 });
    await cross("hero", hero, { x, y: 500 });
  }
  untick();
  const gid = groupOfSession("orc");
  assert.ok(gid, "grouped again");
  assert.strictEqual(gid, groupOfSession("hero"));
});

console.log("== Hub & viewer ==");
await checkAsync("hub renders group chips with a dissolve action", async () => {
  await T.openHub();
  const chips = T.hub.element.querySelectorAll(".touch-group-chip");
  assert.ok(chips.length >= 1, "group chip present");
  const memberChip = T.hub.element.querySelector(".touch-track-chip.touch-track-grouped");
  assert.ok(memberChip, "member track chip marked as grouped");
});

await checkAsync("grouped member trails share the group hue at memory corners", async () => {
  await T.openViewer();
  const v = T.viewer;
  v.flush();
  for (let index = 0; index < 100 && !v.hypergrid; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  await v.hypergrid.ready;
  const hues = new Set(
    [...v.hypergrid.active]
      .filter((point) => point.dataset.group)
      .map((point) => point.style.getPropertyValue("--touch-cell-color"))
  );
  assert.strictEqual(hues.size, 1, "all group members' trails share one hue");
  const tagged = [...v.hypergrid.active].find((point) => point.dataset.group);
  assert.ok(tagged?.title.includes(tagged.dataset.group), "tooltip identifies the group");
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
