import type { BoundingBox, Font, Glyph } from "opentype.js";
import { alphaToBinaryRgba, createSheetLayouts, getCellPlacement } from "./bitmap";
import type { AlphaBitmap } from "./bitmap";
import { opentype } from "./opentypeCompat";
import type {
  BitmapConversionResult,
  BitmapConverterSettings,
  CellPlacement,
  CharacterFilterMode,
  CharacterFilterPreset,
  DesignBounds,
  GlyphSourceRecord,
  MinimumCellSizeResult,
  ProportionalGlyphMetadata,
  RasterReport,
  RgbaTuple
} from "./types";

export const DEFAULT_SETTINGS: BitmapConverterSettings = {
  cellWidth: 32,
  cellHeight: 32,
  padding: 0,
  threshold: 128,
  columns: 16,
  atlasFileName: "",
  characters: "",
  characterFilterMode: "none",
  characterFilterSet: "",
  exportTextColor: "#ffffff",
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
    atlasFileName: normalizeAtlasFileName(next.atlasFileName),
    characters: normalizeCharacterOrder(next.characters),
    characterFilterMode: normalizeCharacterFilterMode(next.characterFilterMode),
    characterFilterSet: normalizeCharacterOrder(next.characterFilterSet),
    exportTextColor: normalizeHexColor(next.exportTextColor),
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
    records.push(glyphToRecord(glyph, font.glyphIndexToName?.(index) ?? undefined));
  }

  return records;
}

function glyphToRecord(glyph: Glyph, fallbackName?: string): GlyphSourceRecord {
  const designBounds = toDesignBounds(glyph.getBoundingBox());
  const name = glyph.name ?? fallbackName ?? undefined;

  return {
    glyphIndex: glyph.index,
    name: name || undefined,
    unicodes: collectUnicodes(glyph),
    designBounds,
    advanceWidth: finiteOrZero(glyph.advanceWidth ?? 0),
    leftSideBearing: finiteOrFallback(glyph.leftSideBearing, designBounds.x1),
    empty: isEmptyDesignBounds(designBounds)
  };
}

function emptyCharacterRecord(character: string): GlyphSourceRecord {
  return {
    glyphIndex: -1,
    name: `missing-${character.codePointAt(0)?.toString(16) ?? "unknown"}`,
    unicodes: [],
    designBounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
    advanceWidth: 0,
    leftSideBearing: 0,
    empty: true
  };
}

export interface CharacterPlanEntry {
  character: string;
  glyph?: Glyph;
  record: GlyphSourceRecord;
  missing: boolean;
}

export interface CharacterPlan {
  entries: CharacterPlanEntry[];
  missingCharacters: string[];
  duplicateCharacters: string[];
}

export function createCharacterPlan(font: Font, characters: string): CharacterPlan {
  const entries: CharacterPlanEntry[] = [];
  const missing = new Set<string>();
  const duplicates = new Set<string>();
  const seen = new Set<string>();

  for (const character of Array.from(characters)) {
    if (seen.has(character)) {
      duplicates.add(character);
    }
    seen.add(character);

    const hasCharacter = font.hasChar(character);
    const glyph = hasCharacter ? font.charToGlyph(character) : undefined;

    if (!glyph) {
      missing.add(character);
      entries.push({
        character,
        record: emptyCharacterRecord(character),
        missing: true
      });
      continue;
    }

    entries.push({
      character,
      glyph,
      record: glyphToRecord(glyph),
      missing: false
    });
  }

  return {
    entries,
    missingCharacters: [...missing],
    duplicateCharacters: [...duplicates]
  };
}

export function detectFontCharacterOrder(font: Font): string {
  const codepoints = new Set<number>();

  for (const record of collectGlyphRecords(font)) {
    for (const unicode of record.unicodes) {
      if (isExportableCodepoint(unicode)) {
        codepoints.add(unicode);
      }
    }
  }

  return [...codepoints]
    .sort((left, right) => left - right)
    .map((unicode) => String.fromCodePoint(unicode))
    .join("");
}

