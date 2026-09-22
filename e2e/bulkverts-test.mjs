/**
 * e2e/bulkverts-test.mjs — bulk verticals editor in the GM Hub.
 * Verifies the touch.bulkSetVerticals API: kind filtering, module gating,
 * Levels vs Wall Height targets, one-sided ranges, clearing, per-object
 * pings, and hub re-render.
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

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await window.touch.openHub();
await window.touch.openViewer();

const walls = () => [...sampleScene.walls];
const lights = () => [...sampleScene.lights];

console.log("== Bulk verticals API ==");
await checkAsync("applies a Wall Height extent to all walls", async () => {
  const n = await window.touch.bulkSetVerticals({
    module: "wallHeight", kinds: ["wall"], bottom: 10, top: 30,
  });
  assert.strictEqual(n, walls().length);
  for (const w of walls()) {
    assert.deepStrictEqual(w.flags["wall-height"], { bottom: 10, top: 30 });
  }
});
await checkAsync("kind filter is respected (lights untouched)", async () => {
  for (const l of lights()) delete l.flags["wall-height"];
  await window.touch.bulkSetVerticals({
    module: "wallHeight", kinds: ["wall"], bottom: 0, top: 10,
  });
  for (const l of lights()) {
    assert.strictEqual(l.flags["wall-height"]?.top ?? null, null, "light not touched");
  }
});
await checkAsync("one-sided range: empty bounds become null", async () => {
  await window.touch.bulkSetVerticals({
    module: "wallHeight", kinds: ["wall"], bottom: null, top: 20,
  });
  for (const w of walls()) {
    assert.strictEqual(w.flags["wall-height"].bottom, null);
    assert.strictEqual(w.flags["wall-height"].top, 20);
  }
});
await checkAsync("clear removes the override on every target", async () => {
  const n = await window.touch.bulkSetVerticals({
    module: "wallHeight", kinds: ["wall"], clear: true,
  });
  assert.strictEqual(n, walls().length);
  for (const w of walls()) {
    assert.deepStrictEqual(w.flags["wall-height"], { bottom: null, top: null });
  }
});
await checkAsync("invalid kinds are filtered, not written", async () => {
  // Levels targets only tokens/walls; asking it to hit lights must no-op.
  const n = await window.touch.bulkSetVerticals({
    module: "levels", kinds: ["light", "sound"], bottom: 5, top: 5,
  });
  assert.strictEqual(n, 0);
});
await checkAsync("Levels bulk hits tokens and walls together", async () => {
  const n = await window.touch.bulkSetVerticals({
    module: "levels", kinds: ["token", "wall"], bottom: 0, top: 10,
  });
  const expected =
    [...sampleScene.tokens].filter((t) => t.object?.visible).length +
    walls().length;
  assert.strictEqual(n, expected);
  assert.strictEqual(
    sampleScene.tokens.get("tok-hero").flags.levels.rangeTop, 10
  );
  // restore tokens so other suites are unaffected
  for (const t of sampleScene.tokens) delete t.flags.levels;
});
await checkAsync("each target fires a sonar ping", async () => {
  const pings = [];
  const orig = window.touch.pinger.receive.bind(window.touch.pinger);
  window.touch.pinger.receive = (payload) => pings.push(...payload.pings);
  try {
    await window.touch.bulkSetVerticals({
      module: "wallHeight", kinds: ["light"], bottom: null, top: 25,
    });
  } finally {
    window.touch.pinger.receive = orig;
  }
  const ids = pings.map((p) => p.id).filter((id) => id.startsWith("light."));
  assert.strictEqual(ids.length, lights().length, "one ping per light");
});
await checkAsync("hub re-renders after bulk apply", async () => {
  let renders = 0;
  const hub = window.touch.hub;
  const orig = hub.render.bind(hub);
  hub.render = (...a) => { renders++; return orig(...a); };
  await window.touch.bulkSetVerticals({
    module: "wallHeight", kinds: ["light"], bottom: null, top: 25,
  });
  hub.render = orig;
  assert.ok(renders >= 1, "render called");
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
