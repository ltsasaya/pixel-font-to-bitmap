import type { BoundingBox, Font, Glyph } from "opentype.js";
import { alphaToBinaryRgba, createSheetLayouts, getCellPlacement } from "./bitmap";
import { opentype } from "./opentypeCompat";
import type {
  BitmapConversionResult,
  BitmapConverterSettings,
  BitmapExport,
  BitmapGlyphExport,
  DesignBounds,
  GlyphSourceRecord,
  RasterReport
} from "./types";

export const DEFAULT_SETTINGS: BitmapConverterSettings = {
  cellWidth: 32,
  cellHeight: 32,
  padding: 1,
  threshold: 128,
  columns: 16,
  background: "solid",
  maxSheetDimension: 4096
};

export function normalizeSettings(
  partial: Partial<BitmapConverterSettings>
): BitmapConverterSettings {
  const next = {
    ...DEFAULT_SETTINGS,
    ...partial
  };

  const cellWidth = clampInteger(next.cellWidth, 1, 512, "cellWidth");
  const cellHeight = clampInteger(next.cellHeight, 1, 512, "cellHeight");
  const maxPadding = Math.max(0, Math.floor(Math.min(cellWidth, cellHeight) / 2) - 1);

  return {
    cellWidth,
    cellHeight,
    padding: clampInteger(next.padding, 0, maxPadding, "padding"),
    threshold: clampInteger(next.threshold, 0, 255, "threshold"),
    columns: clampInteger(next.columns, 1, 128, "columns"),
    background: next.background === "solid" ? "solid" : "transparent",
    maxSheetDimension: clampInteger(next.maxSheetDimension, 256, 16_384, "maxSheetDimension")
  };
}

