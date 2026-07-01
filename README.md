# Pixel Font To Bitmap

A lightweight local browser app that converts outline pixel fonts into bitmap sheets.

Upload a TTF, OTF, WOFF, or WOFF2 font, set the maximum glyph cell size, and generate a PNG bitmap sheet plus JSON metadata. The converter parses the font file in the browser, renders every glyph record to Canvas, thresholds alpha into 1-bit pixels, and exports everything as a ZIP. No font data is sent to a server.

The exported sheet is written as strict binary pixels. In the default solid mode, every output pixel is exactly black (`0,0,0,255`) or exactly white (`255,255,255,255`). The app also reports the inferred source pixel grid, the output multiplier, and how many raw gray pixels were seen before thresholding.

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

## Export

The ZIP contains:

- `metadata.json`
- one or more `*-sheet-N.png` bitmap sheets

`metadata.json` includes font information, conversion settings, sheet layout, and one glyph record per glyph in font order. Glyph rows are stored as strings of `0` and `1` using the configured alpha threshold.

The `raster` section records:

- inferred source grid size in font units
- source glyph size in detected pixels
- output pixels per source pixel
- raw gray pixel count before thresholding
- final binary-output validation count
