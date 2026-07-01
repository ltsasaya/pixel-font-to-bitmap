import { describe, expect, it } from "vitest";
import {
  alphaToBinaryRgba,
  alphaToBitmapRows,
  countInvalidBinaryPixels,
  createSheetLayouts,
  getCellPlacement
} from "../src/bitmap";

describe("alphaToBitmapRows", () => {
  it("converts alpha data to tight 1-bit rows", () => {
    const rgba = new Uint8ClampedArray(4 * 3 * 4);
    setAlpha(rgba, 4, 1, 0, 255);
    setAlpha(rgba, 4, 2, 1, 200);
    setAlpha(rgba, 4, 1, 2, 129);

    expect(alphaToBitmapRows(rgba, 4, 3, 128)).toEqual({
      empty: false,
      bounds: { x: 1, y: 0, width: 2, height: 3 },
      pixels: ["10", "01", "10"]
    });
  });

  it("treats alpha values at or below the threshold as empty", () => {
    const rgba = new Uint8ClampedArray(2 * 2 * 4);
    setAlpha(rgba, 2, 0, 0, 128);

    expect(alphaToBitmapRows(rgba, 2, 2, 128)).toEqual({
      empty: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      pixels: []
    });
  });

  it("rejects inconsistent image data", () => {
    expect(() => alphaToBitmapRows(new Uint8ClampedArray(3), 2, 2, 128)).toThrow(
      /RGBA data/
    );
  });
});

describe("alphaToBinaryRgba", () => {
  it("writes only exact black and exact white pixels for solid sheets", () => {
    const rgba = new Uint8ClampedArray(3 * 1 * 4);
    setAlpha(rgba, 3, 0, 0, 0);
    setAlpha(rgba, 3, 1, 0, 127);
    setAlpha(rgba, 3, 2, 0, 200);

    const result = alphaToBinaryRgba(rgba, 3, 1, 128, "solid");

    expect([...result.rgba]).toEqual([
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255
    ]);
    expect(result.sourceGrayPixels).toBe(2);
    expect(result.outputInvalidPixels).toBe(0);
    expect(countInvalidBinaryPixels(result.rgba, "solid")).toBe(0);
  });

  it("writes exact white glyphs and zero-alpha empty pixels in transparent mode", () => {
    const rgba = new Uint8ClampedArray(2 * 1 * 4);
    setAlpha(rgba, 2, 0, 0, 0);
    setAlpha(rgba, 2, 1, 0, 255);

    const result = alphaToBinaryRgba(rgba, 2, 1, 128, "transparent");

    expect([...result.rgba]).toEqual([
      0, 0, 0, 0,
      255, 255, 255, 255
    ]);
    expect(result.outputInvalidPixels).toBe(0);
  });

  it("writes exact selected-color glyphs in transparent mode", () => {
    const rgba = new Uint8ClampedArray(2 * 1 * 4);
    setAlpha(rgba, 2, 0, 0, 0);
    setAlpha(rgba, 2, 1, 0, 255);

    const result = alphaToBinaryRgba(rgba, 2, 1, 128, "transparent", [53, 198, 107, 255]);

    expect([...result.rgba]).toEqual([
      0, 0, 0, 0,
      53, 198, 107, 255
    ]);
    expect(result.outputInvalidPixels).toBe(0);
    expect(countInvalidBinaryPixels(result.rgba, "transparent", [53, 198, 107, 255])).toBe(0);
  });
});

describe("sheet packing", () => {
  it("clamps columns to the maximum sheet dimension and creates multiple sheets", () => {
    const layouts = createSheetLayouts(10, 8, 8, 3, 16);

    expect(layouts).toEqual([
      {
        sheetIndex: 0,
        startGlyphIndex: 0,
        glyphCount: 4,
        width: 16,
        height: 16,
        columns: 2,
        rows: 2
      },
      {
        sheetIndex: 1,
        startGlyphIndex: 4,
        glyphCount: 4,
        width: 16,
        height: 16,
        columns: 2,
        rows: 2
      },
      {
        sheetIndex: 2,
        startGlyphIndex: 8,
        glyphCount: 2,
        width: 16,
        height: 8,
        columns: 2,
        rows: 1
      }
    ]);
  });

  it("returns deterministic cell placements", () => {
    const layouts = createSheetLayouts(6, 5, 7, 2, 64);

    expect(getCellPlacement(3, layouts, 5, 7)).toEqual({
      sheet: 0,
      x: 5,
      y: 7,
      width: 5,
      height: 7
    });
  });
});

function setAlpha(
  rgba: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  alpha: number
): void {
  rgba[(y * width + x) * 4 + 3] = alpha;
}
