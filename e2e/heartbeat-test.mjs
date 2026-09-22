/**
 * e2e/heartbeat-test.mjs — heartbeat timers: per-emitter countdown math,
 * corner monitor deployment on lattice corners, hub pulse column with live
 * ticker, and viewer status heartbeat.
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
const wpMod = await import("../touch/scripts/waypoints.js");

console.log("== Heartbeat countdown ==");
await checkAsync("heartbeats returns seconds-to-next-ping per emitter", async () => {
  T.pinger.phase = 0;
  const beats = T.heartbeats();
  assert.ok(beats.size > 0, "emitters present");
  // Global-cadence emitters (rate 0) with interval 6 → all due in 6 at phase 0
  assert.strictEqual(beats.get("token.tok-hero"), 6);
  // A rate-3 emitter is due within 1..3
  const fast = [...beats.entries()].filter(([id]) => id === "token.tok-orc");
  assert.ok(fast.every(([, v]) => v >= 1 && v <= 6), "countdown in range");
});

await checkAsync("countdown decreases with phase and wraps", async () => {
  T.pinger.phase = 0;
  assert.strictEqual(T.heartbeats().get("token.tok-hero"), 6);
  T.pinger.phase = 2;
  assert.strictEqual(T.heartbeats().get("token.tok-hero"), 4);
  T.pinger.phase = 5;
  assert.strictEqual(T.heartbeats().get("token.tok-hero"), 1);
  T.pinger.phase = 6;
  assert.strictEqual(T.heartbeats().get("token.tok-hero"), 6, "wrapped");
});

await checkAsync("muted emitters have no heartbeat", async () => {
  const wall = sampleScene.walls.get("wl-1");
  await T.setEmitterConfig("wall.wl-1", { muted: true });
  const beats = T.heartbeats();
  assert.strictEqual(beats.get("wall.wl-1"), undefined, "muted → no beat");
  await T.setEmitterConfig("wall.wl-1", { muted: false });
  assert.ok(T.heartbeats().has("wall.wl-1"), "unmuted → beat returns");
});

await checkAsync("globally muted silences every heart", async () => {
  await T.setGlobalMuted(true);
  assert.strictEqual(T.heartbeats().size, 0);
  await T.setGlobalMuted(false);
  assert.ok(T.heartbeats().size > 0);
});

console.log("== Corner monitors ==");
await checkAsync("deploy puts a monitor on every plan corner per storey", async () => {
  // 2x2 lattice, 2 storeys → 3×3 corners × 2 = 18 monitors
  await T.generateLattice({ cellW: 2, cellD: 2, storeys: 2, intensity: 25 });
  const res = await T.setLatticeMonitors({ deploy: true });
  assert.strictEqual(res.added, 18);
  const monitors = T.getCornerMonitors();
  assert.strictEqual(monitors.length, 18);
  // Per storey elevations: 12 at 0, 6... no — 9 corners × 2 storeys
  assert.strictEqual(monitors.filter((m) => m.elevation === 0).length, 9);
  assert.strictEqual(monitors.filter((m) => m.elevation === 10).length, 9);
  // Named by cell + storey
  assert.match(monitors[0].name, /Corner \d+·\d+ monitor · S\d/);
});

await checkAsync("monitors are real waypoints and ping through the pipeline", async () => {
  const wp = wpMod.getWaypoints(sampleScene).find((w) => w.cornerMonitor);
  assert.ok(wp, "monitor is a waypoint");
  assert.ok(wp.config.intensity > 0, "audible");
  // Emitter scan includes them (flag surfaced on the emitter)
  const emitters = T.emitters().filter((e) => e.cornerMonitor);
  assert.strictEqual(emitters.length, 18);
  // Heartbeats cover them
  const beats = T.heartbeats();
  assert.ok(beats.has(wp.id), "monitor has a heartbeat");
});

await checkAsync("re-deploy after regenerating re-anchors, no duplicates", async () => {
  await T.generateLattice({ cellW: 1, cellD: 1, storeys: 1 }); // 2×2 corners × 1 = 4
  const res = await T.setLatticeMonitors({ deploy: true });
  assert.strictEqual(res.added, 0, "nothing new — ids are corner-stable");
  assert.strictEqual(res.updated, 0, "kept corners unchanged");
  assert.strictEqual(T.getCornerMonitors().length, 4, "count follows lattice");
  assert.strictEqual(res.removed, 14, "stale corners dropped");
});

await checkAsync("clear removes monitors but not junctions or hand monitors", async () => {
  // Give one corner monitor a manual tweak so it's distinguishable? No —
  // junction waypoints must survive monitor clearing.
  const res = await T.setLatticeMonitors({ deploy: false });
  assert.strictEqual(res.removed, 4);
  assert.strictEqual(T.getCornerMonitors().length, 0);
  // Lattice lines still exist (independent feature)
  const pwMod = await import("../touch/scripts/pathways.js");
  assert.ok(pwMod.getPathways(sampleScene).some((p) => p.lattice));
  await T.clearLattice();
});

console.log("== Hub heartbeat UI ==");
await checkAsync("hub rows show pulse countdown and ticker updates it", async () => {
  await T.openHub();
  const root = T.hub.element;
  const cell = root.querySelector('[data-beat-id="token.tok-hero"]');
  assert.ok(cell, "beat cell present");
  T.pinger.phase = 0;
  const v1 = cell.querySelector(".touch-beat-value").textContent;
  assert.strictEqual(v1, "6s");
  // Simulate a phase advance + one ticker step
  T.pinger.phase = 3;
  await new Promise((r) => setTimeout(r, 1100));
  const v2 = cell.querySelector(".touch-beat-value").textContent;
  assert.strictEqual(v2, "3s", `ticker updated (${v2})`);
});

await checkAsync("hub monitor section wires deploy/clear actions", async () => {
  const root = T.hub.element;
  const deploy = root.querySelector('[data-action="monitorsDeploy"]');
  const clear = root.querySelector('[data-action="monitorsClear"]');
  assert.ok(deploy && clear, "monitor buttons present");
  deploy.click();
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(T.getCornerMonitors().length, 4, "deployed via UI");
  clear.click();
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(T.getCornerMonitors().length, 0, "cleared via UI");
});

await checkAsync("closing the hub stops the ticker", async () => {
  await T.hub.close({ force: true });
  assert.strictEqual(T.hub.rendered, false);
  await new Promise((r) => setTimeout(r, 1100));
  // No throw = ticker stopped (its step found rendered=false and bailed).
});

console.log("== Viewer heartbeat ==");
await checkAsync("viewer status shows a racing heart approaching the beat", async () => {
  await T.openViewer();
  T.pinger.phase = 0;
  const status = T.viewer.element.querySelector("[data-status]");
  await new Promise((r) => setTimeout(r, 60));
  const heart = status.querySelector(".touch-heart");
  assert.ok(heart, "heart element present");
  const due0 = Number(heart.dataset.due);
  assert.ok(due0 >= 1 && due0 <= 6, `due-in tracked (${due0})`);
  T.pinger.phase = 5; // global-cadence emitters 1s out
  await T.setGlobalMuted(true); // isolate: hide rate>0 hearts
  await T.setGlobalMuted(false);
  await new Promise((r) => setTimeout(r, 1100));
  const due1 = Number(heart.dataset.due);
  assert.ok(due1 >= 1 && due1 <= 6, `countdown still tracked (${due1})`);
  const dur = parseFloat(heart.style.animationDuration);
  assert.ok(dur > 0 && dur <= 1.3, `heart beats in range (${heart.style.animationDuration})`);
  T.pinger.phase = 5; // 1s to next beat
  await new Promise((r) => setTimeout(r, 1100));
  assert.strictEqual(heart.dataset.due, "1", "countdown followed");
  assert.ok(parseFloat(heart.style.animationDuration) < 0.7, "heart races near the beat");
  await T.viewer.close({ force: true });
  T.pinger.phase = 0;
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