export function detectFontCharacterOrderFromBuffer(buffer: ArrayBuffer): string {
  return detectFontCharacterOrder(parseOpenTypeFont(buffer));
}

export function applyCharacterFilter(
  characters: string,
  settings: Pick<BitmapConverterSettings, "characterFilterMode" | "characterFilterSet">
): string {
  if (settings.characterFilterMode === "none") {
    return characters;
  }

  const keepSet = makeCharacterSet(settings.characterFilterSet);

  return Array.from(characters)
    .filter((character) => keepSet.has(character))
    .join("");
}

export function characterFilterPresetCharacters(preset: CharacterFilterPreset): string {
  switch (preset) {
    case "ascii-printable":
      return printableAsciiCharacters();
    case "ascii-alphanumeric":
      return `${uppercaseAsciiCharacters()}${lowercaseAsciiCharacters()}${digitCharacters()}`;
    case "uppercase":
      return uppercaseAsciiCharacters();
    case "lowercase":
      return lowercaseAsciiCharacters();
    case "digits":
      return digitCharacters();
    case "common-game":
      return ` ${uppercaseAsciiCharacters()}${digitCharacters()}!?.,:;'"-_+/=()[]#%&@`;
  }
}

interface CharacterResolution {
  characters: string;
  source: "auto" | "manual";
}

function resolveCharacters(font: Font, settings: BitmapConverterSettings): CharacterResolution {
  const baseCharacters = settings.characters || detectFontCharacterOrder(font);
  const source = settings.characters ? "manual" : "auto";

  if (baseCharacters.length === 0) {
    throw new Error("No Unicode-mapped characters were found in this font.");
  }

  const characters = applyCharacterFilter(baseCharacters, settings);

  if (characters.length === 0) {
    throw new Error("No characters remain after applying the selected character filter.");
  }

  return {
    characters,
    source
  };
}

export function detectMinimumCellSizeFromBuffer(
  buffer: ArrayBuffer,
  settingsInput: Partial<BitmapConverterSettings> = {}
): MinimumCellSizeResult {
  const settings = normalizeSettings(settingsInput);
  const font = parseOpenTypeFont(buffer);
  const characterResolution = resolveCharacters(font, settings);

  const characterPlan = createCharacterPlan(font, characterResolution.characters);
  const presentRecords = characterPlan.entries
    .filter((entry) => !entry.missing)
    .map((entry) => entry.record);

  if (presentRecords.length === 0) {
    throw new Error("No drawable requested characters were found in this font.");
  }

  const minimum = computeMinimumCellSize(font, presentRecords, settings.padding);

  return {
    ...minimum,
    characterCount: characterPlan.entries.length,
    characterSource: characterResolution.source
  };
}