export function parseOpenTypeFont(buffer: ArrayBuffer): Font {
  try {
    return opentype.parse(buffer, { lowMemory: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse the font file. ${detail}`);
  }
}

export function collectGlyphRecords(font: Font): GlyphSourceRecord[] {
  const glyphCount = getGlyphCount(font);
  const records: GlyphSourceRecord[] = [];

  for (let index = 0; index < glyphCount; index += 1) {
    const glyph = font.glyphs.get(index);
    const designBounds = toDesignBounds(glyph.getBoundingBox());
    const name = glyph.name ?? font.glyphIndexToName?.(index) ?? undefined;

    records.push({
      glyphIndex: index,
      name: name || undefined,
      unicodes: collectUnicodes(glyph),
      designBounds,
      empty: isEmptyDesignBounds(designBounds)
    });
  }

  return records;
}

export async function convertFontToBitmap(
  input: ArrayBuffer,
  fileName: string,
  settingsInput: Partial<BitmapConverterSettings> = {}
): Promise<BitmapConversionResult> {
  const settings = normalizeSettings(settingsInput);
  const font = parseOpenTypeFont(input);
  const glyphRecords = collectGlyphRecords(font);
  const fitPlan = computePixelFitPlan(font, glyphRecords, settings);
  const layouts = createSheetLayouts(
    glyphRecords.length,
    settings.cellWidth,
    settings.cellHeight,
    settings.columns,
    settings.maxSheetDimension
  );
  const sheetCanvases = layouts.map((layout) =>
    createSheetCanvas(layout.width, layout.height, settings.background)
  );
  const glyphs: BitmapGlyphExport[] = [];
  let rawGrayPixels = 0;
  let rawPixelCount = 0;
  let outputInvalidPixels = 0;

  for (let ordinal = 0; ordinal < glyphRecords.length; ordinal += 1) {
    const record = glyphRecords[ordinal];
    const glyph = font.glyphs.get(record.glyphIndex);
    const placement = getCellPlacement(
      ordinal,
      layouts,
      settings.cellWidth,
      settings.cellHeight
    );
    const cellCanvas = renderGlyphCell(glyph, record, settings, fitPlan);
    const cellContext = get2dContext(cellCanvas);
    const sourceImage = cellContext.getImageData(0, 0, settings.cellWidth, settings.cellHeight);
    const binaryCell = alphaToBinaryRgba(
      sourceImage.data,
      settings.cellWidth,
      settings.cellHeight,
      settings.threshold,
      settings.background
    );
    const sheetContext = get2dContext(sheetCanvases[placement.sheet]);
    const binaryImage = sheetContext.createImageData(settings.cellWidth, settings.cellHeight);

    binaryImage.data.set(binaryCell.rgba);
    sheetContext.putImageData(binaryImage, placement.x, placement.y);
    rawGrayPixels += binaryCell.sourceGrayPixels;
    rawPixelCount += settings.cellWidth * settings.cellHeight;
    outputInvalidPixels += binaryCell.outputInvalidPixels;

    glyphs.push({
      id: `gid-${record.glyphIndex}`,
      glyphIndex: record.glyphIndex,
      name: record.name,
      unicodes: record.unicodes,
      sheet: placement.sheet,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      bounds: binaryCell.bitmap.bounds,
      empty: binaryCell.bitmap.empty,
      pixels: binaryCell.bitmap.pixels
    });
  }

  const raster: RasterReport = {
    binaryOutput: true,
    outputInvalidPixels,
    rawGrayPixels,
    rawPixelCount,
    rawGrayRatio: rawPixelCount === 0 ? 0 : rawGrayPixels / rawPixelCount,
    fit: {
      strategy: fitPlan.strategy,
      sourceGridUnit: fitPlan.sourceGridUnit,
      sourceMaxGlyphWidthPixels: fitPlan.sourceMaxGlyphWidthPixels,
      sourceMaxGlyphHeightPixels: fitPlan.sourceMaxGlyphHeightPixels,
      outputPixelsPerSourcePixel: fitPlan.outputPixelsPerSourcePixel,
      fontSize: fitPlan.fontSize,
      scale: fitPlan.scale
    }
  };

  const metadata: BitmapExport = {
    version: 1,
    font: {
      fileName,
      familyName: getFontFamilyName(font),
      glyphCount: glyphRecords.length,
      unitsPerEm: font.unitsPerEm
    },
    settings: {
      cellWidth: settings.cellWidth,
      cellHeight: settings.cellHeight,
      padding: settings.padding,
      threshold: settings.threshold,
      mode: "one-bit-alpha-threshold",
      background: settings.background
    },
    raster,
    sheets: layouts.map((layout) => ({
      fileName: sheetFileName(fileName, layout.sheetIndex),
      width: layout.width,
      height: layout.height,
      columns: layout.columns,
      rows: layout.rows
    })),
    glyphs
  };

  return {
    metadata,
    sheets: sheetCanvases.map((canvas, index) => ({
      fileName: metadata.sheets[index].fileName,
      canvas
    }))
  };
}

export interface PixelFitPlan {
  strategy: "inferred-grid" | "bounds-fit";
  fontSize: number;
  scale: number;
  sourceGridUnit: number;
  sourceMaxGlyphWidthPixels: number;
  sourceMaxGlyphHeightPixels: number;
  outputPixelsPerSourcePixel: number;
}

export function computePixelFitPlan(
  font: Font,
  glyphRecords: GlyphSourceRecord[],
  settings: BitmapConverterSettings
): PixelFitPlan {
  const visibleBounds = glyphRecords
    .filter((record) => !record.empty)
    .map((record) => record.designBounds);
  const maxWidth = Math.max(0, ...visibleBounds.map((bounds) => bounds.x2 - bounds.x1));
  const maxHeight = Math.max(0, ...visibleBounds.map((bounds) => bounds.y2 - bounds.y1));
  const availableWidth = Math.max(1, settings.cellWidth - settings.padding * 2);
  const availableHeight = Math.max(1, settings.cellHeight - settings.padding * 2);
  const unitsPerEm = font.unitsPerEm || 1000;
  const inferredGridUnit = inferDesignGridUnit(font, glyphRecords);

  if (inferredGridUnit && maxWidth > 0 && maxHeight > 0) {
    const sourceMaxGlyphWidthPixels = Math.max(1, Math.ceil(maxWidth / inferredGridUnit));
    const sourceMaxGlyphHeightPixels = Math.max(1, Math.ceil(maxHeight / inferredGridUnit));
    const outputPixelsPerSourcePixel = Math.max(
      1,
      Math.floor(
        Math.min(
          availableWidth / sourceMaxGlyphWidthPixels,
          availableHeight / sourceMaxGlyphHeightPixels
        )
      )
    );
    const scale = outputPixelsPerSourcePixel / inferredGridUnit;

    return {
      strategy: "inferred-grid",
      sourceGridUnit: inferredGridUnit,
      sourceMaxGlyphWidthPixels,
      sourceMaxGlyphHeightPixels,
      outputPixelsPerSourcePixel,
      scale,
      fontSize: scale * unitsPerEm
    };
  }

  const fallback = computeGlobalScale(font, glyphRecords, settings);

  return {
    strategy: "bounds-fit",
    sourceGridUnit: fallback.scale === 0 ? 1 : 1 / fallback.scale,
    sourceMaxGlyphWidthPixels: Math.ceil(maxWidth * fallback.scale),
    sourceMaxGlyphHeightPixels: Math.ceil(maxHeight * fallback.scale),
    outputPixelsPerSourcePixel: 1,
    fontSize: fallback.fontSize,
    scale: fallback.scale
  };
}

export function inferDesignGridUnit(
  font: Font,
  glyphRecords: GlyphSourceRecord[]
): number | undefined {
  const scaledDeltas: number[] = [];
  const scaleFactor = 1000;
  const unitsPerEm = font.unitsPerEm || 1000;

  for (const record of glyphRecords) {
    if (record.empty) {
      continue;
    }

    const glyph = font.glyphs.get(record.glyphIndex);
    const path = glyph.getPath(0, 0, unitsPerEm);
    collectAxisDeltas(getPathCoordinates(path.commands, "x"), scaleFactor, scaledDeltas);
    collectAxisDeltas(getPathCoordinates(path.commands, "y"), scaleFactor, scaledDeltas);
  }

  const usefulDeltas = scaledDeltas.filter((delta) => delta >= scaleFactor);

  if (usefulDeltas.length === 0) {
    return undefined;
  }

  const gcdUnit = usefulDeltas.reduce((current, next) => gcd(current, next));

  if (gcdUnit >= scaleFactor) {
    return gcdUnit / scaleFactor;
  }

  const dominant = mostFrequentDelta(usefulDeltas);
  return dominant ? dominant / scaleFactor : undefined;
}

export function computeGlobalScale(
  font: Font,
  glyphRecords: GlyphSourceRecord[],
  settings: BitmapConverterSettings
): { fontSize: number; scale: number } {
  const visibleBounds = glyphRecords
    .filter((record) => !record.empty)
    .map((record) => record.designBounds);
  const maxWidth = Math.max(0, ...visibleBounds.map((bounds) => bounds.x2 - bounds.x1));
  const maxHeight = Math.max(0, ...visibleBounds.map((bounds) => bounds.y2 - bounds.y1));
  const availableWidth = Math.max(1, settings.cellWidth - settings.padding * 2);
  const availableHeight = Math.max(1, settings.cellHeight - settings.padding * 2);
  const unitsPerEm = font.unitsPerEm || 1000;

  if (maxWidth === 0 || maxHeight === 0) {
    const fontSize = Math.min(availableWidth, availableHeight);
    return {
      fontSize,
      scale: fontSize / unitsPerEm
    };
  }

  const fontSize = Math.max(
    1,
    Math.min(
      (availableWidth * unitsPerEm) / maxWidth,
      (availableHeight * unitsPerEm) / maxHeight
    )
  );

  return {
    fontSize,
    scale: fontSize / unitsPerEm
  };
}

function renderGlyphCell(
  glyph: Glyph,
  record: GlyphSourceRecord,
  settings: BitmapConverterSettings,
  fitPlan: PixelFitPlan
): HTMLCanvasElement {
  const canvas = createCanvas(settings.cellWidth, settings.cellHeight);
  const context = get2dContext(canvas);
  context.clearRect(0, 0, settings.cellWidth, settings.cellHeight);

  if (record.empty) {
    return canvas;
  }

  const snappedX1 = snapDown(record.designBounds.x1, fitPlan.sourceGridUnit);
  const snappedY2 = snapUp(record.designBounds.y2, fitPlan.sourceGridUnit);
  const originX = settings.padding - snappedX1 * fitPlan.scale;
  const baselineY = settings.padding + snappedY2 * fitPlan.scale;
  const path = glyph.getPath(originX, baselineY, fitPlan.fontSize);

  path.fill = "#000000";
  path.stroke = null;
  context.fillStyle = "#000000";
  context.imageSmoothingEnabled = false;
  path.draw(context);

  return canvas;
}

function createSheetCanvas(
  width: number,
  height: number,
  background: BitmapConverterSettings["background"]
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const context = get2dContext(canvas);

  if (background === "solid") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  return canvas;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("This browser could not create a 2D canvas context.");
  }

  return context;
}

function toDesignBounds(bounds: BoundingBox): DesignBounds {
  return {
    x1: finiteOrZero(bounds.x1),
    y1: finiteOrZero(bounds.y1),
    x2: finiteOrZero(bounds.x2),
    y2: finiteOrZero(bounds.y2)
  };
}

function isEmptyDesignBounds(bounds: DesignBounds): boolean {
  return bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1;
}

function collectUnicodes(glyph: Glyph): number[] {
  const unicodes = new Set<number>();

  for (const unicode of glyph.unicodes ?? []) {
    if (Number.isInteger(unicode)) {
      unicodes.add(unicode);
    }
  }

  const primaryUnicode = glyph.unicode;

  if (typeof primaryUnicode === "number" && Number.isInteger(primaryUnicode)) {
    unicodes.add(primaryUnicode);
  }

  return [...unicodes].sort((left, right) => left - right);
}

function getGlyphCount(font: Font): number {
  return font.numGlyphs || font.glyphs.length || 0;
}

function getFontFamilyName(font: Font): string | undefined {
  const names = font.names as unknown as FontNameTable;

  return (
    getNameFromTable(names, "fontFamily") ??
    getNameFromTable(names, "preferredFamily") ??
    getNameFromTable(names, "fullName")
  );
}

function sheetFileName(originalFileName: string, sheetIndex: number): string {
  return `${stripExtension(sanitizeFileStem(originalFileName))}-sheet-${sheetIndex + 1}.png`;
}

function sanitizeFileStem(fileName: string): string {
  return fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "font";
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function getPathCoordinates(
  commands: Glyph["path"]["commands"],
  axis: "x" | "y"
): number[] {
  const coordinates: number[] = [];

  for (const command of commands) {
    for (const key of Object.keys(command)) {
      if (key === axis || key.endsWith(axis)) {
        const value = command[key as keyof typeof command];
        if (typeof value === "number" && Number.isFinite(value)) {
          coordinates.push(value);
        }
      }
    }
  }

  return coordinates;
}

function collectAxisDeltas(
  coordinates: number[],
  scaleFactor: number,
  target: number[]
): void {
  const uniqueCoordinates = [...new Set(coordinates.map((value) => Math.round(value * scaleFactor)))]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  for (let index = 1; index < uniqueCoordinates.length; index += 1) {
    const delta = uniqueCoordinates[index] - uniqueCoordinates[index - 1];
    if (delta > 0) {
      target.push(delta);
    }
  }
}

function mostFrequentDelta(deltas: number[]): number | undefined {
  const counts = new Map<number, number>();

  for (const delta of deltas) {
    counts.set(delta, (counts.get(delta) ?? 0) + 1);
  }

  let bestDelta: number | undefined;
  let bestCount = 0;

  for (const [delta, count] of counts) {
    if (count > bestCount) {
      bestDelta = delta;
      bestCount = count;
    }
  }

  return bestCount >= 3 ? bestDelta : undefined;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a;
}

function snapDown(value: number, unit: number): number {
  if (unit <= 0) {
    return value;
  }

  return Math.floor(value / unit) * unit;
}

function snapUp(value: number, unit: number): number {
  if (unit <= 0) {
    return value;
  }

  return Math.ceil(value / unit) * unit;
}

type NameEntry = Record<string, string>;

interface FontNameTable {
  [key: string]: NameEntry | FontNameTable | undefined;
}

function getNameFromTable(names: FontNameTable, key: string): string | undefined {
  const direct = names[key];

  if (isNameEntry(direct)) {
    return getLocalizedName(direct);
  }

  for (const value of Object.values(names)) {
    if (value && !isNameEntry(value)) {
      const nested = getNameFromTable(value, key);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function isNameEntry(value: unknown): value is NameEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function getLocalizedName(name: NameEntry | undefined): string | undefined {
  return name?.en ?? Object.values(name ?? {})[0];
}
