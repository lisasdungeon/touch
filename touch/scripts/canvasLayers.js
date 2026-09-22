/** Attach Touch's live PIXI surfaces directly to Foundry's interface group. */
import { RingLayer } from "./rings.js";
import { WaypointLayer } from "./waypointLayer.js";
import { PathwayLayer } from "./pathwayLayer.js";
import { HypergridLayer } from "./hypergridLayer.js";
import { ZoneGridLayer } from "./zoneGridLayer.js";

const owned = new Map();
const definitions = [
  ["touchHypergrid", HypergridLayer, 900],
  ["touchZones", ZoneGridLayer, 910],
  ["touchPathways", PathwayLayer, 920],
  ["touchWaypoints", WaypointLayer, 930],
  ["touchRings", RingLayer, 940],
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
  for (const [property, LayerClass, zIndex] of definitions) {
    let layer = owned.get(property);
    if (!layer || layer.destroyed) {
      layer = new LayerClass();
      owned.set(property, layer);
      expose(property, layer);
      parent.addChild(layer);
      await layer.draw();
    } else if (layer.parent !== parent) {
      parent.addChild(layer);
    }
    layer.zIndex = zIndex;
    layer.visible = true;
    layer.renderable = true;
    layer.alpha = 1;
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