export async function convertFontToBitmap(
  input: ArrayBuffer,
  _fileName: string,
  settingsInput: Partial<BitmapConverterSettings> = {}
): Promise<BitmapConversionResult> {
  const settings = normalizeSettings(settingsInput);
  const font = parseOpenTypeFont(input);
  const characterResolution = resolveCharacters(font, settings);
  const characters = characterResolution.characters;

  const characterPlan = createCharacterPlan(font, characters);
  const presentRecords = characterPlan.entries
    .filter((entry) => !entry.missing)
    .map((entry) => entry.record);
  const fitPlan = computePixelFitPlan(font, presentRecords, settings);
  const layouts = createSheetLayouts(
    characterPlan.entries.length,
    settings.cellWidth,
    settings.cellHeight,
    settings.columns,
    settings.maxSheetDimension
  );
  const layout = layouts[0];

  if (!layout || layouts.length > 1) {
    throw new Error("The fixed-grid Swift export must fit in a single atlas. Reduce characters, columns, or cell size.");
  }

  const exportTextColor = hexColorToRgba(settings.exportTextColor);
  const previewTextColor: RgbaTuple = [0, 0, 0, 255];
  const exportSheetCanvases = [createSheetCanvas(layout.width, layout.height)];
  const previewSheetCanvases = [createSheetCanvas(layout.width, layout.height)];
  let rawGrayPixels = 0;
  let rawPixelCount = 0;
  let outputInvalidPixels = 0;
  const proportionalGlyphs: ProportionalGlyphMetadata[] = [];

  for (let ordinal = 0; ordinal < characterPlan.entries.length; ordinal += 1) {
    const entry = characterPlan.entries[ordinal];
    const record = entry.record;
    const glyph = entry.glyph;
    const placement = getCellPlacement(
      ordinal,
      layouts,
      settings.cellWidth,
      settings.cellHeight
    );
    const cellCanvas = glyph
      ? renderGlyphCell(glyph, record, settings, fitPlan)
      : createCanvas(settings.cellWidth, settings.cellHeight);
    const cellContext = get2dContext(cellCanvas);
    const sourceImage = cellContext.getImageData(0, 0, settings.cellWidth, settings.cellHeight);
    const binaryCell = alphaToBinaryRgba(
      sourceImage.data,
      settings.cellWidth,
      settings.cellHeight,
      settings.threshold,
      "transparent",
      exportTextColor
    );
    const previewCell = alphaToBinaryRgba(
      sourceImage.data,
      settings.cellWidth,
      settings.cellHeight,
      settings.threshold,
      "transparent",
      previewTextColor
    );
    proportionalGlyphs.push(
      createProportionalGlyphMetadata(
        entry.character,
        ordinal,
        record,
        placement,
        binaryCell.bitmap,
        settings,
        fitPlan
      )
    );
    const exportSheetContext = get2dContext(exportSheetCanvases[placement.sheet]);
    const previewSheetContext = get2dContext(previewSheetCanvases[placement.sheet]);
    const binaryImage = exportSheetContext.createImageData(settings.cellWidth, settings.cellHeight);
    const previewImage = previewSheetContext.createImageData(settings.cellWidth, settings.cellHeight);

    binaryImage.data.set(binaryCell.rgba);
    previewImage.data.set(previewCell.rgba);
    exportSheetContext.putImageData(binaryImage, placement.x, placement.y);
    previewSheetContext.putImageData(previewImage, placement.x, placement.y);
    rawGrayPixels += binaryCell.sourceGrayPixels;
    rawPixelCount += settings.cellWidth * settings.cellHeight;
    outputInvalidPixels += binaryCell.outputInvalidPixels;
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
      sourceAscentPixels: fitPlan.sourceAscentPixels,
      sourceDescentPixels: fitPlan.sourceDescentPixels,
      baselineOffsetPixels: fitPlan.baselineOffsetPixels,
      outputPixelsPerSourcePixel: fitPlan.outputPixelsPerSourcePixel,
      fontSize: fitPlan.fontSize,
      scale: fitPlan.scale
    }
  };

  return {
    metadata: {
      atlas: settings.atlasFileName,
      characters,
      cellWidth: settings.cellWidth,
      cellHeight: settings.cellHeight,
      columns: settings.columns
    },
    extendedMetadata: {
      atlas: settings.atlasFileName,
      characters,
      cellWidth: settings.cellWidth,
      cellHeight: settings.cellHeight,
      columns: settings.columns,
      format: "swift-proportional-grid-v1",
      metrics: {
        originX: roundMetric(cellOriginX(settings, fitPlan)),
        baselineY: roundMetric(cellBaselineY(settings, fitPlan)),
        lineAdvance: settings.cellHeight
      },
      glyphs: proportionalGlyphs,
      characterSource: characterResolution.source,
      characterFilter: {
        mode: settings.characterFilterMode,
        set: settings.characterFilterMode === "keep-set" ? settings.characterFilterSet : undefined
      },
      glyphPixel: exportTextColor,
      emptyPixel: [0, 0, 0, 0],
      binaryAlpha: true,
      diagnostics: raster
    },
    diagnostics: raster,
    sheets: exportSheetCanvases.map((canvas, index) => ({
      fileName: settings.atlasFileName,
      canvas,
      previewCanvas: previewSheetCanvases[index]
    })),
    characterCount: characterPlan.entries.length,
    characterSource: characterResolution.source,
    missingCharacters: characterPlan.missingCharacters,
    duplicateCharacters: characterPlan.duplicateCharacters
  };
}

