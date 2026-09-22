/** Attach Touch's live PIXI surfaces directly to Foundry's interface group. */
import { RingLayer } from "./rings.js?release=0.1.11";
import { WaypointLayer } from "./waypointLayer.js?release=0.1.11";
import { PathwayLayer } from "./pathwayLayer.js?release=0.1.11";
import { HypergridLayer } from "./hypergridLayer.js?release=0.1.11";
import { ZoneGridLayer } from "./zoneGridLayer.js?release=0.1.11";

const owned = new Map();
const definitions = [
  ["touchHypergrid", HypergridLayer, 900, "scene"],
  ["touchZones", ZoneGridLayer, 910, "scene"],
  ["touchPathways", PathwayLayer, 920, "interface"],
  ["touchWaypoints", WaypointLayer, 930, "interface"],
  ["touchRings", RingLayer, 940, "interface"],
];

function parentFor(surface) {
  if (surface === "scene" && canvas?.primary?.group?.addChild) return canvas.primary.group;
  return canvas?.interface ?? canvas?.stage;
}

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
  for (const [property, LayerClass, zIndex, surface] of definitions) {
    const parent = parentFor(surface);
    if (!parent?.addChild) throw new Error(`Foundry ${surface} canvas group is unavailable`);
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
  canvas?.primary?.group?.sortChildren?.();
  canvas?.interface?.sortChildren?.();
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
