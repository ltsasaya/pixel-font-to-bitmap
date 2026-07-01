import { describe, expect, it } from "vitest";
import type { Font } from "opentype.js";
import {
  collectGlyphRecords,
  computePixelFitPlan,
  computeGlobalScale,
  inferDesignGridUnit,
  normalizeSettings,
  parseOpenTypeFont
} from "../src/converter";
import type { GlyphSourceRecord } from "../src/types";
import { createFixtureFontArrayBuffer } from "./fontFixture";

describe("font parsing", () => {
  it("parses valid OpenType buffers", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());

    expect(font.unitsPerEm).toBe(1000);
    expect(collectGlyphRecords(font)).toHaveLength(4);
  });

  it("rejects invalid font buffers with a usable error", () => {
    const invalid = new Uint8Array([1, 2, 3, 4]).buffer;

    expect(() => parseOpenTypeFont(invalid)).toThrow(/Could not parse the font file/);
  });
});

describe("glyph collection", () => {
  it("includes Unicode-mapped and unmapped glyph records", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());
    const records = collectGlyphRecords(font);

    expect(records).toHaveLength(4);
    expect(records.map((record) => record.name)).toContain("internal.box");
    expect(records.find((record) => record.name === "A")?.unicodes).toEqual([65]);
    expect(records.find((record) => record.name === "internal.box")?.unicodes).toEqual([]);
  });
});

describe("global scaling", () => {
  it("uses one scale derived from the largest visible glyph", () => {
    const records: GlyphSourceRecord[] = [
      visibleRecord(0, 0, 0, 1000, 500),
      visibleRecord(1, 0, 0, 300, 1000)
    ];
    const settings = normalizeSettings({
      cellWidth: 20,
      cellHeight: 40,
      padding: 0
    });

    const scale = computeGlobalScale({ unitsPerEm: 1000 } as Font, records, settings);

    expect(scale.fontSize).toBe(20);
    expect(scale.scale).toBe(0.02);
  });
});

describe("pixel grid fitting", () => {
  it("infers a source grid and chooses an integer output multiplier", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());
    const records = collectGlyphRecords(font);
    const settings = normalizeSettings({
      cellWidth: 32,
      cellHeight: 32,
      padding: 1
    });

    const gridUnit = inferDesignGridUnit(font, records);
    const fit = computePixelFitPlan(font, records, settings);

    expect(gridUnit).toBeDefined();
    expect(fit.strategy).toBe("inferred-grid");
    expect(Number.isInteger(fit.outputPixelsPerSourcePixel)).toBe(true);
    expect(fit.outputPixelsPerSourcePixel).toBeGreaterThanOrEqual(1);
  });
});

function visibleRecord(
  glyphIndex: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): GlyphSourceRecord {
  return {
    glyphIndex,
    name: `glyph-${glyphIndex}`,
    unicodes: [],
    designBounds: { x1, y1, x2, y2 },
    empty: false
  };
}
