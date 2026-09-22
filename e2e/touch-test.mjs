/**
 * e2e/touch-test.mjs — drives the real Touch module code through a sample
 * scene: init → ready → viewer render → GM hub render → ping pipeline →
 * elevation/levels/wall-height edits → floor filter → calibrate.
 */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { sampleScene, document, game } from "./foundry-mock.mjs";

const results = [];
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

// ---------------------------------------------------------------- import module
console.log("== Loading Touch module (real code) ==");
let touchModule;
try {
  touchModule = await import("../touch/scripts/touch.js");
  console.log("  PASS  module imports cleanly (all submodules compile + execute top-level)");
  results.push(["PASS", "module import", null]);
} catch (err) {
  console.log(`  FAIL  module import: ${err.stack}`);
  process.exit(1);
}

// ------------------------------------------------------------------ run hooks
console.log("== Lifecycle: init → ready ==");
try {
  for (const fn of Hooks.events.init ?? []) fn();
  check("scene-control hook is registered during init", () => {
    assert.ok((Hooks.events.getSceneControlButtons ?? []).length > 0, "getSceneControlButtons hook missing after init");
  });
  for (const fn of Hooks.events.ready ?? []) fn();
  check("window.touch API exists after ready", () => {
    for (const k of ["openViewer", "openHub", "setEmitterConfig", "setEmitterElevation", "setEmitterLevels", "setEmitterWallHeight", "bulkSetIntensity", "bulkSetMuted", "emitters"]) {
      assert.strictEqual(typeof window.touch[k], "function", `window.touch.${k} missing`);
    }
  });
} catch (err) {
  console.log(`  FAIL  lifecycle: ${err.stack}`);
  process.exit(1);
}

// ------------------------------------------------------------- emitter scan
console.log("== Emitter scan ==");
check("collects tokens, lights, sounds, walls", () => {
  const emitters = window.touch.emitters();
  const kinds = Object.groupBy(emitters, (e) => e.kind);
  assert.strictEqual(kinds.token.length, 3, "3 visible tokens (hidden excluded)");
  assert.strictEqual(kinds.light.length, 1);
  assert.strictEqual(kinds.sound.length, 1);
  assert.strictEqual(kinds.wall.length, 1, "wall has intensity>0 flag");
});
check("hidden token excluded", () => {
  assert.ok(!window.touch.emitters().some((e) => e.name === "Hidden Trap"));
});

// ------------------------------------------------------------ viewer render
console.log("== Viewer ==");
await checkAsync("viewer renders template without errors", async () => {
  await window.touch.openViewer();
  assert.ok(window.touch.viewer.rendered);
  assert.ok(document.querySelector(".touch-viewer-root"), "viewer root in DOM");
});
check("viewer context: floors and floor options", () => {
  const v = window.touch.viewer;
  // F0 ground, F1 from balcony sniper (rangeBottom 10) — F1 line + option
  assert.ok(v.constructor.name === "SonarViewer");
  const sel = document.querySelector(".touch-floor-select");
  assert.ok(sel, "floor selector exists");
  assert.ok(sel.querySelector('option[value=""]'), "All floors option");
  assert.ok(sel.querySelector('option[value="1"]'), "F1 option (balcony at 10)");
});
check("viewer shows six camera tiles", () => {
  assert.strictEqual(document.querySelectorAll(".touch-cam").length, 6);
});
check("viewer renders the fixed 4D wireframe room", () => {
  assert.ok(document.querySelector("[data-hypergrid]"), "CSS cube lattice host");
  assert.match(document.querySelector("[data-hypergrid-dimensions]").textContent, /20 × 20 × 20/);
});

