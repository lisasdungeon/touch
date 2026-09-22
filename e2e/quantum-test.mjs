/**
 * e2e/quantum-test.mjs — Quantum Portal port: cube launchers (6 faces = 6
 * cameras) in viewer + hub, face-click camera presets, orbit nudges/tilt/
 * reset, drag binding, 3D stage class, blip lift variable, stylesheet
 * registration and reduced-motion guard.
 */
import "./foundry-mock.mjs";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
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

const MODULE_ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "touch");
const qcss = fs.readFileSync(path.join(MODULE_ROOT, "styles", "quantum.css"), "utf8");

console.log("== Stylesheet ==");
await checkAsync("quantum.css registered in module.json (styles + hotReload)", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(MODULE_ROOT, "module.json"), "utf8"));
  assert.ok(manifest.styles.includes("styles/quantum.css"), "in styles");
  assert.ok(manifest.flags.hotReload.includes("styles/quantum.css"), "in hotReload");
});

await checkAsync("quantum.css carries the cube, glow, shimmer, glass, reduced-motion", async () => {
  assert.match(qcss, /touch-quantum-cube/, "cube");
  assert.match(qcss, /transform-style: preserve-3d/, "preserve-3d");
  assert.match(qcss, /touch-quantum-glow/, "glow");
  assert.match(qcss, /touchQuantumShimmer/, "shimmer keyframes");
  assert.match(qcss, /backdrop-filter/, "glass window");
  assert.match(qcss, /prefers-reduced-motion/, "reduced-motion guard");
  // All six faces present
  for (const face of ["front", "back", "left", "right", "top", "bottom"]) {
    assert.match(qcss, new RegExp(`\\.touch-quantum-face\\.${face}`), `face ${face}`);
  }
});

console.log("== Cube launchers ==");
await checkAsync("viewer renders six faces mapping exactly to CAMERAS", async () => {
  await T.openViewer();
  const v = T.viewer;
  const { CAMERAS } = await import("../touch/scripts/constants.js");
  const faces = [...v.element.querySelectorAll(".touch-quantum-face")].map((f) => f.dataset.face);
  assert.deepStrictEqual(faces.sort(), CAMERAS.map((c) => c.id).sort());
});

await checkAsync("hub renders six faces and its cube opens the viewer", async () => {
  await T.openHub();
  const hubFaces = T.hub.element.querySelectorAll(".touch-quantum-face");
  assert.strictEqual(hubFaces.length, 6);
  // openViewer closes and re-renders the viewer async — wait for it.
  T.hub.element.querySelector('[data-action="openQuantum"]').click();
  for (let i = 0; i < 20 && !T.viewer?.rendered; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(T.viewer?.rendered, "viewer opened from hub");
});

console.log("== Quantum 3D stage ==");
await checkAsync("face click snaps the stage to the camera preset", async () => {
  const v = T.viewer;
  assert.ok(v?.rendered, "viewer is rendered (reopened by the hub cube)");
  const stage = v.element.querySelector("[data-room-space]");
  assert.ok(stage, "stage present");
  v.element.querySelector("[data-face=back]").click();
  assert.strictEqual(stage.classList.contains("touch-3d"), true, "3d class applied");
  assert.strictEqual(stage.style.getPropertyValue("--yaw"), "180");
  v.element.querySelector("[data-face=left]").click();
  assert.strictEqual(stage.style.getPropertyValue("--yaw"), "-90");
  v.element.querySelector("[data-face=front]").click();
  assert.strictEqual(stage.style.getPropertyValue("--yaw"), "0");
});

await checkAsync("orbit nudges, tilt clamps, reset restores", async () => {
  const v = T.viewer;
  const stage = v.element.querySelector("[data-room-space]");
  v.element.querySelector("[data-action=orbitLeft]").click();
  assert.strictEqual(stage.style.getPropertyValue("--yaw"), "-30");
  v.element.querySelector("[data-action=orbitRight]").click();
  v.element.querySelector("[data-action=orbitRight]").click();
  assert.strictEqual(stage.style.getPropertyValue("--yaw"), "30");
  v.element.querySelector("[data-action=orbitTilt]").click();
  const t = Number(stage.style.getPropertyValue("--tilt"));
  assert.ok(t > 0.35 && t <= 1, `tilt increased (${t})`);
  v.element.querySelector("[data-action=orbitReset]").click();
  assert.strictEqual(stage.style.getPropertyValue("--yaw"), "0");
  assert.strictEqual(stage.style.getPropertyValue("--tilt"), "0.35");
});

await checkAsync("drag-to-orbit is bound on the room", async () => {
  const v = T.viewer;
  const room = v.element.querySelector("[data-room]");
  assert.strictEqual(room.dataset.orbitBound, "true");
});

await checkAsync("room blips carry the 3D lift variable after a ping", async () => {
  const v = T.viewer;
  T.pinger.pulse({ broadcast: false });
  v.flush();
  const blips = v.element.querySelectorAll(".touch-room-blip");
  assert.ok(blips.length > 0, "blips exist");
  const lifted = [...blips].some((b) => b.style.getPropertyValue("--storey-z") !== "");
  assert.ok(lifted, "at least one blip has --storey-z");
});

// Cleanup
await T.viewer?.close();
await T.hub?.close();
await T.clearMemory();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
