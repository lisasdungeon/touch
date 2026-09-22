# Fixed 4D Wireframe Room

## Status

Build in progress. Release remains pending Odinn's sign-off.

## Source specification

The room is a bounded WebGL volume placed on the active Foundry scene. Its
outer shell contains the grid; the grid is not stretched into a full-scene
background and Touch does not ask the GM for W/H/D values.

- One ten-foot spatial cell is one Three.js 3D wireframe cube.
- Cubes stack horizontally on X and Z and vertically on Y.
- The cube edges are laser-thin; no solid cube faces or orbit controls are
  needed.
- Every shared cube corner is one waypoint. That waypoint stores and displays
  the sonar memory held at that coordinate.
- The active Foundry scene shows the room through a real WebGL perspective
  camera. The Hub configures Touch; it is not the visual container.

## Fixed dimensions

The current room is 100 feet on each physical axis using readable ten-foot cells.

| Axis | Physical range | Grid intervals | Meaning |
| --- | --- | --- | --- |
| X | 100 ft | 10 | scene horizontal coordinate |
| Y | 100 ft | 10 | vertical stacked cubes / elevation |
| Z | 100 ft | 10 | scene depth coordinate |
| T | 100 s | 10 × 10 s | memory age at each waypoint |

This creates 1,000 physical cubes (`10³`) and 1,331 shared physical
corner waypoints (`11³`). The temporal axis is real application state on each
waypoint, not 13,310 duplicate DOM nodes (`11³ × 10`). The four-dimensional
room therefore stays inspectable while the browser only materializes the
physical structure once.

## Implementation

- `scripts/threeRoom.js` builds one static Three.js `LineSegments` buffer for
  all 12,000 cube edges plus a separate outer room shell. A perspective camera
  and depth buffer provide real X/Y/Z depth.
- `scripts/hypergridLayer.js` places the transparent WebGL canvas on Foundry's
  primary scene group and uploads it through a PIXI texture. It falls back to
  the lightweight PIXI projection when WebGL2 is unavailable.
- `scripts/pinger.js` refreshes the canvas only after incoming sonar events.
  Contacted cube edges flash once and restore after 650 ms; no animation loop
  or polling runs at idle.
- `scripts/hypergrid.js` and `scripts/viewer.js` retain the lightweight SVG
  room for the Viewer, loaded only when that window opens.

## Verification gates

- Ten-foot scene coordinates map to the expected stacked cube corner.
- The Viewer lazily materializes exactly 1,000 cubes and 1,331 waypoints.
- The live scene layer draws a bounded perspective room and refreshes memory
  corner nodes after a ping.
- Movement inside one cube remains silent; each crossed spatial boundary emits
  exactly one lattice contact.
- Track history keeps its recency, head marker, stable per-track color, and
  shared group color at corner waypoints.
- The full module E2E suite, manifest validation, package inspection, and a
  clean Foundry installation check must pass before a release is proposed.
