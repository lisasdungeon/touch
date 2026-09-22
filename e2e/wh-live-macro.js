/**
 * e2e/wh-live-macro.js — LIVE Wall Height verification macro (run inside Foundry).
 *
 * Paste this into a Foundry macro (or a script in the hotbar) in a world with
 * the Touch and Wall Height modules enabled, and run it as GM. It builds a
 * test wall, drives it through Touch's real API, and logs how Wall Height
 * reacts — including the vision sweep check at two elevations.
 *
 * Everything it creates is cleaned up at the end.
 */
(async () => {
  const LOG = (...a) => console.log("%c[Touch/WH-VERIFY]", "color:#5eead4;font-weight:bold", ...a);
  const scene = canvas.scene;
  if (!scene) return ui.notifications.error("No active scene.");
  if (!game.modules.get("wall-height")?.active) return ui.notifications.error("Wall Height is not enabled.");
  if (!game.modules.get("touch")?.active) return ui.notifications.error("Touch is not enabled.");

  // Wall Height only filters vision when the scene's advancedVision flag is on
  // (it defaults to true, but make it explicit for the test).
  if (scene.getFlag("wall-height", "advancedVision") !== true) {
    await scene.setFlag("wall-height", "advancedVision", true);
    LOG("enabled scene flag wall-height.advancedVision");
  }

  const report = [];

  // ------------------------------------------------ 1. create a test wall
  const grid = scene.grid.size;
  const [wall] = await scene.createEmbeddedDocuments("Wall", [{
    c: [grid * 4, grid * 4, grid * 4, grid * 10],
    s: CONST.WALL_SENSE_TYPES.NORMAL,
    flags: { touch: { sonar: { intensity: 50, muted: false } } },
  }]);
  report.push(`wall created: ${wall.id} at x=${grid * 4}`);

  // --------------------------------- 2. bounds before (should be infinite)
  const before = WallHeight.getWallBounds(wall);
  report.push(`bounds before: top=${before.top} bottom=${before.bottom} (expect ±Infinity)`);

  // ----------------------- 3. write extents through Touch's real GM-Hub path
  // This is exactly what the hub's "Wall H" column does on input.
  await window.touch.setEmitterWallHeight(`wall.${wall.id}`, grid, "bottom"); // 1 square
  await window.touch.setEmitterWallHeight(`wall.${wall.id}`, grid * 3, "top"); // 3 squares

  const after = WallHeight.getWallBounds(wall);
  report.push(`bounds after Touch write: top=${after.top} bottom=${after.bottom}`);
  if (after.top !== grid * 3 || after.bottom !== grid)
    ui.notifications.error("Wall Height did not pick up the Touch write!");

  // ------------------------- 4. observe Wall Height's visible reaction:
  // drawWallRange adds a PreciseText named "wall-height-text" to the wall line
  // showing "top / bottom" — refresh it and look for the label.
  const wallObj = wall.object ?? canvas.walls.get(wall.id);
  wallObj.refresh();
  await new Promise((r) => setTimeout(r, 50));
  const label = wallObj.line?.children?.find?.((c) => c.name === "wall-height-text");
  report.push(label
    ? `canvas label reads: "${label.text}" (expect "${after.top} / ${after.bottom}")`
    : "no wall-height-text label — enable Wall Height's 'Show Wall Height Text' setting");

  // ------------------------- 5. live sweep check: vision through the wall.
  // Token EYE at elevation 0 (below bottom=grid) vs elevation 2*grid (inside
  // [grid, 3*grid]). Only the second should see across the wall.
  const [docType] = [canvas.scene.documentName ?? "Scene"];
  const protos = game.system.documentTypes.Token ?? [];
  const createToken = async (name, x, y, elevation) => {
    const [td] = await scene.createEmbeddedDocuments("Token", [{
      name, x, y, elevation, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      sight: { enabled: true, range: grid * 20 },
    }]);
    return td;
  };
  const eyeLow = await createToken("WH-EYE-LOW", grid * 2, grid * 7, 0);
  const eyeHigh = await createToken("WH-EYE-HIGH", grid * 2, grid * 7, grid * 2);
  await new Promise((r) => setTimeout(r, 100));

  const farSide = { x: grid * 6, y: grid * 7 };
  const seesThrough = async (token) => {
    WallHeight.updateCurrentTokenElevation?.(); // tell WH which elevation is viewing
    const v = canvas.visibility.testVisibility(farSide, { object: token.object });
    return Boolean(v);
  };
  // Only one controlled token at a time influences WH's current elevation;
  // release everything, control each eye in turn.
  canvas.tokens.releaseAll();
  const lowToken = canvas.tokens.get(eyeLow.id), highToken = canvas.tokens.get(eyeHigh.id);
  lowToken.control();
  await new Promise((r) => setTimeout(r, 100));
  const lowSees = await seesThrough(lowToken);
  highToken.control();
  await new Promise((r) => setTimeout(r, 100));
  const highSees = await seesThrough(highToken);
  report.push(`elev 0 (below extent) sees across wall: ${lowSees} (expect false)`);
  report.push(`elev ${grid * 2} (inside extent) sees across wall: ${highSees} (expect true)`);

  // ------------------------------------------------ 6. Touch sonar sanity
  // One-off ping from the wall should now carry its extent and land on floor 1
  // in the Touch viewer (open it first if needed).
  await window.touch.openViewer?.();
  window.touch.pinger.pulse({ broadcast: false, local: true });
  const frame = window.touch.viewer?.frames?.get("front")?.get(`wall.${wall.id}`);
  report.push(frame
    ? `viewer frame: storey=${frame.storey} floor=${frame.floor} levels=${JSON.stringify(frame.levels)}`
    : "viewer frame missing — check the Sonar Viewer");

  // ---------------------------------------------------------- 7. cleanup
  await scene.deleteEmbeddedDocuments("Token", [eyeLow.id, eyeHigh.id]);
  await scene.deleteEmbeddedDocuments("Wall", [wall.id]);
  report.push("cleanup done (test wall + eye tokens deleted)");

  // ------------------------------------------------------------ summary
  console.log("%c[Touch/WH-VERIFY] REPORT", "color:#5eead4;font-weight:bold");
  for (const line of report) console.log("  •", line);
  ui.notifications.info("Wall Height verification complete — see console (F12).");
})();
