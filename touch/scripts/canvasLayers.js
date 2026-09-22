/** Attach Touch's live PIXI surfaces directly to Foundry's interface group. */
import { RingLayer } from "./rings.js?release=0.1.14";
import { WaypointLayer } from "./waypointLayer.js?release=0.1.14";
import { PathwayLayer } from "./pathwayLayer.js?release=0.1.14";
import { HypergridLayer } from "./hypergridLayer.js?release=0.1.14";

const owned = new Map();
const definitions = [
  ["touchHypergrid", HypergridLayer, 900, "scene"],
  ["touchPathways", PathwayLayer, 920, "interface"],
  ["touchWaypoints", WaypointLayer, 930, "interface"],
  ["touchRings", RingLayer, 940, "interface"],
];

async function removeRetiredZoneLayer() {
  const layer = canvas?.touchZones;
  if (!layer) return;
  await layer.tearDown?.();
  layer.parent?.removeChild?.(layer);
  layer.destroy?.({ children: true });
  if (canvas.touchZones === layer) delete canvas.touchZones;
}

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
  await removeRetiredZoneLayer();
  for (const [property, LayerClass, zIndex, surface] of definitions) {
    let layer = owned.get(property);
    try {
      const parent = parentFor(surface);
      if (!parent?.addChild) throw new Error(`Foundry ${surface} canvas group is unavailable`);
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
    } catch (error) {
      layer?.parent?.removeChild?.(layer);
      layer?.destroy?.({ children: true });
      owned.delete(property);
      if (canvas?.[property] === layer) delete canvas[property];
      console.error(`Touch | ${property} failed to initialize:`, error);
    }
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
  const retired = canvas?.touchZones;
  retired?.parent?.removeChild?.(retired);
  retired?.destroy?.({ children: true });
  if (canvas?.touchZones === retired) delete canvas.touchZones;
}
