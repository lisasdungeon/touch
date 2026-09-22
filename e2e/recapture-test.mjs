/**
 * e2e/recapture-test.mjs — snapshot re-capture after disguise/polymorph:
 * API presence, registry + doc-flag refresh, label rename, un-identified
 * guard, Forget All re-register, and the hub row action end-to-end.
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
const { captureSignature, signatureSimilarity } = await import("../touch/scripts/memory.js");

const zone = await pwMod.createPathway(sampleScene, {
  a: { x: 0, y: 300 }, b: { x: 2000, y: 300 }, name: "Zone", elevation: 0,
});
const orc = sampleScene.tokens.get("tok-orc");
await orc.update({ x: 500, y: 100 });
await T.clearMemory();

// Explicit identity (recapture is a GM identity op), then a crossing for history
const id = await T.assignIdentity(orc, "trk.orc-recap", "Orc Brute");
await orc.update({ x: 500, y: 300 });
assert.strictEqual(T.lastTrackEvent.id, id);
const oldSig = T.trackGet(id).sig;

console.log("== Re-capture ==");
await checkAsync("API exists and returns the id + fresh sig", async () => {
  // The orc is now disguised: name, size, elevation all changed.
  await orc.update({ name: "Mysterious Stranger", width: 2, height: 2, elevation: 2 });
  const res = await T.recaptureSignature(orc);
  assert.strictEqual(res.id, id, "same track id");
  assert.deepStrictEqual(res.sig, captureSignature(orc), "sig is the new image");
  assert.strictEqual(res.sig.name, "mysterious stranger");
});

await checkAsync("the stored image is replaced; history continues", async () => {
  const track = T.trackGet(id);
  assert.strictEqual(track.sig.name, "mysterious stranger");
  assert.notStrictEqual(track.sig, oldSig);
  assert.ok(signatureSimilarity(captureSignature(orc), track.sig) === 1, "current object matches new image");
  assert.ok(track.points.length >= 1, "history preserved");
});

await checkAsync("old image no longer matches — re-capture was needed", async () => {
  // Simulate the disguise being detected pre-recapture: the new object vs
  // the OLD image would have forked a track. Post-recapture it continues.
  assert.ok(signatureSimilarity(captureSignature(orc), oldSig) < 1);
});

await checkAsync("crossings continue under the refreshed image", async () => {
  await orc.update({ x: 900, y: 300 });
  assert.strictEqual(T.lastTrackEvent.continued, true);
  assert.strictEqual(T.lastTrackEvent.matched, true);
  assert.strictEqual(T.lastTrackEvent.id, id);
});

await checkAsync("optional label rename rides along", async () => {
  await T.recaptureSignature(orc, "The Disguised Orc");
  assert.strictEqual(T.trackGet(id).label, "The Disguised Orc");
});

await checkAsync("unidentified objects are refused", async () => {
  const stray = sampleScene.tokens.get("tok-hidden");
  const res = await T.recaptureSignature(stray);
  assert.strictEqual(res.id, null, "nothing to re-capture");
});

await checkAsync("re-capture re-registers a wiped track (Forget All)", async () => {
  await T.clearMemory();
  const res = await T.recaptureSignature(orc);
  assert.strictEqual(res.id, id, "same id re-registered");
  assert.ok(T.trackGet(id), "record alive again");
  assert.ok(T.trackGet(id).sig, "fresh image stored");
});

console.log("== Hub action ==");
await checkAsync("identified rows expose the re-capture action and it works", async () => {
  await T.openHub();
  const row = T.hub.element.querySelector(`[data-id="token.${orc.id}"]`);
  assert.ok(row, "orc row rendered");
  const btn = row.querySelector('[data-action="identityRecapture"]');
  assert.ok(btn, "re-capture button present on identified row");
  btn.click();
  for (let i = 0; i < 20 && !T.hub.rendered; i++) await new Promise((r) => setTimeout(r, 10));
  // The orc's track now carries the CURRENT image after the click re-capture.
  assert.ok(signatureSimilarity(captureSignature(orc), T.trackGet(id).sig) === 1);
});

await checkAsync("unidentified rows have no re-capture button", async () => {
  // tok-balcony is visible but has never crossed a zone: no identity yet.
  const row = T.hub.element.querySelector('[data-id="token.tok-balcony"]');
  assert.ok(row, "untracked-but-visible row rendered");
  assert.strictEqual(row.querySelector('[data-action="identityRecapture"]'), null);
});

// Cleanup
await pwMod.removePathway(sampleScene, zone.id);
await T.clearMemory();
await T.hub?.close();

// ------------------------------------------------------------------ summary
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const [, name, err] of failed) console.log(`  - ${name}: ${err.message}`);
  process.exit(1);
}
