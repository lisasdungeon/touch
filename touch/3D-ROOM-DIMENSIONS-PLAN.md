# Fixed 4D Wireframe Room

## Status

Build in progress. Release remains pending Odinn's sign-off.

## Source specification

The grid makes the room. Touch does not generate a container around a scene
or ask the GM for W/H/D values.

- One Foundry five-foot grid cell is one CSS 3D wireframe cube.
- Cubes stack horizontally on X and Z and vertically on Y.
- The cube edges are laser-thin; no solid cube faces or orbit controls are
  needed.
- Every shared cube corner is one waypoint. That waypoint stores and displays
  the sonar memory held at that coordinate.
- The active Foundry scene shows the same room as a scene-relative projected
  laser lattice. The Hub configures Touch; it is not the only visual surface.

## Fixed dimensions

The current room is 100 feet on each physical axis using five-foot cells.

| Axis | Physical range | Grid intervals | Meaning |
| --- | --- | --- | --- |
| X | 100 ft | 20 | scene horizontal coordinate |
| Y | 100 ft | 20 | vertical stacked cubes / elevation |
| Z | 100 ft | 20 | scene depth coordinate |
| T | 100 s | 20 × 5 s | memory age at each waypoint |

This creates 8,000 physical CSS cubes (`20³`) and 9,261 shared physical
corner waypoints (`21³`). The temporal axis is real application state on each
waypoint, not 185,220 duplicate DOM nodes (`21³ × 20`). The four-dimensional
room therefore stays inspectable while the browser only materializes the
physical structure once.

## Implementation

- `scripts/hypergrid.js` lazily builds the actual 8,000 CSS cubes and 9,261
  shared corner waypoints for the Viewer. Contacts, tracks, waves, rails,
  wall/light extents, and persisted memory activate the matching corner.
- `styles/hypergrid.css` defines the fixed 3D CSS wireframe cube geometry.
  It has thin edge borders only; it never rotates the room.
- `scripts/hypergridLayer.js` draws the scene-relative fixed lattice through
  Foundry's `CanvasLayer` API. It uses one PIXI graphics projection for the
  scene view rather than making the Hub the visual surface.
- `scripts/pinger.js` refreshes the canvas lattice only after incoming sonar
  events. The feature does not poll.
- `scripts/viewer.js` loads the CSS cube lattice only when the Viewer opens
  and releases it when the Viewer closes.

## Verification gates

- Five-foot scene coordinates map to the expected stacked cube corner.
- The Viewer lazily materializes exactly 8,000 cubes and 9,261 waypoints.
- The live scene layer draws the lattice and refreshes memory corner nodes
  after a ping.
- Track history keeps its recency, head marker, stable per-track color, and
  shared group color at corner waypoints.
- The full module E2E suite, manifest validation, package inspection, and a
  clean Foundry installation check must pass before a release is proposed.
