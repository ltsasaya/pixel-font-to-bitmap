import type { Path } from "opentype.js";
import { opentype } from "../src/opentypeCompat";

export function createFixtureFontArrayBuffer(): ArrayBuffer {
  const notdef = new opentype.Glyph({
    name: ".notdef",
    advanceWidth: 500,
    leftSideBearing: 60,
    path: rectanglePath(60, 0, 380, 600)
  });
  const letterA = new opentype.Glyph({
    name: "A",
    unicode: 65,
    advanceWidth: 600,
    leftSideBearing: 50,
    path: rectanglePath(50, 0, 550, 700)
  });
  const internalBox = new opentype.Glyph({
    name: "internal.box",
    advanceWidth: 600,
    leftSideBearing: 100,
    path: rectanglePath(100, 100, 500, 500)
  });
  const space = new opentype.Glyph({
    name: "space",
    unicode: 32,
    advanceWidth: 300,
    path: new opentype.Path()
  });

  const font = new opentype.Font({
    familyName: "Fixture Pixel",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, letterA, internalBox, space]
  });

  return font.toArrayBuffer();
}

export function createSideBearingFixtureFontArrayBuffer(): ArrayBuffer {
  const notdef = new opentype.Glyph({
    name: ".notdef",
    advanceWidth: 500,
    path: rectanglePath(60, 0, 380, 600)
  });
  const letterI = new opentype.Glyph({
    name: "i",
    unicode: 105,
    advanceWidth: 500,
    leftSideBearing: 200,
    path: rectanglePath(0, 0, 100, 700)
  });

  const font = new opentype.Font({
    familyName: "Side Bearing Fixture",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, letterI]
  });

  return font.toArrayBuffer();
}

function rectanglePath(x1: number, y1: number, x2: number, y2: number): Path {
  const path = new opentype.Path();
  path.moveTo(x1, y1);
  path.lineTo(x2, y1);
  path.lineTo(x2, y2);
  path.lineTo(x1, y2);
  path.closePath();
  return path;
}
