/** Every player-visible token emits addressed pings into the live 4D room. */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { game, sampleScene } from "./foundry-mock.mjs";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    results.push(["PASS", name]);
  } catch (error) {
    console.log(`  FAIL  ${name}\n        ${error.message}`);
    results.push(["FAIL", name, error]);
  }
}

await import("../touch/scripts/touch.js");
for (const fn of Hooks.events.init ?? []) fn();
for (const fn of Hooks.events.ready ?? []) fn();
await setupCanvasLayers();
const T = window.touch;
const visibleTokenIds = [...sampleScene.tokens]
  .filter((token) => token.object?.visible)
  .map((token) => `token.${token.id}`)
  .sort();

console.log("== Token sonar emission ==");
await check("a full pulse includes every player-visible token", () => {
  game.socket.outbox.length = 0;
  T.pinger.pulse({ broadcast: true, local: false });
  const message = game.socket.outbox.at(-1)?.payload;
  const tokenIds = message.pings.filter((ping) => ping.kind === "token").map((ping) => ping.id).sort();
  assert.deepStrictEqual(tokenIds, visibleTokenIds);
  assert.ok(!tokenIds.includes("token.tok-hidden"), "GM-hidden tokens must not leak to players");
});

await check("every token ping carries its zone, level, and static cube address", () => {
  const pings = game.socket.outbox.at(-1).payload.pings.filter((ping) => ping.kind === "token");
  assert.ok(pings.length > 0);
  for (const ping of pings) {
    assert.match(ping.address.zone, /^\d+[A-Z]+$/);
    assert.ok(ping.address.level >= 1 && ping.address.level <= 10);
    assert.ok(ping.address.cubeTier >= 1 && ping.address.cubeTier <= 20);
    assert.match(ping.address.cube, /^\d+[A-Z]+-L\d{2}-T\d{2}$/);
  }
  assert.deepStrictEqual(pings.find((ping) => ping.id === "token.tok-hero").address, {
    zone: "3C", row: 3, column: "C", level: 1, levelElevation: 0,
    cubeTier: 1, cube: "3C-L01-T01",
  });
});

await check("token pings draw expanding rings on the live scene", async () => {
  canvas.touchRings.sprites.length = 0;
  T.pinger.pulse({ broadcast: false, local: true });
  await new Promise((resolve) => setTimeout(resolve, 24));
  assert.ok(canvas.touchRings.sprites.length >= visibleTokenIds.length);
  assert.ok(canvas.touchRings.sprites.some(({ g }) => g.instructions.some(([type]) => ["stroke", "lineStyle"].includes(type))));
  assert.strictEqual(canvas.touchRings.sprites[0].g.x, 500, "ring keeps the token's canvas X coordinate");
  assert.strictEqual(canvas.touchRings.sprites[0].g.y, 500, "ring keeps the token's canvas Y coordinate");
});

await check("the automatic global cadence schedules every visible token", () => {
  const interval = Number(game.settings.get("touch", "pingInterval")) || 6;
  T.pinger.phase = interval;
  const due = T.pinger.tick();
  for (const id of visibleTokenIds) assert.ok(due.includes(id), `${id} not scheduled`);
});

await check("crossing a room line emits one addressed contact ping", async () => {
  game.socket.outbox.length = 0;
  const hero = sampleScene.tokens.get("tok-hero");
  await hero.update({ x: 650, y: 550 });
  const ping = game.socket.outbox.at(-1)?.payload?.pings?.[0];
  assert.strictEqual(ping?.id, "token.tok-hero");
  assert.strictEqual(ping?.movement, true);
  assert.deepStrictEqual(ping?.latticeContact, {
    from: { x: 2, y: 0, z: 2, key: "2:0:2" },
    to: { x: 3, y: 0, z: 2, key: "3:0:2" },
  });
  assert.deepStrictEqual(ping?.address, {
    zone: "3D", row: 3, column: "D", level: 1, levelElevation: 0,
    cubeTier: 1, cube: "3D-L01-T01",
  });
});

await check("movement inside one cube stays silent until another line is touched", async () => {
  game.socket.outbox.length = 0;
  const hero = sampleScene.tokens.get("tok-hero");
  await hero.update({ x: 690, y: 590 });
  assert.strictEqual(game.socket.outbox.length, 0, "no cube boundary was crossed");
  await hero.update({ elevation: 10 });
  const ping = game.socket.outbox.at(-1)?.payload?.pings?.[0];
  assert.strictEqual(ping?.id, "token.tok-hero");
  assert.deepStrictEqual(ping?.latticeContact?.to, { x: 3, y: 1, z: 2, key: "3:1:2" });
});

await check("lights, sounds, walls, and moving tiles also trip the lattice", async () => {
  const cases = [
    [sampleScene.lights.get("lit-torch"), { x: 800 }, "light.lit-torch"],
    [sampleScene.sounds.get("snd-water"), { y: 700 }, "sound.snd-water"],
    [sampleScene.walls.get("wl-1"), { c: [900, 500, 1100, 500] }, "wall.wl-1"],
    [sampleScene.tiles.get("tile-platform"), { x: 1000 }, "tile.tile-platform"],
  ];
  for (const [doc, change, id] of cases) {
    game.socket.outbox.length = 0;
    await doc.update(change);
    const ping = game.socket.outbox.at(-1)?.payload?.pings?.[0];
    assert.strictEqual(ping?.id, id);
    assert.strictEqual(ping?.movement, true);
    assert.ok(ping?.address, `${id} movement must resolve inside the room`);
  }
});

await check("movement outside the room and non-positional updates stay silent", async () => {
  const hero = sampleScene.tokens.get("tok-hero");
  game.socket.outbox.length = 0;
  await hero.update({ name: "Hero Renamed" });
  assert.strictEqual(game.socket.outbox.length, 0);
  await hero.update({ x: -100 });
  assert.strictEqual(game.socket.outbox.length, 0);
});

T.pinger.stop();
const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
