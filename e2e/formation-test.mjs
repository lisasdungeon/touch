/**
 * e2e/formation-timeline-test.mjs — the formation timeline: join/leave
 * ledger per marching group, deterministic clock, hero departs (heading
 * change) → "left", rejoins same group id → "joined", quiet member leaves
 * via vector freshness, manual dissolve ledger, hub rendering, API surface,
 * persistence of the ledger.
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

const zA = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "ZoneA", elevation: 0,
});
const zB = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 500 }, b: { x: 2000, y: 500 }, name: "ZoneB", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
const hero = sampleScene.tokens.get("tok-hero");

// Deterministic clock: 250ms per Date.now() call keeps time COHERENT within
// an update (a fix never ages 30s mid-update), and jump() fast-forwards for
// staleness tests.
const realNow = Date.now.bind(Date);
let fake = realNow();
const tick = () => { Date.now = () => (fake += 250); };
const untick = () => { Date.now = realNow; };
const jump = (ms) => { fake += ms; };
let orcTrack = null;
let heroTrack = null;
const cross = async (who, doc, data) => {
  const before = T.lastTrackEvent;
  await doc.update(data);
  if (T.lastTrackEvent && T.lastTrackEvent !== before) {
    if (who === "orc") orcTrack = T.lastTrackEvent.id;
    if (who === "hero") heroTrack = T.lastTrackEvent.id;
  }
};
const groupOfOrc = () => (orcTrack ? T.groupOf(orcTrack) : null);

console.log("== Ledger ==");
await checkAsync("formation opens with formed + joined events", async () => {
  await T.clearMemory();
  T.memory.load(sampleScene);
  tick();
  await cross("orc", orc, { x: 200, y: 300 });
  await cross("hero", hero, { x: 200, y: 500 });
  await cross("orc", orc, { x: 400, y: 300 });
  await cross("hero", hero, { x: 400, y: 500 });
  untick();
  const gid = groupOfOrc();
  assert.ok(gid, "group exists");
  const tl = T.formationTimeline(gid, 12);
  assert.ok(tl, "timeline found");
  const kinds = tl.events.map((e) => e.event);
  assert.ok(kinds.includes("formed"), "formed logged");
  assert.deepStrictEqual(kinds.filter((k) => k === "joined").length >= 2, true, "both members joined");
  assert.ok(tl.events.every((e, i) => i === 0 || e.t >= tl.events[i - 1].t), "chronological");
});

await checkAsync("a heading flip logs left + later joined on the SAME group id", async () => {
  const gid = groupOfOrc();
  // Sonar only learns of a departure from EVIDENCE: the hero marches west
  // along his zone beam (heading 180) while the orc keeps marching east.
  tick();
  await cross("hero", hero, { x: 300, y: 500 });
  await cross("orc", orc, { x: 600, y: 300 });
  await cross("hero", hero, { x: 150, y: 500 });
  await cross("orc", orc, { x: 800, y: 300 });
  untick();
  const mid = T.formationTimeline(gid, 12);
  assert.ok(mid.events.some((e) => e.label === "Hero" && e.event === "left"), "hero's departure logged");
  // Hero rejoins the formation, marching east along the beam again.
  tick();
  await cross("hero", hero, { x: 400, y: 500 });
  await cross("orc", orc, { x: 1000, y: 300 });
  await cross("hero", hero, { x: 600, y: 500 });
  await cross("orc", orc, { x: 1200, y: 300 });
  untick();
  const gid2 = groupOfOrc();
  assert.strictEqual(gid2, gid, "group id survived the split");
  const tl = T.formationTimeline(gid, 12);
  const heroEvents = tl.events.filter((e) => e.label === "Hero");
  assert.ok(heroEvents.some((e) => e.event === "joined"), "hero's return logged");
  const joined = heroEvents.findLastIndex((e) => e.event === "joined"); // the REJOIN, not the original join
  const left = heroEvents.findIndex((e) => e.event === "left");
  assert.ok(left > -1 && joined > left, "return comes after departure");
});

await checkAsync("a quiet member (no fresh crossings) leaves the formation", async () => {
  // Hero's last observation is pushed past the 30s freshness window while
  // the orc keeps marching: the sonar stopped seeing the hero → he leaves.
  // The group goes lone here, so read the timeline, not groupOf.
  const gid = groupOfOrc();
  tick();
  jump(120000);
  await cross("orc", orc, { x: 1400, y: 300 });
  await cross("orc", orc, { x: 1500, y: 300 });
  untick();
  const tl = T.formationTimeline(gid, 12);
  const heroLeft = (tl?.events ?? []).filter((e) => e.label === "Hero" && e.event === "left");
  assert.ok(heroLeft.length >= 1, `stale member logged as leaving (${heroLeft.length})`);
});

console.log("== API & hub ==");
await checkAsync("touch.formationTimeline() returns all groups; per-group returns one", async () => {
  const all = T.formationTimeline();
  assert.ok(Array.isArray(all) && all.length >= 1);
  const one = T.formationTimeline(all[0].id, 12);
  assert.ok(one && one.id === all[0].id);
  assert.strictEqual(T.formationTimeline("grp.nope"), null);
});

await checkAsync("hub renders the timeline ledger under each group chip", async () => {
  // Re-form a real group first (the staleness test left the orc solo).
  tick();
  await cross("orc", orc, { x: 1600, y: 300 });
  await cross("hero", hero, { x: 1600, y: 500 });
  await cross("orc", orc, { x: 1700, y: 300 });
  await cross("hero", hero, { x: 1700, y: 500 });
  untick();
  await T.openHub();
  const items = T.hub.element.querySelectorAll(".touch-group-item");
  assert.ok(items.length >= 1, "group items rendered");
  const ledger = T.hub.element.querySelectorAll(".touch-timeline-event");
  assert.ok(ledger.length >= 3, `ledger entries rendered (${ledger.length})`);
  assert.ok(T.hub.element.querySelector(".touch-timeline-joined"), "joined styling present");
  assert.ok(T.hub.element.querySelector(".touch-timeline-left"), "left styling present");
  assert.ok(T.hub.element.querySelector('[data-timeline-when]') === null, "no legacy attr");
});

await checkAsync("manual dissolve is logged in the ledger before teardown", async () => {
  const gid = groupOfOrc();
  assert.ok(T.dissolveGroup(gid));
  assert.strictEqual(T.groups().length, 0, "no live formations remain");
  const tl = T.formationTimeline(gid, 12);
  assert.ok(tl, "dissolved group's ledger stays readable");
  assert.ok(tl.dissolved, "record marked dissolved");
  assert.ok(tl.events.some((e) => e.event === "dissolved"), "dissolved event logged");
});

await checkAsync("timeline ledger persists through a save/reload round-trip", async () => {
  // Re-form, flush, reload: the ledger must come back with the tracks.
  tick();
  await cross("orc", orc, { x: 200, y: 300 });
  await cross("hero", hero, { x: 200, y: 500 });
  await cross("orc", orc, { x: 400, y: 300 });
  await cross("hero", hero, { x: 400, y: 500 });
  untick();
  T.memory._dirty = true;
  await T.memory.flush();
  T.tracks.load(sampleScene);
  const gid = groupOfOrc();
  assert.ok(gid, "group re-loaded");
  const tl = T.formationTimeline(gid, 12);
  assert.ok(tl.events.length >= 2, "ledger entries persisted");
  assert.ok(tl.events.some((e) => e.event === "joined"));
});

// Cleanup
await pwMod.removePathway(sampleScene, zA.id);
await pwMod.removePathway(sampleScene, zB.id);
await T.clearMemory();
await T.hub?.close();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
