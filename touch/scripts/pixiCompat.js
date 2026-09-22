/** PIXI Graphics compatibility for Foundry runtimes using v7 or v8 syntax. */

export function strokePath(graphics, style, draw) {
  if (typeof graphics.stroke === "function") {
    draw(graphics);
    graphics.stroke(style);
  } else {
    graphics.lineStyle?.(style.width, style.color, style.alpha);
    draw(graphics);
  }
  return graphics;
}

export function fillPath(graphics, style, draw) {
  if (typeof graphics.fill === "function") {
    draw(graphics);
    graphics.fill(style);
  } else {
    graphics.beginFill?.(style.color, style.alpha);
    draw(graphics);
    graphics.endFill?.();
  }
  return graphics;
}

export function fillStrokePath(graphics, fillStyle, strokeStyle, draw) {
  if (typeof graphics.fill === "function" && typeof graphics.stroke === "function") {
    draw(graphics);
    graphics.fill(fillStyle);
    graphics.stroke(strokeStyle);
  } else {
    graphics.lineStyle?.(strokeStyle.width, strokeStyle.color, strokeStyle.alpha);
    graphics.beginFill?.(fillStyle.color, fillStyle.alpha);
    draw(graphics);
    graphics.endFill?.();
  }
  return graphics;
}

function circlePath(graphics, x, y, radius) {
  if (typeof graphics.circle === "function") graphics.circle(x, y, radius);
  else graphics.drawCircle?.(x, y, radius);
}

export function fillCircle(graphics, x, y, radius, style) {
  return fillPath(graphics, style, (target) => circlePath(target, x, y, radius));
}

export function strokeCircle(graphics, x, y, radius, style) {
  return strokePath(graphics, style, (target) => circlePath(target, x, y, radius));
}

export function fillStrokeCircle(graphics, x, y, radius, fillStyle, strokeStyle) {
  return fillStrokePath(graphics, fillStyle, strokeStyle, (target) => circlePath(target, x, y, radius));
}
