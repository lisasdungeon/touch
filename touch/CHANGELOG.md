# Changelog

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
