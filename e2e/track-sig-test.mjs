/**
 * e2e/track-sig-test.mjs — snapshot-tied tracks: signature capture and
 * similarity, match-continue flow, flag-loss re-identification, mismatch
 * rejection (genuinely new object), tolerance setting, persistence of sig.
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
const { captureSignature, signatureSimilarity } = await import("../touch/scripts/memory.js");
const pwMod = await import("../touch/scripts/pathways.js");

const zone = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "Zone", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
const hero = sampleScene.tokens.get("tok-hero");
await orc.update({ x: 500, y: 100 });
await T.clearMemory();

console.log("== Signature core ==");
await checkAsync("captureSignature captures identity, not position", async () => {
  const s1 = captureSignature(orc);
  assert.strictEqual(s1.name, "orc brute");
  assert.ok(s1.w > 0 && s1.h > 0);
  assert.ok(!("x" in s1) && !("y" in s1), "no position in the image");
  // Identical on recapture
  const s2 = captureSignature(orc);
  assert.strictEqual(signatureSimilarity(s1, s2), 1);
});

await checkAsync("similarity: actor/texture short-circuit, drift degrades", async () => {
  const a = { name: "goblin", w: 1, h: 1, disp: -1, elev: 0 };
  const same = { name: "goblin", w: 1, h: 1, disp: -1, elev: 0 };
  assert.strictEqual(signatureSimilarity(a, same), 1);
  // Same actor → match despite changed name/size
  const actorA = { ...a, actor: "act-1" };
  const actorB = { name: "renamed", w: 4, h: 4, disp: 0, elev: 3, actor: "act-1" };
  assert.strictEqual(signatureSimilarity(actorA, actorB), 1);
  // Same texture also short-circuits
  const texA = { ...a, tex: "img/goblin.webp" };
  const texB = { name: "other", w: 2, h: 2, disp: 0, elev: 0, tex: "img/goblin.webp" };
  assert.strictEqual(signatureSimilarity(texA, texB), 1);
  // Drift lowers but does not kill similarity
  const drifted = { name: "goblin", w: 1, h: 1, disp: -1, elev: 2 };
  const s = signatureSimilarity(a, drifted);
  assert.ok(s > 0.6 && s < 1, `partial similarity (${s.toFixed(2)})`);
  // Total mismatch
  assert.ok(signatureSimilarity(a, { name: "dragon", w: 4, h: 4, disp: 1, elev: 0 }) < 0.3);
});

console.log("== Snapshot-tied tracks ==");
await checkAsync("first crossing starts a track tied to the snapshot", async () => {
  await orc.update({ x: 500, y: 300 }); // onto the zone
  const id = T.lastTrackEvent.id;
  const track = T.trackGet(id);
  assert.ok(track.sig, "snapshot stored on track");
  assert.strictEqual(track.sig.name, "orc brute");
  assert.strictEqual(T.lastTrackEvent.continued, false);
  assert.strictEqual(T.lastTrackEvent.matched, false);
  // Observe must not mint authority-shaped flags
  assert.strictEqual(T.trackOf(orc), null, "no trackId stamp on observe");
  assert.strictEqual(orc.getFlag("touch", "trackSig"), undefined, "no trackSig stamp on observe");
});

await checkAsync("same object crossing again: matches image, continues path", async () => {
  const idBefore = T.lastTrackEvent.id;
  await orc.update({ x: 900, y: 300 }); // still crossing the zone
  assert.strictEqual(T.lastTrackEvent.id, idBefore);
  assert.strictEqual(T.lastTrackEvent.continued, true);
  assert.strictEqual(T.lastTrackEvent.matched, true, "verified against the image");
  assert.ok(T.lastTrackEvent.similarity >= 0.75);
  assert.ok(T.trackGet(idBefore).matches >= 1, "match counter incremented");
});

await checkAsync("flagless object re-identified by snapshot resumes the track", async () => {
  const idBefore = T.lastTrackEvent.id;
  // Observe never stamped; strip any residual flags and cross again.
  if (orc.flags.touch) orc.flags.touch.trackId = null;
  await orc.update({ x: 1300, y: 300 });
  assert.strictEqual(T.lastTrackEvent.id, idBefore, "re-identified via snapshot");
  assert.strictEqual(T.lastTrackEvent.matched, true, "matched against known track");
  assert.strictEqual(T.lastTrackEvent.continued, true, "path continues, no new object");
  assert.ok(T.trackGet(idBefore).points.length >= 3);
  assert.strictEqual(T.trackOf(orc), null, "re-id via observe still does not stamp");
});

await checkAsync("mismatched object: genuinely new object, new track", async () => {
  const orcTrack = T.lastTrackEvent.id;
  // A different creature (different name/size/disposition) crosses
  await hero.update({ x: 700, y: 300 });
  const heroTrack = T.lastTrackEvent.id;
  assert.notStrictEqual(heroTrack, orcTrack, "separate track");
  assert.strictEqual(T.lastTrackEvent.continued, false, "logged as a new object");
  assert.strictEqual(T.trackGet(heroTrack).sig.name, "hero");
});

await checkAsync("tolerance setting gates strict vs loose matching", async () => {
  const prev = game.settings.get("touch", "trackMatchTolerance");
  const idBefore = T.lastTrackEvent.id;
  // Strict: elevation drift alone must break the match → a new object.
  await game.settings.set("touch", "trackMatchTolerance", 0);
  await hero.update({ elevation: 1, x: 1100, y: 300 });
  let res = T.lastTrackEvent;
  assert.strictEqual(res.continued, false, "strict tolerance rejects drifted snapshot");
  assert.strictEqual(res.matched, false);
  // Loose: the same drift continues the track once tolerance is restored.
  await game.settings.set("touch", "trackMatchTolerance", prev ?? 0.25);
  await hero.update({ elevation: 2, x: 1300, y: 300 });
  res = T.lastTrackEvent;
  assert.strictEqual(res.continued, true, "loose tolerance accepts drifted snapshot");
  assert.strictEqual(res.matched, true);
});

await checkAsync("snapshot survives persistence round-trip", async () => {
  // Re-observe orc so lastTrackEvent is the orc session track again.
  await orc.update({ x: 1500, y: 300 });
  const id = T.lastTrackEvent.id;
  T.memory.load(sampleScene); // bind write target + hydrate cells (registry untouched)
  T.memory._dirty = true;
  await T.memory.flush(); // registry is the source of truth → write flag
  T.tracks.load(sampleScene); // then re-hydrate the registry from the flag
  const reloaded = T.trackGet(id);
  assert.ok(reloaded.sig?.name === "orc brute", "image persisted with the track");
  assert.ok(reloaded.matches >= 1, "match count persisted");
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
