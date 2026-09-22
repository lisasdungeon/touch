/** Alphabetic column and numeric row zone labels rendered over the live scene. */

const ZONE_COLOR = 0x5eead4;
const MAX_ZONE_CUBES = 50000;
export const ZONE_LEVELS = 10;
export const LEVEL_FEET = 10;
export const CUBE_FEET = 10;
export const ROOM_HEIGHT_FEET = ZONE_LEVELS * LEVEL_FEET;
export const CUBE_TIERS = ROOM_HEIGHT_FEET / CUBE_FEET;

function pixiMajor() {
  return Number.parseInt(String(PIXI.VERSION ?? "8").split(".")[0], 10);
}

function cubePixelSize(dimensions, options = {}) {
  const gridSize = Math.max(
    1,
    Number(options.gridSize ?? dimensions?.size ?? globalThis.canvas?.grid?.size) || 100
  );
  const gridDistance = Math.max(1, Number(options.gridDistance ?? dimensions?.distance) || 5);
  return gridSize * CUBE_FEET / gridDistance;
}

/** Spreadsheet-style column labels: A...Z, AA...AZ, BA... */
export function columnLabel(index) {
  let value = Math.max(0, Math.floor(Number(index) || 0)) + 1;
  let label = "";
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

/** Zone ids read row first, then column: 1A, 1B, 2A. */
export function zoneId(row, column) {
  return `${Math.max(0, Math.floor(Number(row) || 0)) + 1}${columnLabel(column)}`;
}

/** Resolve a canvas coordinate into its plan zone and vertical cube address. */
export function zoneAddress(x, y, elevation = 0, options = {}) {
  const dimensions = options.dimensions ?? globalThis.canvas?.dimensions;
  if (!dimensions) return null;
  const size = cubePixelSize(dimensions, options);
  const sceneX = Number(dimensions.sceneX) || 0;
  const sceneY = Number(dimensions.sceneY) || 0;
  const localX = Number(x) - sceneX;
  const localY = Number(y) - sceneY;
  const width = Number(dimensions.sceneWidth) || 0;
  const height = Number(dimensions.sceneHeight) || 0;
  if (![localX, localY].every(Number.isFinite)) return null;
  if (localX < 0 || localY < 0 || localX >= width || localY >= height) return null;

  const rowIndex = Math.floor(localY / size);
  const columnIndex = Math.floor(localX / size);
  const heightFeet = Math.max(0, Math.min(ROOM_HEIGHT_FEET - 0.000001, Number(elevation) || 0));
  const level = Math.floor(heightFeet / LEVEL_FEET) + 1;
  const cubeTier = Math.floor(heightFeet / CUBE_FEET) + 1;
  const zone = zoneId(rowIndex, columnIndex);
  return {
    zone,
    row: rowIndex + 1,
    column: columnLabel(columnIndex),
    level,
    levelElevation: (level - 1) * LEVEL_FEET,
    cubeTier,
    cube: `${zone}-L${String(level).padStart(2, "0")}-T${String(cubeTier).padStart(2, "0")}`,
  };
}

function makeText(value, style, alpha = 1) {
  const text = pixiMajor() >= 8 ? new PIXI.Text({ text: value, style }) : new PIXI.Text(value, style);
  text.anchor?.set?.(0.5);
  text.eventMode = "none";
  text.alpha = alpha;
  return text;
}

function textStyle(size) {
  const base = {
    fontFamily: "Arial, sans-serif",
    fontSize: size,
    fontWeight: "700",
    fill: ZONE_COLOR,
    align: "center",
  };
  if (pixiMajor() >= 8) return {
    ...base,
    stroke: { color: 0x071117, width: Math.max(2, size / 7) },
    dropShadow: { color: 0x000000, alpha: 0.8, blur: 2, distance: 1 },
  };
  return {
    ...base,
    stroke: 0x071117,
    strokeThickness: Math.max(2, size / 7),
    dropShadow: true,
    dropShadowColor: 0x000000,
    dropShadowAlpha: 0.8,
    dropShadowBlur: 2,
    dropShadowDistance: 1,
  };
}

function createAddressTexture(columns, rows, size, width, height) {
  const scale = Math.min(1, 4096 / Math.max(width, height));
  const surface = document.createElement("canvas");
  surface.width = Math.max(1, Math.ceil(width * scale));
  surface.height = Math.max(1, Math.ceil(height * scale));
  const context = surface.getContext?.("2d");
  if (!context || !PIXI.Texture?.from || !PIXI.Sprite) return null;
  context.scale(scale, scale);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const paint = (value, x, y, fontSize, alpha) => {
    context.globalAlpha = alpha;
    context.font = `700 ${fontSize}px Arial, sans-serif`;
    context.lineWidth = Math.max(2, fontSize / 7);
    context.strokeStyle = "#071117";
    context.fillStyle = "#5eead4";
    context.strokeText(value, x, y);
    context.fillText(value, x, y);
  };
  const cellSize = Math.max(12, Math.min(24, size * 0.18));
  const headerSize = Math.max(15, Math.min(30, size * 0.24));
  const center = (index, limit) => {
    const start = Math.min(index * size, limit);
    const end = Math.min((index + 1) * size, limit);
    return (start + end) / 2;
  };
  for (let column = 0; column < columns; column++) {
    paint(columnLabel(column), center(column, width), Math.max(10, size * 0.13), headerSize, 1);
  }
  for (let row = 0; row < rows; row++) {
    const y = center(row, height);
    paint(String(row + 1), Math.max(10, size * 0.13), y, headerSize, 1);
    for (let column = 0; column < columns; column++) {
      paint(zoneId(row, column), center(column, width), y, cellSize, 0.72);
    }
  }
  return { texture: PIXI.Texture.from(surface), width, height };
}

function drawStroke(graphics, style, draw) {
  if (typeof graphics.stroke === "function") {
    draw();
    graphics.stroke(style);
    return;
  }
  graphics.lineStyle(style.width, style.color, style.alpha);
  draw();
}

export class ZoneGridLayer extends foundry.canvas.layers.CanvasLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "touchZones", zIndex: 60 });
  }

  async _draw() {
    await super._draw();
    this.refreshZones();
  }

  refreshZones() {
    this.labelTexture?.destroy?.(true);
    this.labelTexture = null;
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    const dimensions = canvas?.dimensions;
    if (!canvas?.scene || !dimensions || canvas.grid?.isGridless) return;
    const size = cubePixelSize(dimensions);
    const width = Math.max(0, Number(dimensions.sceneWidth) || 0);
    const height = Math.max(0, Number(dimensions.sceneHeight) || 0);
    const columns = Math.max(0, Math.ceil(width / size));
    const rows = Math.max(0, Math.ceil(height / size));
    if (!columns || !rows || columns * rows * CUBE_TIERS > MAX_ZONE_CUBES) {
      this.zoneCount = 0;
      this.cubeCount = 0;
      return;
    }

    const grids = new PIXI.Graphics();
    grids.eventMode = "none";
    const labels = new PIXI.Container();
    labels.eventMode = "none";
    labels.interactiveChildren = false;
    const levelStyle = textStyle(Math.max(16, Math.min(32, size * 0.26)));
    const cubeRise = Math.max(20, size * 0.34);
    const cubeDrift = cubeRise * 0.55;
    const originX = Number(dimensions.sceneX) || 0;
    const originY = Number(dimensions.sceneY) || 0;
    const addressPlane = createAddressTexture(columns, rows, size, width, height);
    if (!addressPlane) {
      this.zoneCount = 0;
      this.cubeCount = 0;
      return;
    }
    this.labelTexture = addressPlane.texture;

    // Ten ten-foot cube tiers need eleven shared horizontal planes.
    for (let tier = 0; tier <= CUBE_TIERS; tier++) {
      const dx = tier * cubeDrift;
      const dy = -tier * cubeRise;
      const major = tier % (LEVEL_FEET / CUBE_FEET) === 0;
      drawStroke(grids, { width: 1, color: ZONE_COLOR, alpha: major ? 0.55 : 0.26 }, () => {
        for (let column = 0; column <= columns; column++) {
          const x = originX + Math.min(column * size, width) + dx;
          grids.moveTo(x, originY + dy).lineTo(x, originY + height + dy);
        }
        for (let row = 0; row <= rows; row++) {
          const y = originY + Math.min(row * size, height) + dy;
          grids.moveTo(originX + dx, y).lineTo(originX + width + dx, y);
        }
      });
    }

    // Each addressable ten-foot band is one readable wireframe cube tier.
    for (let level = 0; level < ZONE_LEVELS; level++) {
      const tier = level * (LEVEL_FEET / CUBE_FEET);
      const dx = tier * cubeDrift;
      const dy = -tier * cubeRise;
      const elevation = level * LEVEL_FEET;
      const alpha = Math.max(0.5, 0.92 - level * 0.045);
      const plane = new PIXI.Sprite(addressPlane.texture);
      plane.position.set(originX + dx, originY + dy);
      plane.width = addressPlane.width;
      plane.height = addressPlane.height;
      plane.alpha = alpha;
      plane.eventMode = "none";
      plane.zoneLevel = level + 1;
      plane.elevation = elevation;
      labels.addChild(plane);
      const levelTitle = makeText(`LVL ${level + 1} · ${elevation} FT`, levelStyle, alpha);
      levelTitle.position.set(originX + size * 1.15 + dx, originY + size * 0.28 + dy);
      levelTitle.zoneLevel = level + 1;
      levelTitle.elevation = elevation;
      labels.addChild(levelTitle);

    }

    const topDx = CUBE_TIERS * cubeDrift;
    const topDy = -CUBE_TIERS * cubeRise;
    drawStroke(grids, { width: 1, color: ZONE_COLOR, alpha: 0.5 }, () => {
      for (let column = 0; column <= columns; column++) {
        for (let row = 0; row <= rows; row++) {
          const x = originX + Math.min(column * size, width);
          const y = originY + Math.min(row * size, height);
          grids.moveTo(x, y).lineTo(x + topDx, y + topDy);
        }
      }
    });

    this.addChild(grids);
    this.addChild(labels);
    this.grids = grids;
    this.labels = labels;
    this.columns = columns;
    this.rows = rows;
    this.levelCount = ZONE_LEVELS;
    this.elevations = Array.from({ length: ZONE_LEVELS }, (_, level) => level * LEVEL_FEET);
    this.wireElevations = Array.from({ length: CUBE_TIERS + 1 }, (_, tier) => tier * CUBE_FEET);
    this.cubeTiers = CUBE_TIERS;
    this.cubeCount = columns * rows * CUBE_TIERS;
    this.zoneCount = columns * rows * ZONE_LEVELS;
  }

  zoneAt(row, column, level = 1) {
    const index = Math.max(1, Math.min(ZONE_LEVELS, Math.floor(Number(level) || 1)));
    return { id: zoneId(row, column), level: index, elevation: (index - 1) * LEVEL_FEET };
  }
}
