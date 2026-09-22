/** Data-only alphabetic column and numeric row zone addressing. */
export const ZONE_LEVELS = 10;
export const LEVEL_FEET = 10;
export const CUBE_FEET = 10;
export const ROOM_HEIGHT_FEET = ZONE_LEVELS * LEVEL_FEET;
export const CUBE_TIERS = ROOM_HEIGHT_FEET / CUBE_FEET;

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
