/** Canvas pointer routing for Touch's waypoint and pathway placement modes. */

const stageHandlers = new WeakMap();

/** Convert a PIXI pointer event into the canvas-stage coordinate system. */
export function canvasPointFromEvent(event) {
  const stage = canvas?.stage;
  let point = event?.getLocalPosition?.(stage);
  if (!point && event?.global && stage?.worldTransform?.applyInverse) {
    point = stage.worldTransform.applyInverse(event.global);
  }
  point ??= event?.global;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  return { x: point.x, y: point.y };
}

/** Route one primary-button scene click to whichever Touch placement mode is armed. */
export async function handleCanvasPointerDown(event) {
  if (event?.button !== undefined && event.button !== 0) return null;
  const point = canvasPointFromEvent(event);
  if (!point || !canvas?.scene) return null;
  if (canvas.touchWaypoints?.armed) {
    event.stopPropagation?.();
    return canvas.touchWaypoints.deployAt(point);
  }
  if (canvas.touchPathways?.armed) {
    event.stopPropagation?.();
    return canvas.touchPathways.clickAt(point);
  }
  return null;
}

/** Bind exactly one placement listener to the current Foundry canvas stage. */
export function bindCanvasInteractions(stage = canvas?.stage) {
  if (!stage?.on || stageHandlers.has(stage)) return false;
  const handler = (event) => handleCanvasPointerDown(event).catch((error) => {
      console.error("Touch | Canvas placement failed", error);
      ui.notifications?.error("Touch | Could not place the scene object. Check the console for details.");
      return null;
    });
  stage.on("pointerdown", handler);
  stageHandlers.set(stage, handler);
  return true;
}

/** Remove the listener before Foundry tears down or replaces the canvas stage. */
export function unbindCanvasInteractions(stage = canvas?.stage) {
  const handler = stage && stageHandlers.get(stage);
  if (!handler) return false;
  stage.off?.("pointerdown", handler);
  stageHandlers.delete(stage);
  return true;
}
