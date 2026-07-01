export type BitmapMode = "one-bit-alpha-threshold";
export type SheetBackground = "transparent" | "solid";
export type RgbaTuple = [number, number, number, number];
export type CharacterFilterMode = "none" | "keep-set";
export type CharacterFilterPreset =
  | "ascii-printable"
  | "ascii-alphanumeric"
  | "uppercase"
  | "lowercase"
  | "digits"
  | "common-game";

export interface BitmapConverterSettings {
  cellWidth: number;
  cellHeight: number;
  padding: number;
  threshold: number;
  columns: number;
  atlasFileName: string;
  characters: string;
  characterFilterMode: CharacterFilterMode;
  characterFilterSet: string;
  exportTextColor: string;
  maxSheetDimension: number;
}

export interface BasicBitmapMetadata {
  atlas: string;
  characters: string;
  cellWidth: number;
  cellHeight: number;
  columns: number;
}

export interface ExtendedBitmapMetadata extends BasicBitmapMetadata {
  format: "proportional-grid-v1";
  metrics: {
    originX: number;
    baselineY: number;
    lineAdvance: number;
  };
  glyphs: ProportionalGlyphMetadata[];
  characterSource: "auto" | "manual";
  characterFilter: {
    mode: CharacterFilterMode;
    set?: string;
  };
  glyphPixel: RgbaTuple;
  emptyPixel: [0, 0, 0, 0];
  binaryAlpha: true;
  diagnostics: RasterReport;
}

export interface ProportionalGlyphMetadata {
  char: string;
  codePoint: number;
  glyphIndex: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bounds: BitmapBounds;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  empty: boolean;
}

export interface BitmapGlyphExport {
  id: string;
  glyphIndex: number;
  name?: string;
  unicodes: number[];
  sheet: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bounds: BitmapBounds;
  empty: boolean;
  pixels: string[];
}

export interface BitmapBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BitmapSheetResult {
  fileName: string;
  canvas: HTMLCanvasElement;
  previewCanvas: HTMLCanvasElement;
}

export interface BitmapConversionResult {
  metadata: BasicBitmapMetadata;
  extendedMetadata: ExtendedBitmapMetadata;
  diagnostics: RasterReport;
  sheets: BitmapSheetResult[];
  characterCount: number;
  characterSource: "auto" | "manual";
  missingCharacters: string[];
  duplicateCharacters: string[];
}

export interface MinimumCellSizeResult {
  cellWidth: number;
  cellHeight: number;
  sourceMaxGlyphWidthPixels: number;
  sourceMaxGlyphHeightPixels: number;
  sourceGridUnit: number;
  characterCount: number;
  characterSource: "auto" | "manual";
}

export interface RasterReport {
  binaryOutput: true;
  outputInvalidPixels: number;
  rawGrayPixels: number;
  rawPixelCount: number;
  rawGrayRatio: number;
  fit: {
    strategy: "inferred-grid" | "bounds-fit";
    sourceGridUnit: number;
    sourceMaxGlyphWidthPixels: number;
    sourceMaxGlyphHeightPixels: number;
    sourceAscentPixels: number;
    sourceDescentPixels: number;
    baselineOffsetPixels: number;
    outputPixelsPerSourcePixel: number;
    fontSize: number;
    scale: number;
  };
}

export interface GlyphSourceRecord {
  glyphIndex: number;
  name?: string;
  unicodes: number[];
  designBounds: DesignBounds;
  advanceWidth: number;
  leftSideBearing: number;
  empty: boolean;
}

export interface DesignBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SheetLayout {
  sheetIndex: number;
  startGlyphIndex: number;
  glyphCount: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
}

export interface CellPlacement {
  sheet: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
