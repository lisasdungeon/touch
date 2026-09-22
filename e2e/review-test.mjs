/**
 * e2e/review-test.mjs — full end-to-end review of the Touch module.
 * A) every touch.* API happy path + garbage-input matrix
 * B) module-off matrix (Levels / Wall Height disabled)
 * C) empty-scene and edge-case renders (hub, viewer, bands, floor selector)
 * D) socket edge cases (garbage, wrong scene, loopback)
 * E) every hub and viewer action fired through the real DOM
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

const T = window.touch;

console.log("== A. API happy paths + garbage matrix ==");
await checkAsync("viewer/hub open + close cycles", async () => {
  await T.openViewer();
  assert.ok(T.viewer.rendered);
  await T.openHub();
  assert.ok(T.hub.rendered);
  T.closeViewer();
  assert.strictEqual(T.viewer, null);
  await T.openViewer(); // reopen for later sections
});
await checkAsync("every setter accepts garbage without throwing", async () => {
  for (const id of ["", "garbage", "token.", "unknown.x", "token.ghost", null, undefined]) {
    await T.setEmitterConfig(id, { intensity: 5 });
    await T.setEmitterElevation(id, 5);
    await T.setEmitterMode(id, "sound");
    await T.setEmitterFacing(id, { angle: 90, fov: 90 });
    await T.setEmitterRate(id, 2, "low");
    await T.setEmitterWallHeight(id, 5, "bottom");
    await T.setEmitterLevels(id, 5, "top");
    await T.renameWaypoint(id, "x");
    await T.setWaypointElevation(id, 3);
    await T.removeWaypoint(id);
  }
  // out-of-range values clamp or reject, never throw
  await T.setEmitterConfig("token.tok-hero", { intensity: 500, angle: 999, fov: -3, rate: -2, tone: "bass", mode: "steam" });
  await T.setEmitterElevation("token.tok-hero", NaN);
  await T.setEmitterFacing("token.tok-hero", null);
  await T.setEmitterRate("token.tok-hero", "fast");
  await T.setEmitterWallHeight("token.tok-hero", 5, "side"); // wrong kind
  await T.setEmitterLevels("light.lit-torch", 5, "top");     // wrong kind
  await T.bulkSetIntensity(-40);
  await T.bulkSetMuted("yes");
  await T.setGlobalIntensity(-5);
  // each still alive; restore emitters the garbage pass muted/zeroed
  await T.setEmitterConfig("token.tok-hero", { intensity: 70 });
  await T.setEmitterConfig("wall.wl-1", { intensity: 40, muted: false });
  await T.setEmitterConfig("light.lit-torch", { intensity: 60, muted: false });
  assert.ok(T.pinger);
});
await checkAsync("kind mismatches are no-ops, not writes", async () => {
  await T.renameWaypoint("token.tok-hero", "nope"); // not a waypoint id
  assert.strictEqual(sampleScene.tokens.get("tok-hero").name, "Hero");
});
await checkAsync("socket garbage ignored, loopback no-ops, wrong scene filtered", async () => {
  game.socket.handlers.get("touch")?.({});                  // no type
  game.socket.handlers.get("touch")?.(null);                // null
  game.socket.handlers.get("touch")?.({ type: "bogus" });   // unknown type
  game.socket.handlers.get("touch")?.({ type: "requestSync", userId: "u1" }); // as GM
  const sceneId = canvas.scene.id;
  canvas.scene = { id: "other-scene" };
  T.pinger.receive({ scene: sceneId, pings: [{ id: "token.x", x: 0, y: 0, config: {} }], settings: {} });
  canvas.scene = sampleScene;
  game.socket.handlers.get("touch")?.({ type: "pings", scene: sceneId, pings: [], settings: {} });
});
await checkAsync("deleting the scene mid-flight is survivable", async () => {
  const scene = canvas.scene;
  canvas.scene = null;
  try {
    await T.bulkSetIntensity(50);
    T.pinger.pulse({});
    T.pinger.tick();
    T.emitters();
    await T.resetSettings();
  } finally {
    canvas.scene = scene;
  }
});

console.log("== B. module-off matrix ==");
await checkAsync("Levels/Wall Height off -> row + bulk editors warn, not write", async () => {
  for (const fn of Hooks.events.canvasInit ?? []) fn(); // (idempotent registration guard)
  const modMap = game.modules;
  game.modules = new Map([["levels", { active: false }], ["wall-height", { active: false }]]);
  try {
    let warned = 0;
    const orig = ui.notifications.warn;
    ui.notifications.warn = () => warned++;
    await T.setEmitterLevels("token.tok-hero", 5, "top");
    await T.setEmitterWallHeight("wall.wl-1", 5, "top");
    const n = await T.bulkSetVerticals({ module: "levels", kinds: ["token", "wall"], bottom: 0, top: 10 });
    ui.notifications.warn = orig;
    assert.strictEqual(n, 0);
    assert.ok(warned >= 3, `three warnings, got ${warned}`);
  } finally {
    game.modules = modMap;
  }
});
await checkAsync("hub + viewer render with modules off", async () => {
  await T.hub.render();
  await T.viewer.render();
  assert.ok(T.viewer.element.querySelector(".touch-room"));
});
await checkAsync("remote client path: non-GM hub blocked, receive works", async () => {
  const isGM = game.user.isGM;
  game.user = { ...game.user, isGM: false };
  try {
    let errored = 0;
    const orig = ui.notifications.error;
    ui.notifications.error = () => errored++;
    await window.touch.openHub();
    ui.notifications.error = orig;
    assert.strictEqual(errored, 1);
    window.touch.pinger.receive({
      scene: canvas.scene.id,
      pings: [{ id: "token.tok-hero", x: 500, y: 500, config: {}, born: Date.now() }],
      settings: {},
    });
    assert.ok(window.touch.viewer.frames.get("front")?.has("token.tok-hero"));
  } finally {
    game.user = { ...game.user, isGM: true };
  }
});

console.log("== C. empty-scene + edge renders ==");
await checkAsync("hub + viewer render on an empty scene", async () => {
  const realScene = canvas.scene;
  const empty = Object.create(sampleScene);
  empty.tokens = new Map(); empty.lights = new Map();
  empty.sounds = new Map(); empty.walls = new Map();
  empty.id = "scene-empty"; empty.name = "Empty"; empty.flags = {};
  canvas.scene = empty;
  try {
    await window.touch.hub.render();
    await window.touch.viewer.render();
    assert.ok(window.touch.hub.element.querySelector(".touch-empty"), "empty-state message");
  } finally {
    canvas.scene = realScene;
  }
  await window.touch.hub.render();
});
await checkAsync("floor selector filter survives a full flush", async () => {
  const viewer = window.touch.viewer;
  viewer.floorFilter = 1;
  viewer.flush();
  viewer.floorFilter = null;
  viewer.flush();
  assert.ok(viewer.element);
});
await checkAsync("viewer bands + floor lines coexist with zero pings", async () => {
  await window.touch.viewer.render();
  assert.ok(window.touch.viewer.element.querySelector(".touch-extent-bands"));
});

console.log("== E. every hub + viewer action through the DOM ==");
await checkAsync("viewer actions: scan, calibrate, pause", async () => {
  const v = window.touch.viewer;
  await v.render();
  for (const action of ["scan", "calibrate", "togglePause", "togglePause"]) {
    const btn = v.element.querySelector(`[data-action="${action}"]`);
    if (!btn) throw new Error(`missing button ${action}`);
    btn.click();
  }
  assert.ok(v.element);
});
await checkAsync("hub row + bulk + settings actions via DOM clicks", async () => {
  const hub = window.touch.hub;
  await hub.render();
  const fire = (sel, evt) => {
    const el = hub.element.querySelector(sel);
    if (!el) throw new Error(`missing element ${sel}`);
    el.dispatchEvent(evt);
  };
  const ev = () => new hub.element.ownerDocument.defaultView.Event("change", { bubbles: true });
  // per-row editors on the first row
  fire(".touch-row .touch-intensity", ev());
  fire(".touch-row .touch-elev", ev());
  fire(".touch-row .touch-mode", ev());
  fire(".touch-row .touch-angle", ev());
  fire(".touch-row .touch-fov", ev());
  fire(".touch-row .touch-rate", ev());
  fire(".touch-row .touch-tone", ev());
  const lvl = hub.element.querySelector(".touch-row .touch-level");
  if (lvl) lvl.dispatchEvent(ev());
  const wh = hub.element.querySelector(".touch-row .touch-wall-height");
  if (wh) wh.dispatchEvent(ev());
  // goto on first row
  // waypoint name + elevation + delete on any waypoint row
  const wpName = hub.element.querySelector(".touch-wp-name");
  if (wpName) wpName.dispatchEvent(ev());
  const wpElev = hub.element.querySelector(".touch-wp-elev");
  if (wpElev) wpElev.dispatchEvent(ev());
  const wpDel = hub.element.querySelector("[data-action=\"removeWaypoint\"]");
  if (wpDel) wpDel.click();
  // goto on first row (delegated like ApplicationV2's ActionsManager)
  // bulk: intensity, verticals (module select + kind boxes + bounds), mute/unmute, ping, reset
  hub.element.querySelector("[data-action=\"bulkIntensity\"]").click();
  hub.element.querySelector("[name=\"bulkVertsModule\"]").value = "wallHeight";
  const boxes = [...hub.element.querySelectorAll("input[name=\"bulkVertKind\"]")]
    .filter((b) => b.dataset.module === "wallHeight");
  for (const b of boxes) b.checked = true;
  hub.element.querySelector('[name="bulkVertsBottom"]').value = "0";
  hub.element.querySelector('[name="bulkVertsTop"]').value = "10";
  hub.element.querySelector("[data-action=\"bulkVerticalsApply\"]").click();
  await new Promise((r) => setTimeout(r, 50));
  hub.element.querySelector("[data-action=\"bulkVerticalsClear\"]").click();
  hub.element.querySelector("[data-action=\"muteAll\"]").click();
  hub.element.querySelector("[data-action=\"unmuteAll\"]").click();
  hub.element.querySelector("[data-action=\"pingAll\"]").click();
  hub.element.querySelector("[data-action=\"reset\"]").click();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(hub.rendered);
});
await checkAsync("bulk verticals through the real hub UI writes flags", async () => {
  const hub = window.touch.hub;
  await hub.render();
  hub.element.querySelector('[name="bulkVertsModule"]').value = "wallHeight";
  for (const b of hub.element.querySelectorAll("input[name=\"bulkVertKind\"]")) {
    b.checked = b.dataset.module === "wallHeight";
  }
  hub.element.querySelector('[name="bulkVertsBottom"]').value = "5";
  hub.element.querySelector('[name="bulkVertsTop"]').value = "15";
  hub.element.querySelector('[data-action="bulkVerticalsApply"]').click();
  await new Promise((r) => setTimeout(r, 50));
  const wall = sampleScene.walls.get("wl-1");
  assert.deepStrictEqual(wall.flags["wall-height"], { bottom: 5, top: 15 });
});

console.log("== F. regression coverage of earlier suites' core paths ==");
await checkAsync("await-ability + stability after everything above", async () => {
  await T.pinger.pulse({});
  await T.openViewer();
  await T.openHub();
  assert.ok(window.touch.viewer && window.touch.hub);
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
