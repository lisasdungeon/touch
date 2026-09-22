/**
 * e2e/wallheight-test.mjs — live verification of the Wall Height integration.
 * 1. Writes flags through Touch's real API (the same path the GM Hub uses).
 * 2. Feeds the update through a simulator of wall-height 4.1.x's actual hook
 *    chain and logs exactly how Wall Height reacts.
 * 3. Checks the sonar pipeline picks the bounds up (ping payload + storey).
 * 4. Sanity-checks Touch's legacy-scope fallback against wall-height's own
 *    migration key names.
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
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    results.push(["FAIL", name, err]);
  }
}
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

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await window.touch.openViewer();
const log = () => globalThis.mockState.whLog;

console.log("== Wall Height flag writes through Touch's API ==");
const wall = sampleScene.walls.get("wl-1");
await checkAsync("setEmitterWallHeight writes the 4.x schema", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", 10, "bottom");
  assert.deepStrictEqual(wall.flags["wall-height"], { bottom: 10, top: null });
  assert.strictEqual(typeof wall.setFlag, "function"); // went through setFlag
});
await checkAsync("Wall Height reacts: perception + refresh logged", async () => {
  const before = log().length;
  await window.touch.setEmitterWallHeight("wall.wl-1", 30, "top");
  const events = log().slice(before);
  // The hook chain: updateWall -> schedulePerceptionUpdate(false) + refresh
  assert.ok(
    events.some((e) => e.type === "perception" && e.opts.refreshVision),
    "schedulePerceptionUpdate fired with full refresh options"
  );
  // setWallHeightRange writes both keys in sequence, so take the LAST refresh.
  const refresh = events.filter((e) => e.type === "wallRefresh" && e.id === "wl-1").at(-1);
  assert.ok(refresh, "wall refresh (drawWallRange) fired");
  assert.strictEqual(refresh.top, 30, "refresh sees top=30");
  assert.strictEqual(refresh.bottom, 10, "refresh sees bottom=10");
});
await checkAsync("clearing extent writes nulls (infinite bounds)", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", null);
  assert.deepStrictEqual(wall.flags["wall-height"], { bottom: null, top: null });
  const refresh = log().filter((e) => e.type === "wallRefresh" && e.id === "wl-1").at(-1);
  assert.ok(refresh);
  assert.strictEqual(refresh.top, Infinity, "Wall Height treats null top as +Inf");
  assert.strictEqual(refresh.bottom, -Infinity, "Wall Height treats null bottom as -Inf");
});

console.log("== Sonar pipeline carries the bounds ==");
const { collectEmitters } = await import("../touch/scripts/emitters.js");
/** Capture local pings while the pinger emits one from the wall emitter. */
async function captureWallPing() {
  const pings = [];
  const pinger = window.touch.pinger;
  const orig = pinger.receive.bind(pinger);
  pinger.receive = (payload) => pings.push(...payload.pings);
  try {
    const emitter = collectEmitters(sampleScene).find((e) => e.id === "wall.wl-1");
    assert.ok(emitter, "wall is an active emitter");
    pinger.emitOne(emitter);
  } finally {
    pinger.receive = orig;
  }
  return pings.find((p) => p.id === "wall.wl-1");
}
await checkAsync("ping payload levels come from Wall Height", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", 10, "bottom");
  await window.touch.setEmitterWallHeight("wall.wl-1", 30, "top");
  const ping = await captureWallPing();
  assert.ok(ping, "wall ping emitted");
  assert.deepStrictEqual(
    ping.levels,
    { bottom: 10, top: 30 },
    "ping carries the Wall Height extent (Levels absent)"
  );
});
await checkAsync("Levels range wins over Wall Height when both exist", async () => {
  wall.flags.levels = { rangeBottom: 20, rangeTop: 40 };
  try {
    const ping = await captureWallPing();
    assert.deepStrictEqual(ping.levels, { bottom: 20, top: 40 });
  } finally {
    delete wall.flags.levels; // restore
  }
});
check("viewer places the wall ping on the right storey", () => {
  window.touch.pinger.pulse({ broadcast: false, local: true });
  const frames = window.touch.viewer.frames.get("front");
  const wallFrame = [...frames.values()].find((f) => f.id === "wall.wl-1");
  assert.ok(wallFrame, "wall frame exists");
  // wall bottom=10, storeyHeight=10 -> floor band F1
  assert.strictEqual(wallFrame.floor, 1);
  assert.strictEqual(wallFrame.storey, 1);
});

console.log("== Sweep filtering semantics (Wall Height vision behavior) ==");
check("wall blocks a source outside its extent, passes inside", () => {
  // Restored extent: bottom=10, top=30 (re-assert after Levels cleanup)
  assert.deepStrictEqual(
    { bottom: wall.flags["wall-height"].bottom, top: wall.flags["wall-height"].top },
    { bottom: 10, top: 30 }
  );
  const sim = globalThis.WallHeightSim;
  assert.strictEqual(sim.sweepIncludes(wall, 0), false, "ground token is blocked");
  assert.strictEqual(sim.sweepIncludes(wall, 20), true, "elev-20 source passes");
  assert.strictEqual(sim.sweepIncludes(wall, 5, 12), false, "band straddling bottom fails");
  assert.strictEqual(sim.sweepIncludes(wall, 12, 28), true, "band inside extent passes");
});
check("legacy pre-4.0 scope maps to wallHeightTop/wallHeightBottom", async () => {
  // wall-height's own migrateData() uses these legacy key names.
  const ghost = { flags: { wallHeight: { wallHeightTop: 25, wallHeightBottom: 5 } } };
  const { getWallHeightRange } = await import("../touch/scripts/elevation.js");
  assert.deepStrictEqual(getWallHeightRange(ghost), { bottom: 5, top: 25 });
  // nulls in the modern schema stay infinite
  assert.deepStrictEqual(
    getWallHeightRange({ flags: { "wall-height": { top: null, bottom: null } } }),
    { bottom: null, top: null }
  );
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
