export type BitmapMode = "one-bit-alpha-threshold";
export type SheetBackground = "transparent" | "solid";

export interface BitmapConverterSettings {
  cellWidth: number;
  cellHeight: number;
  padding: number;
  threshold: number;
  columns: number;
  background: SheetBackground;
  maxSheetDimension: number;
}

export interface BitmapExport {
  version: 1;
  font: {
    fileName: string;
    familyName?: string;
    glyphCount: number;
    unitsPerEm?: number;
  };
  settings: {
    cellWidth: number;
    cellHeight: number;
    padding: number;
    threshold: number;
    mode: BitmapMode;
    background: SheetBackground;
  };
  raster: RasterReport;
  sheets: Array<{
    fileName: string;
    width: number;
    height: number;
    columns: number;
    rows: number;
  }>;
  glyphs: BitmapGlyphExport[];
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
}

export interface BitmapConversionResult {
  metadata: BitmapExport;
  sheets: BitmapSheetResult[];
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