function createProportionalGlyphMetadata(
  character: string,
  index: number,
  record: GlyphSourceRecord,
  placement: CellPlacement,
  bitmap: AlphaBitmap,
  settings: BitmapConverterSettings,
  fitPlan: PixelFitPlan
): ProportionalGlyphMetadata {
  const xAdvance = roundMetric(record.advanceWidth * fitPlan.scale);

  if (bitmap.empty) {
    return {
      char: character,
      codePoint: character.codePointAt(0) ?? 0,
      glyphIndex: record.glyphIndex,
      index,
      x: placement.x,
      y: placement.y,
      width: 0,
      height: 0,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      xOffset: 0,
      yOffset: 0,
      xAdvance,
      empty: true
    };
  }

  return {
    char: character,
    codePoint: character.codePointAt(0) ?? 0,
    glyphIndex: record.glyphIndex,
    index,
    x: placement.x + bitmap.bounds.x,
    y: placement.y + bitmap.bounds.y,
    width: bitmap.bounds.width,
    height: bitmap.bounds.height,
    bounds: bitmap.bounds,
    xOffset: roundMetric(bitmap.bounds.x - cellOriginX(settings, fitPlan)),
    yOffset: roundMetric(bitmap.bounds.y - cellBaselineY(settings, fitPlan)),
    xAdvance,
    empty: false
  };
}

function cellOriginX(settings: BitmapConverterSettings, fitPlan: PixelFitPlan): number {
  return settings.padding + fitPlan.horizontalOriginOffsetPixels;
}

function cellBaselineY(settings: BitmapConverterSettings, fitPlan: PixelFitPlan): number {
  return settings.padding + fitPlan.baselineOffsetPixels;
}

export interface PixelFitPlan {
  strategy: "inferred-grid" | "bounds-fit";
  fontSize: number;
  scale: number;
  sourceGridUnit: number;
  sourceMaxGlyphWidthPixels: number;
  sourceMaxGlyphHeightPixels: number;
  sourceAscentPixels: number;
  sourceDescentPixels: number;
  baselineOffsetPixels: number;
  horizontalOriginOffsetPixels: number;
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
  const horizontalFrame = computeHorizontalFrame(glyphRecords);
  const frame = computeBaselineFrame(visibleBounds);
  const availableWidth = Math.max(1, settings.cellWidth - settings.padding * 2);
  const availableHeight = Math.max(1, settings.cellHeight - settings.padding * 2);
  const unitsPerEm = font.unitsPerEm || 1000;
  const inferredGridUnit = inferDesignGridUnit(font, glyphRecords);

