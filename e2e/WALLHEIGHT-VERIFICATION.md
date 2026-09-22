# Wall Height Integration — Live Verification Log

**Date:** 2026-09-21 · **Wall Height verified version:** 4.1.2 (manifest verified against Foundry **v13**; no v14 badge — see caveats)

**Method:**
1. Source-level audit of wall-height 4.1.x (`const.js`, `utils.js`, `patches.js` from the GitHub `main` branch).
2. Reaction simulation driven through Touch's real API (`e2e/wallheight-test.mjs`, 8/8 checks).
3. An in-game macro for live confirmation in a real world (`e2e/wh-live-macro.js`).

---

## 1. Confirmed flag schema (from Wall Height's own source)

`scripts/const.js`:

```js
export const MODULE_SCOPE = "wall-height";
export const TOP_KEY = "top";
export const BOTTOM_KEY = "bottom";
```

So a wall's extent lives at `flags["wall-height"] = { top, bottom }` — **exactly what Touch writes** (`doc.setFlag("wall-height", "top"|"bottom", value)`). `null` means infinite; `getWallBounds` (`utils.js`) reads:

```js
top = wall.flags["wall-height"]?.top ?? Infinity;
bottom = wall.flags["wall-height"]?.bottom ?? -Infinity;
```

**Legacy (pre-4.0) scope:** `flags.wallHeight` with keys **`wallHeightTop` / `wallHeightBottom`** (proven by wall-height's own `migrateData()`, which copies `flags.wallHeight.wallHeightTop → flags["wall-height"].top`).

## 2. How Wall Height reacts to a flag write (`patches.js`)

```js
Hooks.on("updateWall", (wall, updates) => {
  if (updates.flags && updates.flags[MODULE_ID]) {
    WallHeight.schedulePerceptionUpdate(false);   // full perception refresh
  }
  if (canvas.walls.active) wall.object.refresh(); // redraw (drawWallRange label)
});
```

- `schedulePerceptionUpdate` → `canvas.perception.update({ initializeLightSources, initializeSounds, initializeVision, refreshLighting, refreshSounds, refreshOcclusion, refreshVision }, true)`.
- `wall.object.refresh()` is wrapped by `drawWallRange`, which adds a `PreciseText` named `wall-height-text` showing `"top / bottom"` on the wall (when "Show Wall Height Text" is on and the scene's `flags["wall-height"].advancedVision` is enabled — the default).
- Vision filtering: `ClockwiseSweepPolygon._testEdgeInclusion` wrapper — a wall is excluded from a sweep unless the source's elevation band `[b, t]` fits inside `[bottom, top]`.
- Wall Height also exposes the API Touch's macro uses: `WallHeight.getWallBounds(wall)`.

## 3. Simulation results (e2e/wallheight-test.mjs — 8/8 PASS)

Drives Touch's real `setEmitterWallHeight` (the same path the GM Hub uses) and logs the simulated reactions:

| Check | Result |
|---|---|
| `setEmitterWallHeight` writes `flags["wall-height"] = { bottom, top }` | PASS |
| `updateWall` hook → perception refresh + wall refresh seeing `top=30 bottom=10` | PASS |
| Clearing extent writes `null`s → Wall Height reads ±Infinity | PASS |
| Ping payload `levels` carries the Wall Height extent (no Levels) | PASS |
| Levels `rangeBottom/rangeTop` win when both modules have data | PASS |
| Viewer places the wall ping on floor F1 (bottom=10, 10u storeys) | PASS |
| Sweep semantics: elev 0 blocked, elev 20 passes, straddling band fails | PASS |
| Legacy scope maps `wallHeightTop/wallHeightBottom` correctly | PASS |

## 4. Bugs found by the verification (both fixed)

1. **Legacy fallback read wrong key names** (`touch/scripts/elevation.js`): Touch read `flags.wallHeight.top/bottom`; the real legacy keys are `wallHeightTop/wallHeightBottom`. Old scenes would have shown infinite extents for migrated walls. Fixed in `getWallHeightRange`, which now prefers the modern scope and falls back to the correct legacy keys.
2. **Ping payloads dropped vertical data** (`touch/scripts/pinger.js` `#makePing`): the computed `{bottom, top}` object was serialized as `lv.rangeBottom/lv.rangeTop` — fields that never exist — so **every ping shipped `levels: {bottom: null, top: null}`** and the viewer placed everything on floor 0 regardless of Levels/Wall Height data. It is now delegates to the shared `getLevelsRange`/`getWallHeightRange` helpers and emits `{bottom, top}`. (The earlier e2e suite missed this because the sample scene's balcony token had elevation 10 *and* Levels range 10 — the two errors cancelled out.)

Also fixed the mock (`e2e/foundry-mock.mjs`): `MockDoc.setFlag` now fires `update<Kind>` hooks like real Foundry, which is what let the Wall Height reaction chain be observed at all.

## 5. Live in-game verification (the macro)

Run `e2e/wh-live-macro.js` as a GM script macro in a world with Touch + Wall Height + (optionally) Levels enabled. It:

1. Creates a test wall with a Touch sonar config.
2. Prints `WallHeight.getWallBounds` before (±Infinity) and after Touch writes (`top=3 squares, bottom=1 square`).
3. Refreshes the wall and reports the on-canvas `wall-height-text` label (expected `"30 / 10"` for a 10u grid).
4. Spawns two sighted tokens at elevation 0 and elevation 20 and tests `canvas.visibility.testVisibility` across the wall — low eye should be blocked, high eye should see through.
5. Pulses Touch and reports the wall's viewer frame (`storey=1, floor=1`).
6. Deletes everything it created.

Expected console output is tagged `[Touch/WH-VERIFY]`.

## 6. Caveats

- **Foundry v14 compatibility:** wall-height 4.1.2's manifest declares `compatibility: { minimum: "13", verified: "13" }` — no v14 badge yet. The flag schema itself is plain document data, so it survives version bumps, but the vision wrappers depend on internal canvas APIs that Foundry may change in v14. The GM-Hub write path (`setFlag`) is safe regardless.
- The simulation mirrors wall-height's hook chain from source but cannot execute its `libWrapper` patches; only the in-game macro exercises the real sweep behavior.
- Wall Height reacts to **any** `setFlag` on its scope; if a future version debounces differently, the perception refresh may lag one frame — harmless for Touch, since the viewer re-derives placement from the payload, not from Wall Height state.
