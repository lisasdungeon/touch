/** Every player-visible token emits addressed pings into the live 4D room. */
import "./foundry-mock.mjs";
import assert from "node:assert";
import { game, sampleScene } from "./foundry-mock.mjs";

const results = [];
function check(name, fn) {
  try {
    fn();
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
const T = window.touch;
const visibleTokenIds = [...sampleScene.tokens]
  .filter((token) => token.object?.visible)
  .map((token) => `token.${token.id}`)
  .sort();

console.log("== Token sonar emission ==");
check("a full pulse includes every player-visible token", () => {
  game.socket.outbox.length = 0;
  T.pinger.pulse({ broadcast: true, local: false });
  const message = game.socket.outbox.at(-1)?.payload;
  const tokenIds = message.pings.filter((ping) => ping.kind === "token").map((ping) => ping.id).sort();
  assert.deepStrictEqual(tokenIds, visibleTokenIds);
  assert.ok(!tokenIds.includes("token.tok-hidden"), "GM-hidden tokens must not leak to players");
});

check("every token ping carries its zone, level, and static cube address", () => {
  const pings = game.socket.outbox.at(-1).payload.pings.filter((ping) => ping.kind === "token");
  assert.ok(pings.length > 0);
  for (const ping of pings) {
    assert.match(ping.address.zone, /^\d+[A-Z]+$/);
    assert.ok(ping.address.level >= 1 && ping.address.level <= 10);
    assert.ok(ping.address.cubeTier >= 1 && ping.address.cubeTier <= 20);
    assert.match(ping.address.cube, /^\d+[A-Z]+-L\d{2}-T\d{2}$/);
  }
  assert.deepStrictEqual(pings.find((ping) => ping.id === "token.tok-hero").address, {
    zone: "6F", row: 6, column: "F", level: 1, levelElevation: 0,
    cubeTier: 1, cube: "6F-L01-T01",
  });
});

check("the automatic global cadence schedules every visible token", () => {
  const interval = Number(game.settings.get("touch", "pingInterval")) || 6;
  T.pinger.phase = interval;
  const due = T.pinger.tick();
  for (const id of visibleTokenIds) assert.ok(due.includes(id), `${id} not scheduled`);
});

T.pinger.stop();
const failed = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
