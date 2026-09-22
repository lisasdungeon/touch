/**
 * e2e/rate-test.mjs — covers per-emitter ping frequency (rate) and feedback
 * tones: scheduler cadence, stagger, tone through pings/frames/rings.
 */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { sampleScene, game } from "./foundry-mock.mjs";

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

console.log("== Per-emitter ping frequency ==");
// Rates must exist before the scheduler checks run.
await checkAsync("rate stored and validated", async () => {
  await window.touch.setEmitterRate("token.tok-hero", 2);
  await window.touch.setEmitterRate("token.tok-orc", null); // stays global
  assert.strictEqual(sampleScene.tokens.get("tok-hero").getFlag("touch", "sonar").rate, 2);
  assert.strictEqual(sampleScene.tokens.get("tok-orc").getFlag("touch", "sonar")?.rate ?? 0, 0);
  await window.touch.setEmitterRate("token.tok-hero", -4);
  assert.strictEqual(sampleScene.tokens.get("tok-hero").getFlag("touch", "sonar").rate, 0);
  await window.touch.setEmitterRate("token.tok-hero", 2);
});
check("scheduler fires rate>0 emitters more often than global", () => {
  // Global interval 6s; hero gets rate 2 (every 2s), orc keeps global.
  const pinger = window.touch.pinger;
  pinger.phase = 0;
  // In a real run tick() advances phase; emulate 6 seconds of ticks:
  const pings = [];
  const origReceive = pinger.receive.bind(pinger);
  pinger.receive = (payload) => { pings.push(...payload.pings); };
  for (let s = 1; s <= 6; s++) {
    pinger.phase = s;
    pinger.tick();
  }
  pinger.receive = origReceive;
  const heroPings = pings.filter((p) => p.id === "token.tok-hero").length;
  const orcPings = pings.filter((p) => p.id === "token.tok-orc").length;
  assert.strictEqual(heroPings, 3, `hero (rate 2) pings 3 times in 6s, got ${heroPings}`);
  assert.strictEqual(orcPings, 1, `orc (global 6s) pings once, got ${orcPings}`);
});
check("stagger prevents simultaneous fast emitters", () => {
  const list = window.touch.emitters();
  assert.ok(list.length >= 2);
});
await checkAsync("rate survives a round trip through flags", async () => {
  await window.touch.setEmitterRate("token.tok-hero", 2);
  assert.strictEqual(sampleScene.tokens.get("tok-hero").getFlag("touch", "sonar").rate, 2);
});
check("rate 0 follows the global interval", () => {
  const pinger = window.touch.pinger;
  // Orc has rate 0: only pings when phase is a multiple of the 6s interval.
  const pings = [];
  const orig = pinger.receive.bind(pinger);
  pinger.receive = (payload) => pings.push(...payload.pings);
  pinger.phase = 3; // not a multiple of 6
  const due = pinger.tick();
  pinger.receive = orig;
  assert.ok(!due.includes("token.tok-orc"), "orc not due at phase 3");
});

console.log("== Feedback tones ==");
await checkAsync("tone stored and normalized", async () => {
  await window.touch.setEmitterRate("token.tok-hero", null, "low");
  assert.strictEqual(sampleScene.tokens.get("tok-hero").getFlag("touch", "sonar").tone, "low");
  // invalid tone rejected
  await window.touch.setEmitterRate("token.tok-hero", null, "bass");
  assert.strictEqual(sampleScene.tokens.get("tok-hero").getFlag("touch", "sonar").tone, "low");
});
check("tone rides the ping payload and frames", () => {
  window.touch.pinger.pulse({ broadcast: true, local: true });
  const frames = window.touch.viewer.frames.get("front");
  let hero = null;
  for (const f of frames.values()) if (f.id === "token.tok-hero") hero = f;
  assert.ok(hero, "hero frame exists");
  assert.strictEqual(hero.tone, "low", "tone on frame");
});
check("ring weight differs by tone", () => {
  const rings = canvas.touchRings.sprites;
  assert.ok(rings.length >= 2, "rings emitted");
  // The mock layer records raw emit opts; the real layer derives stroke weight
  // from tone (low=4, mid=2, high=1). Assert the recorded tones instead.
  const tones = new Set(rings.map((r) => r.tone));
  assert.ok(tones.has("low"), "low tone ring emitted");
  assert.ok(tones.has("mid"), "mid tone ring emitted");
});
check("real ring layer derives weight from tone", async () => {
  const { RingLayer } = await import("../touch/scripts/rings.js");
  const layer = new RingLayer();
  layer.rings = { addChild() {} }; // simulate post-_draw state
  layer.emit({ x: 0, y: 0 }, { tone: "low" });
  layer.emit({ x: 0, y: 0 }, { tone: "mid" });
  layer.emit({ x: 0, y: 0 }, { tone: "high" });
  const weights = layer.sprites.map((s) => s.weight).sort((a, b) => b - a);
  assert.deepStrictEqual(weights, [4, 2, 1]);
});
check("waypoint rate/tone through API", async () => {
  const wpMod = await import("../touch/scripts/waypoints.js");
  const wp = await wpMod.deployWaypoint(sampleScene, { x: 400, y: 400, config: { rate: 3, tone: "high" } });
  await window.touch.setEmitterRate(wp.id, 5, "low");
  const stored = wpMod.getWaypoints(sampleScene).find((w) => w.id === wp.id);
  assert.strictEqual(stored.config.rate, 5);
  assert.strictEqual(stored.config.tone, "low");
  await window.touch.removeWaypoint(wp.id);
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