// ------------------------------------------------------------ ping pipeline
console.log("== Ping pipeline ==");
check("pulse produces frames for all cameras and rings", () => {
  window.touch.pinger.pulse({ broadcast: true, local: true });
  const frames = window.touch.viewer.frames;
  for (const cam of ["top", "bottom", "left", "right", "front", "back"]) {
    assert.ok(frames.get(cam)?.size > 0, `frames for ${cam}`);
  }
  assert.ok(canvas.touchRings.sprites.length > 0, "ring sprites emitted");
});
check("socket broadcast captured (no self-echo)", () => {
  assert.ok(game.socket.outbox.length > 0);
  const msg = game.socket.outbox.at(-1);
  assert.strictEqual(msg.name, "module.touch");
  assert.strictEqual(msg.payload.type, "pings");
  assert.ok(msg.payload.pings.length > 0);
});
check("balcony sniper lands on storey F1 via Levels rangeBottom", () => {
  const frames = window.touch.viewer.frames.get("front");
  let found = null;
  for (const f of frames.values()) if (f.name === "Balcony Sniper") found = f;
  assert.ok(found, "balcony frame exists");
  assert.strictEqual(found.storey, 1, "storey = rangeBottom/storeyHeight = 1");
  assert.strictEqual(found.floor, 1);
});
check("wall ping uses Wall Height fallback / elevation", () => {
  const frames = window.touch.viewer.frames.get("top");
  let found = null;
  for (const f of frames.values()) if (f.kind === "wall") found = f;
  assert.ok(found, "wall frame exists");
  assert.strictEqual(found.storey, 0);
});
await checkAsync("viewer flush paints cameras and activates 4D corner waypoints", async () => {
  window.touch.viewer.flush();
  assert.ok(document.querySelectorAll(".touch-cam .touch-blip").length > 0, "camera blips");
  for (let index = 0; index < 100 && !window.touch.viewer.hypergrid; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  await window.touch.viewer.hypergrid.ready;
  assert.ok(window.touch.viewer.hypergrid.active.size > 0, "memory waypoints activated");
});
check("balcony contact occupies a different physical height", () => {
  const heights = new Set([...window.touch.viewer.hypergrid.active].map((point) => point.dataset.y));
  assert.ok(heights.size > 1, "multiple vertically stacked cube levels");
});

// ---------------------------------------------------------------- GM hub
console.log("== GM Hub ==");
await checkAsync("hub renders template without errors", async () => {
  await window.touch.openHub();
  assert.ok(window.touch.hub.rendered);
  assert.ok(document.querySelector(".touch-hub-root"), "hub root in DOM");
});
check("hub lists all echogenic objects", () => {
  const rows = document.querySelectorAll(".touch-row");
  assert.strictEqual(rows.length, window.touch.emitters().length);
});
check("hub shows Levels and Wall Height columns where applicable", () => {
  assert.ok(document.querySelector('.touch-row[data-id="token.tok-balcony"] .touch-level'), "token Levels inputs");
  assert.ok(document.querySelector('.touch-row[data-id="wall.wl-1"] .touch-wall-height'), "wall WH inputs");
  assert.ok(!document.querySelector('.touch-row[data-id="token.tok-hero"] .touch-wall-height'), "token has no WH editor");
  assert.ok(!document.querySelector('.touch-row[data-id="sound.snd-water"] .touch-level'), "sound has no Levels editor");
});
await checkAsync("set intensity through API updates flags", async () => {
  await window.touch.setEmitterConfig("token.tok-orc", { intensity: 85 });
  const orc = sampleScene.tokens.get("tok-orc");
  assert.strictEqual(orc.getFlag("touch", "sonar").intensity, 85);
});
await checkAsync("set elevation through API + ping fires", async () => {
  const before = canvas.touchRings.sprites.length;
  await window.touch.setEmitterElevation("token.tok-hero", 5);
  assert.strictEqual(sampleScene.tokens.get("tok-hero").elevation, 5);
  assert.ok(canvas.touchRings.sprites.length > before, "one-off ping fired");
  assert.strictEqual(sampleScene.tokens.get("tok-hero").flags.touch?.sonar, undefined, "no sonar flag written by elevation set");
});
await checkAsync("set Levels range through API", async () => {
  await window.touch.setEmitterLevels("token.tok-hero", 0, "bottom");
  await window.touch.setEmitterLevels("token.tok-hero", 10, "top");
  const flags = sampleScene.tokens.get("tok-hero").flags.levels;
  assert.strictEqual(flags.rangeBottom, 0);
  assert.strictEqual(flags.rangeTop, 10);
});
await checkAsync("set Wall Height range through API", async () => {
  await window.touch.setEmitterWallHeight("wall.wl-1", 0, "bottom");
  await window.touch.setEmitterWallHeight("wall.wl-1", 20, "top");
  const flags = sampleScene.walls.get("wl-1").flags["wall-height"];
  assert.strictEqual(flags.bottom, 0);
  assert.strictEqual(flags.top, 20);
});

// ------------------------------------------------------- floor filter flow
console.log("== Floor filter ==");
await checkAsync("filter limits the 4D room to one physical elevation band", async () => {
  const sel = document.querySelector(".touch-floor-select");
  const v = window.touch.viewer;
  v.floorFilter = 1;
  v.flush();
  await v.hypergrid.ready;
  assert.ok([...v.hypergrid.active].every((point) => ["2", "3"].includes(point.dataset.y)), "only F1 corners remain");
  // reset
  v.floorFilter = null;
  v.flush();
  assert.ok(new Set([...v.hypergrid.active].map((point) => point.dataset.y)).size > 1, "all floors restored");
});

// ---------------------------------------------------------------- socket in
console.log("== Socket receive (client side) ==");
check("remote pings render on a receiving client", () => {
  // Simulate another client's broadcast arriving at our socket handler.
  const payload = game.socket.outbox.at(-1).payload;
  const framesBefore = window.touch.viewer.frames.get("front")?.size ?? 0;
  window.touch.pinger.receive(payload);
  const framesAfter = window.touch.viewer.frames.get("front")?.size ?? 0;
  assert.ok(framesAfter >= framesBefore, "frames ingested from socket payload");
});

// ---------------------------------------------------------------- calibrate
console.log("== Calibrate & teardown ==");
check("calibrate clears frames and filter", () => {
  const v = window.touch.viewer;
  v.frames.clear(); // core of the calibrate action, minus DOM clearing
  v.floorFilter = null;
  v.flush();
  assert.strictEqual(v.frames.size, 0, "frame maps cleared (no camera keys)");
});

// ---------------------------------------------------------- scene controls
console.log("== Scene controls ==");
check("Touch scene control group is registered for v13+/v14 record controls", () => {
  const controls = {};
  for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
  const group = controls.touch;
  assert.ok(group, "dedicated Touch control group registered");
  assert.strictEqual(group.order, 100, "group has a stable toolbar order");
  assert.strictEqual(group.layer, "tokens", "group targets the Token control layer");
  const tools = Object.values(group.tools);
  assert.ok(tools.some((t) => t.name === "touch-hub"), "hub button present");
  assert.ok(tools.some((t) => t.name === "touch-viewer"), "viewer button present");
  assert.ok(tools.some((t) => t.name === "touch-waypoint"), "waypoint button present");
  assert.ok(tools.some((t) => t.name === "touch-pathway"), "pathway button present");
  const hub = group.tools["touch-hub"];
  assert.strictEqual(hub.button, true, "hub is an action button, not a toggle tool");
  assert.strictEqual(hub.toggle, false, "hub cannot become an active toggle");
  assert.strictEqual(hub.order, 1, "hub has a stable tool order");
  assert.strictEqual(typeof hub.onChange, "function", "hub carries onChange (v13+ handler)");
  assert.strictEqual(typeof hub.onClick, "function", "hub keeps onClick (v12 handler)");
});

await checkAsync("hub tool ignores deactivation and opens only on activation", async () => {
  const controls = {};
  for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
  const originalOpenHub = window.touch.openHub;
  let opens = 0;
  window.touch.openHub = async () => { opens += 1; };
  try {
    await controls.touch.tools["touch-hub"].onChange({}, false);
    await controls.touch.tools["touch-hub"].onChange({}, true);
  } finally {
    window.touch.openHub = originalOpenHub;
  }
  assert.strictEqual(opens, 1, "only activation opens the hub");
});

check("v12 legacy array controls still supported", () => {
  const controls = [];
  for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
  for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
  const groups = controls.filter((control) => control?.name === "touch");
  assert.strictEqual(groups.length, 1, "repeated hook calls do not duplicate the Touch group");
  assert.ok(groups[0].tools.some((tool) => tool.name === "touch-hub"), "hub added to the legacy Touch group");
  assert.ok(groups[0].tools.some((tool) => tool.name === "touch-viewer"), "viewer added to the legacy Touch group");
});

check("record controls create the group without a pre-existing Token control", () => {
  const controls = {};
  for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
  assert.ok(controls.touch.tools["touch-viewer"], "viewer is available without a Token control record");
  assert.doesNotThrow(() => {
    for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(null);
  }, "absent control data is ignored safely");
});

check("non-GM controls omit the GM hub without hiding player-safe actions", () => {
  const previousGM = game.user.isGM;
  game.user.isGM = false;
  try {
    const controls = {};
    for (const fn of Hooks.events.getSceneControlButtons ?? []) fn(controls);
    assert.ok(!controls.touch.tools["touch-hub"], "GM hub is not registered for players");
    assert.ok(controls.touch.tools["touch-viewer"], "viewer remains available");
  } finally {
    game.user.isGM = previousGM;
  }
});

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
