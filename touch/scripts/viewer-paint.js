/** Reconcile sonar frames into 2D camera tiles and the CSS cube room. */
import { CAMERAS, TONES } from "./constants.js";

function inFloorBand(filter, elevation, storeyHeight) {
  return filter === null ||
    (elevation >= filter * storeyHeight && elevation < (filter + 1) * storeyHeight);
}

export function flushTrails(viewer, now = Date.now()) {
  viewer.refreshHypergrid?.(now);
}

/** The fixed cube lattice owns the waypoint projection of waves and rails. */
export function flushWaves(viewer) {
  if (!viewer?.rendered || viewer.paused) return;
  viewer.refreshHypergrid?.();
}

function syncStatus(viewer) {
  const element = viewer.element?.querySelector("[data-status]");
  if (!element) return;
  const base = viewer.paused
    ? game.i18n.localize("TOUCH.Viewer.Paused")
    : game.i18n.localize("TOUCH.Viewer.Running");
  element.textContent = viewer.floorFilter === null ? base : `${base} · F${viewer.floorFilter}`;
}

/** Keep the diagnostic perimeter cameras as 2D projections of the same frames. */
export function flushFrames(viewer) {
  if (!viewer.rendered || !viewer.element) return;
  const root = viewer.element;
  const now = Date.now();
  const storeyHeight = game.settings.get("touch", "storeyHeight") ?? 10;
  const filter = viewer.floorFilter;
  const inBand = (frame) => inFloorBand(filter, (frame.storey ?? 0) * storeyHeight, storeyHeight);

  for (const camera of CAMERAS) {
    const tile = root.querySelector(`[data-camera="${camera.id}"]`);
    if (!tile) continue;
    const latest = viewer.frames.get(camera.id);
    const host = tile.querySelector(".touch-cam-blips") ?? tile;
    const existing = [...host.querySelectorAll(".touch-blip")];
    let index = 0;
    if (latest) for (const frame of latest.values()) {
      if (!inBand(frame)) continue;
      let blip = existing[index];
      if (!blip) {
        blip = document.createElement("div");
        blip.className = "touch-blip";
        host.appendChild(blip);
      }
      for (const [key, value] of Object.entries(frame.vars)) blip.style.setProperty(key, value);
      blip.style.setProperty("--age", ((now - frame.born) / 1000).toFixed(2));
      if (frame.facing) {
        blip.style.setProperty("--fang", `${frame.facing.relDeg.toFixed(1)}deg`);
        blip.style.setProperty("--ffov", `${frame.facing.fov}deg`);
      }
      blip.dataset.kind = frame.kind;
      blip.dataset.mode = frame.mode ?? "both";
      blip.dataset.omni = String((frame.facing?.fov ?? 360) >= 360);
      blip.style.animationDuration = `${TONES[frame.tone ?? "mid"]?.blink ?? 2}s`;
      blip.dataset.name = frame.name ?? "";
      blip.title = frame.name ?? "";
      if (frame.identity) {
        blip.classList.add("touch-identified");
        blip.title += `\n${game.i18n.format("TOUCH.Viewer.Identity", { id: frame.identity })}`;
      }
      if (frame.color) blip.style.color = frame.color;
      index++;
    }
    existing.slice(index).forEach((element) => element.style.setProperty("--s", "0.12"));
  }
  viewer.refreshHypergrid?.();
  syncStatus(viewer);
}

export { syncStatus };
