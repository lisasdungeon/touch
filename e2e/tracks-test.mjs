/**
 * e2e/tracks-test.mjs — track continuity: a token crossing a zone gets a
 * persistent track flag; later crossings continue the same track across
 * zones; memory cells link to the track; payload passthrough; persistence.
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
// Load memory/track registries explicitly (stand-in for the canvasReady hook,
// which we don't dispatch here so the GM pinger clock stays off).
T.memory.load(sampleScene);
T.tracks.load(sampleScene);
const pwMod = await import("../touch/scripts/pathways.js");

// A token to drag across zones.
const orc = sampleScene.tokens.get("tok-orc");
// Two pathways forming two zones along the orc's likely path.
const zoneA = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "Zone A", elevation: 0,
});
const zoneB = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 600 }, b: { x: 2000, y: 600 }, name: "Zone B", elevation: 0,
});
// Put the orc north of zone A.
await orc.update({ x: 500, y: 100 });

console.log("== Track assignment ==");
await checkAsync("first crossing stamps a new track flag", async () => {
  await T.clearMemory();
  assert.strictEqual(T.trackOf(orc), null, "no track before crossing");
  await orc.update({ x: 500, y: 300 }); // onto Zone A
  const id = T.trackOf(orc);
  assert.ok(id && id.startsWith("trk."), `track stamped (${id})`);
  const track = T.trackGet(id);
  assert.ok(track, "track registered");
  assert.strictEqual(track.label, "Orc Brute");
  assert.strictEqual(track.points.length, 1, "one fix recorded");
  assert.strictEqual(T.lastTrackEvent.continued, false, "marked as new event");
});

await checkAsync("moving within/past the zone continues the same track", async () => {
  await orc.update({ x: 700, y: 310 }); // still on Zone A
  const id2 = T.trackOf(orc);
  const track = T.trackGet(id2);
  assert.strictEqual(track.points.length, 2, "second fix on same track");
  assert.strictEqual(T.lastTrackEvent.continued, true, "continuing event");
});

await checkAsync("second zone continues the track — not a new event", async () => {
  const idBefore = T.trackOf(orc);
  await orc.update({ x: 900, y: 600 }); // onto Zone B
  const idAfter = T.trackOf(orc);
  assert.strictEqual(idAfter, idBefore, "same track id across zones");
  const track = T.trackGet(idAfter);
  assert.strictEqual(track.points.length, 3);
  assert.ok(track.cells.length >= 2, "multiple cells linked");
  assert.strictEqual(T.lastTrackEvent.continued, true, "continuing, not new");
});

await checkAsync("a second token gets its own track", async () => {
  const hero = sampleScene.tokens.get("tok-hero");
  await hero.update({ x: 400, y: 300 });
  const heroTrack = T.trackOf(hero);
  const orcTrack = T.trackOf(orc);
  assert.ok(heroTrack && heroTrack !== orcTrack, "distinct tracks per token");
});

console.log("== Memory & payload linkage ==");
await checkAsync("memory cells link the track id", async () => {
  const trackId = T.trackOf(orc);
  const track = T.trackGet(trackId);
  const cell = T.memoryAt(track.points[0].x, track.points[0].y, 0);
  assert.ok(cell, "cell remembered");
  assert.ok(cell.tracks?.includes(trackId), `cell linked to track (${cell.tracks})`);
  assert.strictEqual(cell.lastTrackId, trackId);
});

await checkAsync("trace payloads carry trackId + continued flag", async () => {
  game.socket.outbox.length = 0;
  await orc.update({ x: 1100, y: 600 });
  const batch = game.socket.outbox.filter((m) => m.payload?.pings?.some((p) => p.trace));
  assert.ok(batch.length >= 1, "trace broadcast sent");
  const ping = batch.at(-1).payload.pings.find((p) => p.trace);
  assert.strictEqual(ping.trackId, T.trackOf(orc));
  assert.strictEqual(ping.trackContinued, true);
});

await checkAsync("track registry persists to the scene flag and reloads", async () => {
  const id = T.trackOf(orc);
  T.memory._dirty = true; // bypass debounce for a synchronous write
  await T.memory.flush();
  const raw = sampleScene.getFlag("touch", "memory");
  assert.ok(raw?.tracks?.[id], "track in flag");
  // Fresh registry reloads it
  T.tracks.load(sampleScene);
  const reloaded = T.trackGet(id);
  assert.ok(reloaded, "track survives reload");
  assert.strictEqual(reloaded.points.length >= 3, true);
  assert.strictEqual(T.trackOf(orc), id, "doc flag still points at it");
});

await checkAsync("hub shows track chips", async () => {
  await T.openHub();
  const chips = [...T.hub.element.querySelectorAll(".touch-track-chip")];
  assert.ok(chips.length >= 2, `track chips rendered (${chips.length})`);
  assert.ok(chips.some((c) => c.textContent.includes("Orc")));
  await T.hub.close({ force: true });
});

await checkAsync("clearMemory wipes tracks and unmarks nothing on docs", async () => {
  const idBefore = T.trackOf(orc);
  await T.clearMemory();
  assert.strictEqual(T.memoryMap().length, 0);
  assert.strictEqual(T.trackList().length, 0);
  assert.strictEqual(T.trackOf(orc), idBefore, "doc flag persists (identity flag)");
});

// Cleanup: remove zones
await pwMod.removePathway(sampleScene, zoneA.id);
await pwMod.removePathway(sampleScene, zoneB.id);
await T.clearMemory();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
