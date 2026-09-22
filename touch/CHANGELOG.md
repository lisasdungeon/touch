# Changelog

## 0.1.13 — 2026-09-22

- Added a bundled Three.js WebGL2 renderer for the live Foundry scene, using a
  real perspective camera, depth testing, a bounded outer room shell, and one
  static GPU line buffer containing all 1,000 ten-foot cubes.
- Kept the grid inside its fixed 100 × 100-foot scene footprint instead of
  stretching the WebGL surface across maps larger than the room.
- Made the renderer event-driven: there is no animation loop, and only memory
  changes or actual lattice contacts upload a new frame to PIXI.
- Changed movement sensing into a laser-trip grid. Motion within one cube is
  silent; crossing an X, depth, or elevation boundary emits one addressed ping
  and briefly lights only the contacted cube's wire edges.
- Preserved the lightweight PIXI renderer as a fallback when WebGL2 is not
  available, and bundled all Three.js files and licensing without a CDN.
- Added a fresh 0.1.13 entrypoint and versioned dependency graph to prevent
  clients from retaining the previous canvas and movement code.

## 0.1.12 — 2026-09-22

- Fixed the PIXI 7 text-style crash in the numbered scene-zone layer by using
  legacy primitive stroke and drop-shadow properties on older Foundry clients.
- Made canvas-surface startup fault-isolated so one failed visual can no longer
  prevent waypoint, pathway, or ping-ring layers from loading.
- Enlarged the physical lattice from 5-foot microcells to readable 10-foot
  cubes: 1,000 cubes and 1,331 memory-bearing corners across the same
  100 × 100 × 100-foot room.
- Added immediate, GM-authoritative movement pings for tokens, ambient lights,
  ambient sounds, walls, and tiles while they are inside the scene room.
- Added a fresh 0.1.12 module entrypoint so clients cannot retain the broken
  zone-label module graph.

## 0.1.11 — 2026-09-22

- Added a versioned release entrypoint and versioned live-surface imports so an
  already-open Foundry client cannot reuse the pre-fix `hypergridLayer.js`
  module graph after an update.
- Preserved the 0.1.10 thin-wireframe renderer and dual PIXI Graphics support.

## 0.1.10 — 2026-09-22

- Removed every voxel face fill so the room uses only thin, static cube edges
  derived from the Quantum Portal's six-face cube topology.
- Fixed live Foundry scene initialization on the server's PIXI runtime by
  supporting both legacy and current Graphics drawing APIs across voxel,
  waypoint, pathway, and token-ring surfaces.
- Moved the voxel room and numbered zones into Foundry's primary scene group so
  they render on the map independently of the Viewer and GM Hub.
- Cached the 96,000 static scene edges once; pings now redraw only active memory
  markers instead of rebuilding the complete room.
- Made floor filtering control the base geometry: a 10-foot floor displays only
  its two five-foot voxel tiers, while the all-floor view uses reduced opacity.

## 0.1.9 — 2026-09-22

- Replaced the continuous room cage with 8,000 distinct Minecraft-style voxel
  blocks: 400 five-foot cubes per tier across twenty vertical tiers.
- Added a visible gap, separate top/front/side faces, and twelve owned edges to
  every block so the room reads as stacked cubes instead of intersecting rails.
- Matched the live Foundry scene projection to the Viewer voxel model while
  preserving all 9,261 shared memory-bearing corner waypoints.
- Kept the voxel stack static and trigger-rendered with no cube animation.

## 0.1.8 — 2026-09-22

- Replaced the blank 17,261-element CSS cube/corner build with one deterministic
  SVG wireframe containing every edge of the 8,000-cube spatial lattice.
- Kept all 9,261 corners addressable while creating visible marker elements only
  when pings, memory, tracks, pathways, or vertical bands activate them.
- Reduced the Viewer room from 340 pixels to 190 pixels and arranged all six
  camera feeds in two bounded rows so the full interface stays inside the window.
- Added an on-screen version and live scene-layer count to prove which installed
  build is running and whether all five Foundry scene surfaces are attached.
- Forced the five scene surfaces visible and renderable above core canvas content
  with stable z-index ordering.

## 0.1.7 — 2026-09-22

- Replaced unreliable custom canvas-layer registration with lazy, direct
  attachment to Foundry's live `canvas.interface` group during `canvasReady`.
- Added the missing triggered render loop for expanding token ping rings; scene
  pings now draw immediately and remain active without opening the Viewer.
- Corrected waypoint, pathway, ring, room, and zone coordinates on padded maps
  by keeping live PIXI graphics in Foundry canvas coordinates.
- Rebuilt the Viewer room around a real 200 × 200-pixel 3D transform root
  instead of a zero-size contained element that rendered blank.
- Increased the static room, cube, waypoint, level, and zone line contrast so
  the 4D structure is visibly distinct from the scene's native grid.
- Added lifecycle coverage that begins with no Touch surfaces and proves
  `canvasReady` creates, draws, attaches, activates, and tears down all five.

## 0.1.6 — 2026-09-21

- Made Waypoint and Pathway scene controls persistent placement modes and
  routed live canvas clicks through stable stage coordinates.
- Registered every live scene layer during Foundry's `init` lifecycle so the
  waypoint, pathway, room, and zone overlays are instantiated with the canvas.
- Added an alphabetic-column/numeric-row scene address system with cell ids
  such as `1A`, continuing past `Z` to `AA`.
- Added ten static 10-foot level planes and twenty static five-foot cube tiers,
  forming a labeled 100-foot vertical room directly over the scene grid.
- Added zone, level, and cube addresses to every player-visible token ping while
  preserving the visibility boundary for GM-hidden tokens.
- Removed paint containment that clipped the fixed CSS room in the Sonar Viewer.

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
