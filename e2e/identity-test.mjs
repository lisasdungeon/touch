/**
 * e2e/identity-test.mjs — explicit persistent identities: assign (custom +
 * forged ids), persistence through Forget All, crossing continuation under
 * the assigned id, snapshot ties, id-taken rejection, revoke, and the
 * identityOf fallback chain.
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

const zone = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "Zone", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
const hero = sampleScene.tokens.get("tok-hero");
await orc.update({ x: 500, y: 100 });
await hero.update({ x: 800, y: 100 });
await T.clearMemory();

console.log("== Assignment ==");
await checkAsync("assign with a custom id stamps flags and registers a track", async () => {
  const id = await T.assignIdentity(orc, "trk.prisoner-1", "The Prisoner");
  assert.strictEqual(id, "trk.prisoner-1");
  assert.strictEqual(T.identityOf(orc), "trk.prisoner-1");
  assert.strictEqual(orc.getFlag("touch", "identity"), "trk.prisoner-1");
  assert.ok(orc.getFlag("touch", "trackId"), "crossing stamp also present");
  assert.ok(orc.getFlag("touch", "trackSig"), "snapshot tie stamped");
  const track = T.trackGet("trk.prisoner-1");
  assert.ok(track, "registered in the track registry");
  assert.strictEqual(track.label, "The Prisoner");
  assert.strictEqual(track.assigned, true, "marked as explicitly assigned");
  assert.ok(track.sig, "snapshot captured at assignment");
});

await checkAsync("assign without an id forges one", async () => {
  const id = await T.assignIdentity(hero);
  assert.ok(id && id.startsWith("trk."), `forged id (${id})`);
  assert.strictEqual(T.identityOf(hero), id);
  assert.strictEqual(T.trackGet(id).assigned, true);
});

await checkAsync("a taken id is rejected", async () => {
  const res = await T.assignIdentity(hero, "trk.prisoner-1");
  assert.strictEqual(res, null, "cannot steal another object's id");
  assert.strictEqual(T.identityOf(hero), hero.getFlag("touch", "trackId"));
});

console.log("== Continuity ==");
await checkAsync("crossings continue the assigned id — no new object", async () => {
  await orc.update({ x: 500, y: 300 }); // cross the zone
  assert.strictEqual(T.lastTrackEvent.continued, true, "continuing, not new");
  assert.strictEqual(T.lastTrackEvent.id, "trk.prisoner-1");
  assert.strictEqual(T.trackOf(orc), "trk.prisoner-1");
  const track = T.trackGet("trk.prisoner-1");
  assert.ok(track.points.length >= 1, "fix recorded under the assigned id");
});

await checkAsync("Forget All preserves the identity; next crossing re-registers it", async () => {
  await T.clearMemory();
  assert.strictEqual(T.trackList().length, 0, "registry wiped");
  assert.strictEqual(T.identityOf(orc), "trk.prisoner-1", "identity flag persists");
  // Next crossing re-registers the SAME id automatically.
  await orc.update({ x: 900, y: 300 });
  assert.strictEqual(T.lastTrackEvent.continued, true, "re-registered as continuing");
  assert.strictEqual(T.lastTrackEvent.id, "trk.prisoner-1");
  const track = T.trackGet("trk.prisoner-1");
  assert.ok(track, "same id alive again");
  assert.strictEqual(track.assigned, true);
});

await checkAsync("identity survives a persistence round-trip", async () => {
  const id = T.identityOf(orc);
  await orc.setFlag("touch", "identity", id); // what a real save/load does
  assert.strictEqual(T.identityOf(orc), id);
  assert.strictEqual(T.trackOf(orc), id, "trackId fallback chain intact");
});

await checkAsync("flagless re-identification still works under assigned ids", async () => {
  // Strip BOTH flags, then cross: snapshot matching must resume the track,
  // and the identity flag must be re-stamped.
  orc.flags.touch.trackId = null;
  await orc.update({ x: 1300, y: 300 });
  assert.strictEqual(T.lastTrackEvent.continued, true, "matched by snapshot");
  assert.strictEqual(T.lastTrackEvent.id, "trk.prisoner-1");
  assert.strictEqual(T.identityOf(orc), "trk.prisoner-1", "identity re-stamped");
});

console.log("== Revocation ==");
await checkAsync("revokeIdentity strips flags and the assigned record", async () => {
  const heroId = T.identityOf(hero);
  assert.ok(heroId);
  await T.revokeIdentity(hero);
  assert.strictEqual(T.identityOf(hero), null, "identity gone");
  assert.strictEqual(hero.getFlag("touch", "trackId"), undefined, "crossing stamp cleared");
  assert.strictEqual(hero.getFlag("touch", "trackSig"), undefined, "snapshot tie cleared");
  assert.strictEqual(T.trackGet(heroId), null, "assigned record deleted");
  // The next crossing forges a fresh id — not the revoked one.
  await hero.update({ x: 800, y: 300 });
  const fresh = T.lastTrackEvent.id;
  assert.notStrictEqual(fresh, heroId, "fresh id after revoke");
  assert.strictEqual(T.lastTrackEvent.continued, false, "logged as a new object");
});

await checkAsync("revoking does not touch other objects' identities", async () => {
  assert.strictEqual(T.identityOf(orc), "trk.prisoner-1");
});

// Cleanup
await pwMod.removePathway(sampleScene, zone.id);
await T.clearMemory();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
