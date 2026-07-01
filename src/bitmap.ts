import type { BitmapBounds, CellPlacement, RgbaTuple, SheetBackground, SheetLayout } from "./types";

export interface AlphaBitmap {
  empty: boolean;
  bounds: BitmapBounds;
  pixels: string[];
}

export interface BinaryRgbaResult {
  bitmap: AlphaBitmap;
  rgba: Uint8ClampedArray;
  sourceGrayPixels: number;
  outputInvalidPixels: number;
}

export function alphaToBitmapRows(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number
): AlphaBitmap {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");

  if (rgba.length < width * height * 4) {
    throw new Error("RGBA data is smaller than the declared image dimensions.");
  }

  const boundedThreshold = Math.max(0, Math.min(255, Math.round(threshold)));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isPixelOn(rgba, width, x, y, boundedThreshold)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      empty: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      pixels: []
    };
  }

  const pixels: string[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    let row = "";
    for (let x = minX; x <= maxX; x += 1) {
      row += isPixelOn(rgba, width, x, y, boundedThreshold) ? "1" : "0";
    }
    pixels.push(row);
  }

  return {
    empty: false,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    },
    pixels
  };
}

export function alphaToBinaryRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
  background: SheetBackground,
  foregroundColor?: RgbaTuple
): BinaryRgbaResult {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");

  if (rgba.length < width * height * 4) {
    throw new Error("RGBA data is smaller than the declared image dimensions.");
  }

  const bitmap = alphaToBitmapRows(rgba, width, height, threshold);
  const binary = new Uint8ClampedArray(width * height * 4);
  const boundedThreshold = Math.max(0, Math.min(255, Math.round(threshold)));
  const foreground = foregroundColor ?? defaultForegroundColor(background);
  let sourceGrayPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      const targetIndex = sourceIndex;
      const alpha = rgba[sourceIndex + 3] ?? 0;
      const isOn = alpha > boundedThreshold;

      if (alpha !== 0 && alpha !== 255) {
        sourceGrayPixels += 1;
      }

      if (isOn) {
        binary[targetIndex] = foreground[0];
        binary[targetIndex + 1] = foreground[1];
        binary[targetIndex + 2] = foreground[2];
        binary[targetIndex + 3] = foreground[3];
      } else if (background === "solid") {
        binary[targetIndex] = 255;
        binary[targetIndex + 1] = 255;
        binary[targetIndex + 2] = 255;
        binary[targetIndex + 3] = 255;
      } else {
        binary[targetIndex] = 0;
        binary[targetIndex + 1] = 0;
        binary[targetIndex + 2] = 0;
        binary[targetIndex + 3] = 0;
      }
    }
  }

  return {
    bitmap,
    rgba: binary,
    sourceGrayPixels,
    outputInvalidPixels: countInvalidBinaryPixels(binary, background, foreground)
  };
}

export function countInvalidBinaryPixels(
  rgba: ArrayLike<number>,
  background: SheetBackground,
  foregroundColor?: RgbaTuple
): number {
  if (rgba.length % 4 !== 0) {
    throw new Error("RGBA data length must be divisible by 4.");
  }

  const foreground = foregroundColor ?? defaultForegroundColor(background);
  let invalid = 0;

  for (let index = 0; index < rgba.length; index += 4) {
    const red = rgba[index] ?? 0;
    const green = rgba[index + 1] ?? 0;
    const blue = rgba[index + 2] ?? 0;
    const alpha = rgba[index + 3] ?? 0;
    const foregroundPixel =
      red === foreground[0] &&
      green === foreground[1] &&
      blue === foreground[2] &&
      alpha === foreground[3];
    const solidEmpty =
      background === "solid" && red === 255 && green === 255 && blue === 255 && alpha === 255;
    const transparentEmpty =
      background === "transparent" && red === 0 && green === 0 && blue === 0 && alpha === 0;

    if (!foregroundPixel && !solidEmpty && !transparentEmpty) {
      invalid += 1;
    }
  }

  return invalid;
}

function defaultForegroundColor(background: SheetBackground): RgbaTuple {
  return background === "transparent" ? [255, 255, 255, 255] : [0, 0, 0, 255];
}

export function createSheetLayouts(
  glyphCount: number,
  cellWidth: number,
  cellHeight: number,
  requestedColumns: number,
  maxSheetDimension: number
): SheetLayout[] {
  assertNonNegativeInteger(glyphCount, "glyphCount");
  assertPositiveInteger(cellWidth, "cellWidth");
  assertPositiveInteger(cellHeight, "cellHeight");
  assertPositiveInteger(requestedColumns, "requestedColumns");
  assertPositiveInteger(maxSheetDimension, "maxSheetDimension");

  if (cellWidth > maxSheetDimension || cellHeight > maxSheetDimension) {
    throw new Error(
      `Cell size ${cellWidth}x${cellHeight} exceeds the maximum sheet dimension ${maxSheetDimension}.`
    );
  }

  if (glyphCount === 0) {
    return [];
  }

  const columns = Math.max(
    1,
    Math.min(requestedColumns, Math.floor(maxSheetDimension / cellWidth))
  );
  const rowsPerSheet = Math.max(1, Math.floor(maxSheetDimension / cellHeight));
  const cellsPerSheet = columns * rowsPerSheet;
  const layouts: SheetLayout[] = [];

  for (
    let startGlyphIndex = 0, sheetIndex = 0;
    startGlyphIndex < glyphCount;
    startGlyphIndex += cellsPerSheet, sheetIndex += 1
  ) {
    const sheetGlyphCount = Math.min(cellsPerSheet, glyphCount - startGlyphIndex);
    const rows = Math.ceil(sheetGlyphCount / columns);

    layouts.push({
      sheetIndex,
      startGlyphIndex,
      glyphCount: sheetGlyphCount,
      width: columns * cellWidth,
      height: rows * cellHeight,
      columns,
      rows
    });
  }

  return layouts;
}

export function getCellPlacement(
  glyphOrdinal: number,
  layouts: SheetLayout[],
  cellWidth: number,
  cellHeight: number
): CellPlacement {
  assertNonNegativeInteger(glyphOrdinal, "glyphOrdinal");
  assertPositiveInteger(cellWidth, "cellWidth");
  assertPositiveInteger(cellHeight, "cellHeight");

  const layout = layouts.find(
    (candidate) =>
      glyphOrdinal >= candidate.startGlyphIndex &&
      glyphOrdinal < candidate.startGlyphIndex + candidate.glyphCount
  );

  if (!layout) {
    throw new Error(`Glyph ordinal ${glyphOrdinal} is outside the packed sheet range.`);
  }

  const localIndex = glyphOrdinal - layout.startGlyphIndex;
  const column = localIndex % layout.columns;
  const row = Math.floor(localIndex / layout.columns);

  return {
    sheet: layout.sheetIndex,
    x: column * cellWidth,
    y: row * cellHeight,
    width: cellWidth,
    height: cellHeight
  };
}

function isPixelOn(
  rgba: ArrayLike<number>,
  width: number,
  x: number,
  y: number,
  threshold: number
): boolean {
  return rgba[(y * width + x) * 4 + 3] > threshold;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}
