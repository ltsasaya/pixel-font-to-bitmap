import { describe, expect, it } from "vitest";
import type { Font } from "opentype.js";
import {
  applyCharacterFilter,
  characterFilterPresetCharacters,
  collectGlyphRecords,
  createCharacterPlan,
  detectFontCharacterOrder,
  detectMinimumCellSizeFromBuffer,
  computePixelFitPlan,
  computeGlobalScale,
  inferDesignGridUnit,
  normalizeSettings,
  parseOpenTypeFont
} from "../src/converter";
import type { GlyphSourceRecord } from "../src/types";
import { createFixtureFontArrayBuffer, createSideBearingFixtureFontArrayBuffer } from "./fontFixture";

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
    expect(records.find((record) => record.name === "A")?.advanceWidth).toBe(600);
    expect(records.find((record) => record.name === "A")?.leftSideBearing).toBe(50);
    expect(records.find((record) => record.name === "internal.box")?.unicodes).toEqual([]);
  });

  it("keeps the OpenType left side bearing separate from path xMin", () => {
    const font = parseOpenTypeFont(createSideBearingFixtureFontArrayBuffer());
    const records = collectGlyphRecords(font);
    const letterI = records.find((record) => record.name === "i");

    expect(letterI?.designBounds.x1).toBe(0);
    expect(letterI?.leftSideBearing).toBe(200);
  });
});

describe("character order", () => {
  it("detects Unicode-mapped characters in codepoint order", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());

    expect(detectFontCharacterOrder(font)).toBe(" A");
  });

  it("filters characters with useful presets while preserving order", () => {
    expect(applyCharacterFilter(" aA0!?~", normalizeSettings({
      characterFilterMode: "keep-set",
      characterFilterSet: characterFilterPresetCharacters("ascii-printable")
    }))).toBe(" aA0!?~");
    expect(applyCharacterFilter(" aA0!?~", normalizeSettings({
      characterFilterMode: "keep-set",
      characterFilterSet: characterFilterPresetCharacters("ascii-alphanumeric")
    }))).toBe("aA0");
    expect(applyCharacterFilter(" aA0!?~", normalizeSettings({
      characterFilterMode: "keep-set",
      characterFilterSet: characterFilterPresetCharacters("uppercase")
    }))).toBe("A");
    expect(applyCharacterFilter(" aA0!?~", normalizeSettings({
      characterFilterMode: "keep-set",
      characterFilterSet: characterFilterPresetCharacters("digits")
    }))).toBe("0");
  });

  it("filters characters with a custom keep set", () => {
    const settings = normalizeSettings({
      characterFilterMode: "keep-set",
      characterFilterSet: "MAWFI"
    });

    expect(applyCharacterFilter("PLAYMAWFI", settings)).toBe("AMAWFI");
  });

  it("uses requested characters and reports missing or duplicate entries", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());
    const plan = createCharacterPlan(font, "AAZ ");

    expect(plan.entries.map((entry) => entry.character)).toEqual(["A", "A", "Z", " "]);
    expect(plan.missingCharacters).toEqual(["Z"]);
    expect(plan.duplicateCharacters).toEqual(["A"]);
    expect(plan.entries[0].missing).toBe(false);
    expect(plan.entries[2].missing).toBe(true);
  });
});

describe("global scaling", () => {
  it("defaults to zero padding", () => {
    expect(normalizeSettings({}).padding).toBe(0);
  });

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

  it("reserves shared baseline space for descenders instead of top-aligning each glyph", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());
    const records: GlyphSourceRecord[] = [
      visibleRecord(1, 50, 0, 550, 700, 500, 0),
      visibleRecord(2, 50, -200, 550, 300, 500, 0)
    ];
    const settings = normalizeSettings({
      cellWidth: 20,
      cellHeight: 20,
      padding: 1
    });

    const fit = computePixelFitPlan(font, records, settings);

    expect(fit.sourceAscentPixels).toBe(7);
    expect(fit.sourceDescentPixels).toBe(2);
    expect(fit.sourceMaxGlyphHeightPixels).toBe(9);
    expect(fit.baselineOffsetPixels).toBe(14);
  });

  it("uses left side bearing instead of tight-left-aligning glyph bounds", () => {
    const font = parseOpenTypeFont(createFixtureFontArrayBuffer());
    const records: GlyphSourceRecord[] = [
      visibleRecord(1, 0, 0, 100, 700, 500, 200),
      visibleRecord(2, 100, 100, 500, 500, 500, 100)
    ];
    const settings = normalizeSettings({
      cellWidth: 20,
      cellHeight: 24,
      padding: 0
    });

    const fit = computePixelFitPlan(font, records, settings);

    expect(fit.sourceMaxGlyphWidthPixels).toBe(5);
    expect(fit.horizontalOriginOffsetPixels).toBeCloseTo(0);
  });

  it("detects the minimum fixed cell size from source pixels plus padding", () => {
    const minimum = detectMinimumCellSizeFromBuffer(createFixtureFontArrayBuffer(), {
      padding: 1
    });

    expect(minimum).toMatchObject({
      cellWidth: 8,
      cellHeight: 9,
      sourceMaxGlyphWidthPixels: 6,
      sourceMaxGlyphHeightPixels: 7,
      sourceGridUnit: 100,
      characterCount: 2,
      characterSource: "auto"
    });
  });
});

function visibleRecord(
  glyphIndex: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  advanceWidth = x2 - x1,
  leftSideBearing = x1
): GlyphSourceRecord {
  return {
    glyphIndex,
    name: `glyph-${glyphIndex}`,
    unicodes: [],
    designBounds: { x1, y1, x2, y2 },
    advanceWidth,
    leftSideBearing,
    empty: false
  };
}
