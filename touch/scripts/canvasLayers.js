/** Attach Touch's live PIXI surfaces directly to Foundry's interface group. */
import { RingLayer } from "./rings.js";
import { WaypointLayer } from "./waypointLayer.js";
import { PathwayLayer } from "./pathwayLayer.js";
import { HypergridLayer } from "./hypergridLayer.js";
import { ZoneGridLayer } from "./zoneGridLayer.js";

const owned = new Map();
const definitions = [
  ["touchHypergrid", HypergridLayer],
  ["touchZones", ZoneGridLayer],
  ["touchPathways", PathwayLayer],
  ["touchWaypoints", WaypointLayer],
  ["touchRings", RingLayer],
];

function expose(property, layer) {
  Object.defineProperty(canvas, property, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: layer,
  });
}

/** Build and draw every Touch surface after Foundry's core canvas is ready. */
export async function ensureTouchCanvasLayers() {
  const parent = canvas?.interface ?? canvas?.stage;
  if (!parent?.addChild) throw new Error("Foundry canvas interface is unavailable");
  for (const [property, LayerClass] of definitions) {
    let layer = owned.get(property);
    if (!layer || layer.destroyed) {
      layer = new LayerClass();
      owned.set(property, layer);
      expose(property, layer);
      parent.addChild(layer);
      layer.zIndex = layer.options?.zIndex ?? LayerClass.layerOptions?.zIndex ?? 60;
      await layer.draw();
    } else if (layer.parent !== parent) {
      parent.addChild(layer);
    }
  }
  parent.sortChildren?.();
  return Object.fromEntries(owned);
}

/** Remove surfaces before Foundry replaces the canvas. */
export function teardownTouchCanvasLayers() {
  for (const [property, layer] of owned) {
    layer.tearDown?.();
    layer.parent?.removeChild?.(layer);
    layer.destroy?.({ children: true });
    if (canvas?.[property] === layer) delete canvas[property];
  }
  owned.clear();
}