  if (inferredGridUnit && horizontalFrame.width > 0 && frame.height > 0) {
    const snappedMinX = snapDown(horizontalFrame.minX, inferredGridUnit);
    const snappedMaxX = snapUp(horizontalFrame.maxX, inferredGridUnit);
    const sourceMaxGlyphWidthPixels = Math.max(
      1,
      Math.ceil((snappedMaxX - snappedMinX) / inferredGridUnit)
    );
    const snappedAscent = snapUp(frame.ascent, inferredGridUnit);
    const snappedDescent = snapUp(frame.descent, inferredGridUnit);
    const sourceAscentPixels = Math.max(0, Math.ceil(snappedAscent / inferredGridUnit));
    const sourceDescentPixels = Math.max(0, Math.ceil(snappedDescent / inferredGridUnit));
    const sourceMaxGlyphHeightPixels = Math.max(1, sourceAscentPixels + sourceDescentPixels);
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
      sourceAscentPixels,
      sourceDescentPixels,
      baselineOffsetPixels: sourceAscentPixels * outputPixelsPerSourcePixel,
      horizontalOriginOffsetPixels:
        (-snappedMinX / inferredGridUnit) * outputPixelsPerSourcePixel,
      outputPixelsPerSourcePixel,
      scale,
      fontSize: scale * unitsPerEm
    };
  }

  const fallback = computeGlobalScale(font, glyphRecords, settings);

  return {
    strategy: "bounds-fit",
    sourceGridUnit: fallback.scale === 0 ? 1 : 1 / fallback.scale,
    sourceMaxGlyphWidthPixels: Math.ceil(horizontalFrame.width * fallback.scale),
    sourceMaxGlyphHeightPixels: Math.ceil(frame.height * fallback.scale),
    sourceAscentPixels: frame.ascent * fallback.scale,
    sourceDescentPixels: frame.descent * fallback.scale,
    baselineOffsetPixels: frame.ascent * fallback.scale,
    horizontalOriginOffsetPixels: -horizontalFrame.minX * fallback.scale,
    outputPixelsPerSourcePixel: 1,
    fontSize: fallback.fontSize,
    scale: fallback.scale
  };
}

