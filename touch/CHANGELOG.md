# Changelog

## 0.1.5 — 2026-09-21

- Registered the Touch scene-control group during Foundry's `init` hook so the
  controls exist before the scene-control toolbar renders.
- Corrected `onChange` handling so tool deactivation never invokes an action,
  while preserving the legacy click path.

## 0.1.4 — 2026-09-21

- Added a fixed 100 × 100 × 100-foot 4D wireframe room to the active Foundry
  scene and Sonar Viewer.
- The Viewer lazily builds 8,000 stacked five-foot CSS cubes with laser-thin
  edges and 9,261 shared memory-bearing corner waypoints.
- Added a Foundry canvas lattice layer so the room is visible on the live
  scene, not only through the GM Hub.
- Routed ping memory, tracks, groups, waves, pathways, and vertical extents
  into the corresponding corner waypoints; track history retains recency,
  head state, and stable track or group color.
- Removed the obsolete configurable WebGL W/H/D room and orbit controls.

- Restored the dedicated Touch scene-control group with the Dev Bible's
  required order, Token layer, ready-time registration, and control refresh.

## 0.1.3 — 2026-09-21

- Restored the Touch scene-control entry through the supported Token controls
  path across Foundry VTT 12 through 14.
- Declared the module socket capability required by Touch's socket listener.

## 0.1.2 — 2026-09-21

- Added a clean E2E runner for isolated Foundry mock processes.
- Added Foundry v12 legacy-array and v13+ record scene-control compatibility.
- Switched scene socket registration to the public `on` API.
- Deferred the viewer and GM hub UI modules until first use.
- Split runtime, viewer, hub, memory, and track responsibilities into bounded modules.
- Split the stylesheet into base, viewer, and hub files with manifest hot-reload coverage.
- Removed display emoji from the module UI and aligned contributor metadata with Lisa's Dungeon.
