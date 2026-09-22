/**
 * e2e/pathways-test.mjs — sonar pathways: storage, sampling, pipeline
 * integration, layer draw/drag interaction, viewer rendering, and hub rows.
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
for (const fn of Hooks.events.canvasInit ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await setupCanvasLayers();
await window.touch.openViewer();
await window.touch.openHub();
const T = window.touch;

console.log("== Storage + sampling ==");
await checkAsync("create + deterministic sample points", async () => {
  const pwMod = await import("../touch/scripts/pathways.js");
  const pw = await pwMod.createPathway(sampleScene, {
    a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, spacing: 2, // 4 squares, 2u spacing
  });
  const pts = pwMod.samplePathway(pw, pw.spacing);
  assert.strictEqual(pts.length, 3); // 4 squares / 2u spacing -> endpoints + midpoint
  assert.deepStrictEqual(pts[0], { x: 0, y: 0 });
  assert.deepStrictEqual(pts[2], { x: 400, y: 0 });
  const mid = pts[1];
  assert.ok(Math.abs(mid.x - 200) <= 1 && mid.y === 0, "midpoint on the line");
  await pwMod.removePathway(sampleScene, pw.id);
});
await checkAsync("sample cap is enforced on very long lines", async () => {
  const pwMod = await import("../touch/scripts/pathways.js");
  const pw = await pwMod.createPathway(sampleScene, {
    a: { x: 0, y: 0 }, b: { x: 100000, y: 0 }, spacing: 1,
  });
  const pts = pwMod.samplePathway(pw, pw.spacing);
  assert.strictEqual(pts.length, pwMod.MAX_SAMPLES);
  assert.strictEqual(pts.length <= 64, true);
  await pwMod.removePathway(sampleScene, pw.id);
});

console.log("== Pipeline integration ==");
let pathwayId;
await checkAsync("pathway samples appear as independent emitters", async () => {
  const pwMod = await import("../touch/scripts/pathways.js");
  const pw = await pwMod.createPathway(sampleScene, {
    a: { x: 100, y: 100 }, b: { x: 100, y: 400 }, name: "Wall Line", config: { intensity: 55 }, spacing: 1,
  });
  pathwayId = pw.id;
  const list = T.emitters();
  const samples = list.filter((e) => e.kind === "pathway" && e.pathwayId === pw.id);
  assert.strictEqual(samples.length, 4); // 300 units = 3 squares -> 4 points at spacing 1
  assert.ok(samples.every((e) => e.config.intensity === 55));
  assert.ok(samples[0].id.startsWith(`${pw.id}#`), "compound ids");
});
await checkAsync("per-sample pings through emitMany land on every camera", async () => {
  const pwMod = await import("../touch/scripts/pathways.js");
  const pw = pwMod.getPathway(sampleScene, pathwayId);
  await canvas.touchPathways.pingPathway(pw);
  const frames = T.viewer.frames.get("front");
  const onLine = [...frames.values()].filter((f) => f.id.startsWith(`${pathwayId}#`));
  assert.strictEqual(onLine.length, 4);
  assert.ok(onLine.every((f) => f.kind === "pathway" && f.name === "Wall Line"));
});
await checkAsync("pathway config edits retarget every sample", async () => {
  await T.setPathwayConfig(pathwayId, { intensity: 80, tone: "low" });
  const pwMod = await import("../touch/scripts/pathways.js");
  assert.strictEqual(pwMod.getPathway(sampleScene, pathwayId).config.tone, "low");
  // per-sample API routes to the parent pathway
  await T.setEmitterConfig(`${pathwayId}#2`, { intensity: 33 });
  assert.strictEqual(pwMod.getPathway(sampleScene, pathwayId).config.intensity, 33);
  await T.setEmitterMode(`${pathwayId}#0`, "light");
  assert.strictEqual(pwMod.getPathway(sampleScene, pathwayId).config.mode, "light");
});

console.log("== Draw + reshape interaction ==");
await checkAsync("armed click-click creates a pathway and pings it", async () => {
  const captured = [];
  const orig = T.pinger.receive.bind(T.pinger);
  T.pinger.receive = (payload) => captured.push(payload);
  try {
    canvas.touchPathways.setArmed(true);
    await canvas.touchPathways.clickAt({ x: 600, y: 700 });
    await canvas.touchPathways.clickAt({ x: 900, y: 700 });
  } finally {
    T.pinger.receive = orig;
    canvas.touchPathways.setArmed(false);
  }
  const pwMod = await import("../touch/scripts/pathways.js");
  const created = pwMod.getPathways(sampleScene).find((p) => p.c[0] === 600 && p.c[1] === 700);
  assert.ok(created, "pathway stored from the two clicks");
  const linePings = captured.flatMap((p) => p.pings).filter((p) => p.id.startsWith(`${created.id}#`));
  assert.ok(linePings.length, "creation fires its pings");
  // Replay the captured payload (as a remote client would receive it).
  orig({ scene: sampleScene.id, settings: {}, pings: linePings });
  const frameIds = [...T.viewer.frames.get("front").values()].map((f) => f.id);
  assert.ok(frameIds.some((id) => id.startsWith(`${created.id}#`)), "viewer shows the line");
});
await checkAsync("unarmed clicks do not draw", async () => {
  const pwMod = await import("../touch/scripts/pathways.js");
  const before = pwMod.getPathways(sampleScene).length;
  await canvas.touchPathways.clickAt({ x: 10, y: 10 });
  assert.strictEqual(pwMod.getPathways(sampleScene).length, before);
});
await checkAsync("endpoint drag reshapes and re-pings", async () => {
  const pwMod = await import("../touch/scripts/pathways.js");
  const pw = pwMod.getPathway(sampleScene, pathwayId);
  const pings = [];
  const orig = T.pinger.receive.bind(T.pinger);
  T.pinger.receive = (payload) => pings.push(...payload.pings);
  try {
    // simulate a drag of endpoint 1 to a new position
    const layer = canvas.touchPathways;
    layer._drag = { id: pw.id, end: 1, offsetX: 0, offsetY: 0 };
    await layer.handleDragEnd?.({ global: { x: 100, y: 900 }, stopPropagation() {} }, pw.id, 1);
  } finally {
    T.pinger.receive = orig;
  }
  const moved = pwMod.getPathway(sampleScene, pathwayId);
  assert.strictEqual(moved.c[3], 900, "endpoint y updated");
  assert.ok(pings.length > 0, "reshaped pathway re-pings");
});

console.log("== Viewer + hub ==");
await checkAsync("viewer renders pathway blips + hub shows one row", async () => {
  T.viewer.flush();
  assert.ok(T.viewer.element.querySelector(".touch-room-blip"));
  await T.hub.render();
  const row = T.hub.element.querySelector(`.touch-row[data-pathway-id="${pathwayId}"]`);
  assert.ok(row, "single hub row per pathway");
  assert.ok(row.querySelector(".touch-pw-spacing"), "spacing input present");
  assert.ok(row.dataset.id.startsWith("pw."), "row keyed by pathway id");
});
await checkAsync("hub remove button deletes the pathway", async () => {
  const btn = T.hub.element.querySelector(`.touch-row[data-pathway-id="${pathwayId}"] [data-action="removePathway"]`);
  btn.click();
  await new Promise((r) => setTimeout(r, 50));
  const pwMod = await import("../touch/scripts/pathways.js");
  assert.strictEqual(pwMod.getPathway(sampleScene, pathwayId), null);
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