export function computeMinimumCellSize(
  font: Font,
  glyphRecords: GlyphSourceRecord[],
  padding: number
): Omit<MinimumCellSizeResult, "characterCount" | "characterSource"> {
  const visibleBounds = glyphRecords
    .filter((record) => !record.empty)
    .map((record) => record.designBounds);
  const horizontalFrame = computeHorizontalFrame(glyphRecords);
  const frame = computeBaselineFrame(visibleBounds);
  const gridUnit = inferDesignGridUnit(font, glyphRecords) ?? 1;
  const sourceMaxGlyphWidthPixels = Math.max(
    1,
    Math.ceil(
      (snapUp(horizontalFrame.maxX, gridUnit) - snapDown(horizontalFrame.minX, gridUnit)) /
        gridUnit
    )
  );
  const sourceMaxGlyphHeightPixels = Math.max(
    1,
    Math.ceil(snapUp(frame.ascent, gridUnit) / gridUnit) +
      Math.ceil(snapUp(frame.descent, gridUnit) / gridUnit)
  );
  const normalizedPadding = Math.max(0, Math.round(padding));

  return {
    cellWidth: Math.min(512, sourceMaxGlyphWidthPixels + normalizedPadding * 2),
    cellHeight: Math.min(512, sourceMaxGlyphHeightPixels + normalizedPadding * 2),
    sourceMaxGlyphWidthPixels,
    sourceMaxGlyphHeightPixels,
    sourceGridUnit: gridUnit
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
    if (record.advanceWidth > 0) {
      scaledDeltas.push(Math.round(record.advanceWidth * scaleFactor));
    }

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

function computeBaselineFrame(boundsList: DesignBounds[]): {
  ascent: number;
  descent: number;
  height: number;
} {
  const maxY = Math.max(0, ...boundsList.map((bounds) => bounds.y2));
  const minY = Math.min(0, ...boundsList.map((bounds) => bounds.y1));
  const ascent = Math.max(0, maxY);
  const descent = Math.max(0, -minY);

  return {
    ascent,
    descent,
    height: ascent + descent
  };
}

function computeHorizontalFrame(glyphRecords: GlyphSourceRecord[]): {
  minX: number;
  maxX: number;
  width: number;
} {
  const visibleRecords = glyphRecords.filter((record) => !record.empty);
  const minX = Math.min(0, ...visibleRecords.map((record) => record.leftSideBearing));
  const maxX = Math.max(
    0,
    ...glyphRecords.map((record) => record.advanceWidth),
    ...visibleRecords.map((record) => {
      return record.leftSideBearing + (record.designBounds.x2 - record.designBounds.x1);
    })
  );

  return {
    minX,
    maxX,
    width: maxX - minX
  };
}

export function computeGlobalScale(
  font: Font,
  glyphRecords: GlyphSourceRecord[],
  settings: BitmapConverterSettings
): { fontSize: number; scale: number } {
  const visibleBounds = glyphRecords
    .filter((record) => !record.empty)
    .map((record) => record.designBounds);
  const horizontalFrame = computeHorizontalFrame(glyphRecords);
  const frame = computeBaselineFrame(visibleBounds);
  const availableWidth = Math.max(1, settings.cellWidth - settings.padding * 2);
  const availableHeight = Math.max(1, settings.cellHeight - settings.padding * 2);
  const unitsPerEm = font.unitsPerEm || 1000;

  if (horizontalFrame.width === 0 || frame.height === 0) {
    const fontSize = Math.min(availableWidth, availableHeight);
    return {
      fontSize,
      scale: fontSize / unitsPerEm
    };
  }

  const fontSize = Math.max(
    1,
    Math.min(
      (availableWidth * unitsPerEm) / horizontalFrame.width,
      (availableHeight * unitsPerEm) / frame.height
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

  const originX =
    cellOriginX(settings, fitPlan) +
    (record.leftSideBearing - record.designBounds.x1) * fitPlan.scale;
  const baselineY = cellBaselineY(settings, fitPlan);
  const path = glyph.getPath(originX, baselineY, fitPlan.fontSize);

  path.fill = "#000000";
  path.stroke = null;
  context.fillStyle = "#000000";
  context.imageSmoothingEnabled = false;
  path.draw(context);

  return canvas;
}

function createSheetCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const context = get2dContext(canvas);

  context.clearRect(0, 0, width, height);

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

function isExportableCodepoint(unicode: number): boolean {
  return (
    Number.isInteger(unicode) &&
    unicode >= 32 &&
    unicode !== 127 &&
    !(unicode >= 128 && unicode <= 159) &&
    unicode <= 0x10ffff
  );
}

function getGlyphCount(font: Font): number {
  return font.numGlyphs || font.glyphs.length || 0;
}

function sanitizeFileStem(fileName: string): string {
  return fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "font";
}

function normalizeAtlasFileName(fileName: string): string {
  const sanitized = sanitizeFileStem(fileName);
  return sanitized.toLowerCase().endsWith(".png") ? sanitized : `${stripExtension(sanitized)}.png`;
}

function normalizeCharacterOrder(characters: string): string {
  return characters.replace(/[\r\n\t]/g, "");
}

function normalizeCharacterFilterMode(mode: unknown): CharacterFilterMode {
  return typeof mode === "string" && isCharacterFilterMode(mode) ? mode : "none";
}

function isCharacterFilterMode(mode: string): mode is CharacterFilterMode {
  return mode === "none" || mode === "keep-set";
}

function makeCharacterSet(characters: string): Set<string> {
  return new Set(Array.from(characters));
}

function printableAsciiCharacters(): string {
  let characters = "";

  for (let codepoint = 32; codepoint <= 126; codepoint += 1) {
    characters += String.fromCharCode(codepoint);
  }

  return characters;
}

function uppercaseAsciiCharacters(): string {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
}

function lowercaseAsciiCharacters(): string {
  return "abcdefghijklmnopqrstuvwxyz";
}

function digitCharacters(): string {
  return "0123456789";
}

function normalizeHexColor(color: string): string {
  const value = String(color ?? "").trim();
  const shortMatch = /^#?([0-9a-fA-F]{3})$/.exec(value);

  if (shortMatch) {
    const [red, green, blue] = Array.from(shortMatch[1]);
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
  }

  const longMatch = /^#?([0-9a-fA-F]{6})$/.exec(value);

  if (longMatch) {
    return `#${longMatch[1]}`.toLowerCase();
  }

  throw new Error("Export text color must be a hex color like #ffffff.");
}

export function hexColorToRgba(color: string): RgbaTuple {
  const normalized = normalizeHexColor(color);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);

  return [red, green, blue, 255];
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteOrFallback(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
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
