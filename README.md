# Pixel Font To Bitmap

A lightweight local browser app that converts outline pixel fonts into fixed-grid bitmap atlases with optional proportional glyph metadata.

Upload a TTF, OTF, WOFF, or WOFF2 font, set the fixed cell size, and generate a transparent PNG atlas plus JSON metadata. The converter auto-detects Unicode-mapped characters from the font, renders them to Canvas, thresholds alpha into 1-bit pixels, and exports everything as a ZIP. No font data is sent to a server.

The preview is always shown with black glyphs on a checkerboard so the characters are easy to inspect. The exported atlas uses the Export text color setting and is written as strict binary pixels:

- glyph pixel: selected RGB color with alpha `255`
- empty pixel: `0,0,0,0`

The app also reports the inferred source pixel grid, the output multiplier, and how many raw gray pixels were seen before thresholding.

## Features

- Browser-only font conversion with no backend upload.
- TTF, OTF, WOFF, and WOFF2 input through `opentype.js`.
- Binary transparent PNG output: every exported pixel is either the selected glyph color with alpha `255` or transparent `0,0,0,0`.
- Black preview regardless of export color, so white/tintable exports remain visible while editing.
- Auto-detected Unicode character order, plus manual character order override.
- Optional character filtering through editable keep sets and presets.
- Auto-detected minimum cell size based on the inferred source pixel grid.
- Fixed-grid Basic export for simple renderers.
- Extended export with per-character source rectangles, offsets, advances, and diagnostics for proportional rendering.

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Build And Test

```bash
npm run test
npm run build
npm run test:e2e
```

If Playwright reports that Chromium is missing:

```bash
npx playwright install chromium
```

## Project Structure

- `src/main.ts`: Browser UI, input handling, preview rendering, and export buttons.
- `src/converter.ts`: Font parsing, character resolution, pixel-grid fitting, glyph rasterization, and metadata creation.
- `src/bitmap.ts`: Alpha thresholding, binary pixel validation, bounds detection, and atlas sheet layout helpers.
- `src/exportZip.ts`: ZIP creation and PNG export.
- `src/types.ts`: Export metadata and converter type definitions.
- `tests/`: Unit tests for parsing, fitting, filtering, and bitmap conversion helpers.
- `e2e/`: Playwright tests for the browser workflow and generated ZIP contents.

## Export Basic ZIP

The ZIP contains:

- `metadata.json`
- the atlas PNG named by the Atlas filename field

The Atlas filename field starts blank, then fills from the uploaded font filename. Edit it before export if the PNG name should differ.

`metadata.json` uses a standard fixed-grid bitmap mapping:

```json
{
  "atlas": "my-font.png",
  "characters": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?.,",
  "cellWidth": 8,
  "cellHeight": 8,
  "columns": 16
}
```

Any renderer can calculate a character cell with this fixed-grid formula:

```text
index = position of character in characters
column = index % columns
row = index / columns
x = column * cellWidth
y = row * cellHeight
```

## Export Extended ZIP

The Extended export writes the same atlas PNG but includes extra metadata for proportional rendering and debugging:

```json
{
  "atlas": "my-font.png",
  "characters": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?.,",
  "cellWidth": 8,
  "cellHeight": 8,
  "columns": 16,
  "format": "proportional-grid-v1",
  "metrics": {
    "originX": 0,
    "baselineY": 7,
    "lineAdvance": 8
  },
  "glyphs": [
    {
      "char": "A",
      "codePoint": 65,
      "glyphIndex": 1,
      "index": 0,
      "x": 1,
      "y": 0,
      "width": 5,
      "height": 7,
      "bounds": { "x": 1, "y": 0, "width": 5, "height": 7 },
      "xOffset": 1,
      "yOffset": -7,
      "xAdvance": 6,
      "empty": false
    }
  ],
  "characterSource": "auto",
  "glyphPixel": [255, 255, 255, 255],
  "emptyPixel": [0, 0, 0, 0],
  "binaryAlpha": true,
  "diagnostics": {}
}
```

For proportional rendering, draw each extended glyph from its atlas rectangle at
`cursorX + xOffset` and `baselineY + yOffset`, then advance by `xAdvance`.
Empty glyphs such as spaces draw nothing but still advance the cursor.

Basic export is intentionally simple and may render text as monospaced if the renderer uses only cell positions. Use Extended export when letters such as `i`, punctuation, or spaces need to preserve the font's natural side bearings and advance widths.

## Validation

- Leave Character order override blank to auto-detect Unicode character order from the font.
- Type a custom order when you want a smaller game-specific alphabet.
- Enable Filter to keep only characters in the editable keep set. Presets such as printable ASCII, letters/digits, uppercase, lowercase, digits, and common game text add characters into that set.
- Missing custom-requested characters are shown before export.
- Duplicate characters are blocked because character lookup would be ambiguous.
- Extended export includes per-character proportional metrics for renderers that should not be monospaced.
- Transparent atlas pixels are validated so alpha is only `0` or `255`.
- Export text color controls PNG glyph RGB values; the preview remains black for readability.
- Unmapped internal glyphs cannot be auto-detected because they do not have Unicode characters to look up.

## Git Notes

The repository tracks source, tests, fixtures, and documentation. Generated or local-only files are ignored in `.gitignore`, including:

- `node_modules/`
- `dist/`
- `coverage/`
- `playwright-report/`
- `test-results/`
- `.gstack/`
- `.DS_Store`
- `*.local`
- `*.tsbuildinfo`

Before pushing behavior changes, run:

```bash
npm run check
```

That command runs unit tests, TypeScript/build validation, and Playwright browser tests.
