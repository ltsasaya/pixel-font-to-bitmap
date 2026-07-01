import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createFixtureFontArrayBuffer,
  createSideBearingFixtureFontArrayBuffer
} from "../tests/fontFixture";

test("generates and exports a bitmap sheet from an uploaded font", async ({ page }, testInfo) => {
  const fontPath = await writeFixtureFont(testInfo.outputPath("fixture-pixel.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await expect(page.getByTestId("atlas-file")).toHaveValue("fixture-pixel.png");
  await page.getByTestId("atlas-file").fill("fixture-atlas.png");
  await page.getByTestId("characters").fill("A ");
  await page.getByTestId("export-text-color").evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = "#35c66b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("Generated");
  await expect(page.getByTestId("glyph-count")).toHaveText("2");
  await expect(page.getByTestId("pixel-fit")).not.toHaveText("-");
  await expect(page.getByTestId("fit-report")).toContainText("binary output verified");
  await expect(page.getByTestId("warnings")).toBeHidden();
  await expect(page.getByTestId("sheet-canvas")).toBeVisible();
  await expect.poll(async () => {
    return page.getByTestId("sheet-canvas").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (!context) {
        return -1;
      }

      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let invalid = 0;

      for (let index = 0; index < data.length; index += 4) {
        const blackGlyph =
          data[index] === 0 &&
          data[index + 1] === 0 &&
          data[index + 2] === 0 &&
          data[index + 3] === 255;
        const transparentEmpty =
          data[index] === 0 &&
          data[index + 1] === 0 &&
          data[index + 2] === 0 &&
          data[index + 3] === 0;

        if (!blackGlyph && !transparentEmpty) {
          invalid += 1;
        }
      }

      return invalid;
    });
  }).toBe(0);
  await expect.poll(async () => {
    return page.getByTestId("sheet-canvas").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (!context) {
        return 0;
      }

      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let blackPixels = 0;

      for (let index = 0; index < data.length; index += 4) {
        if (
          data[index] === 0 &&
          data[index + 1] === 0 &&
          data[index + 2] === 0 &&
          data[index + 3] === 255
        ) {
          blackPixels += 1;
        }
      }

      return blackPixels;
    });
  }).toBeGreaterThan(0);
  await expect.poll(async () => {
    return page.getByTestId("sheet-canvas").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (!context) {
        return -1;
      }

      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let firstBlackX = canvas.width;

      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          const index = (y * canvas.width + x) * 4;
          if (
            data[index] === 0 &&
            data[index + 1] === 0 &&
            data[index + 2] === 0 &&
            data[index + 3] === 255
          ) {
            firstBlackX = Math.min(firstBlackX, x);
          }
        }
      }

      return firstBlackX;
    });
  }).toBe(2);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("export.zip");
  await download.saveAs(zipPath);

  const zipBytes = new Uint8Array(await readFile(zipPath));
  const files = unzipSync(zipBytes);
  const metadata = JSON.parse(strFromU8(files["metadata.json"]));
  const exportedPngStats = await readPngColorStats(page, files["fixture-atlas.png"], [53, 198, 107]);

  expect(Object.keys(files)).toContain("fixture-atlas.png");
  expect(exportedPngStats).toMatchObject({
    invalidPixels: 0
  });
  expect(exportedPngStats.glyphPixels).toBeGreaterThan(0);
  expect(metadata).toEqual({
    atlas: "fixture-atlas.png",
    characters: "A ",
    cellWidth: 32,
    cellHeight: 32,
    columns: 16
  });

  const extendedDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-extended-button").click();
  const extendedDownload = await extendedDownloadPromise;
  const extendedZipPath = testInfo.outputPath("extended-export.zip");
  await extendedDownload.saveAs(extendedZipPath);

  const extendedFiles = unzipSync(new Uint8Array(await readFile(extendedZipPath)));
  const extendedMetadata = JSON.parse(strFromU8(extendedFiles["metadata.json"]));

  expect(Object.keys(extendedFiles)).toContain("fixture-atlas.png");
  expect(extendedMetadata).toMatchObject({
    atlas: "fixture-atlas.png",
    characters: "A ",
    cellWidth: 32,
    cellHeight: 32,
    columns: 16,
    format: "proportional-grid-v1",
    metrics: {
      originX: 0,
      baselineY: 28,
      lineAdvance: 32
    },
    glyphs: [
      {
        char: "A",
        codePoint: 65,
        glyphIndex: 1,
        index: 0,
        x: 2,
        y: 0,
        width: 20,
        height: 28,
        bounds: { x: 2, y: 0, width: 20, height: 28 },
        xOffset: 2,
        yOffset: -28,
        xAdvance: 24,
        empty: false
      },
      {
        char: " ",
        codePoint: 32,
        glyphIndex: 3,
        index: 1,
        x: 32,
        y: 0,
        width: 0,
        height: 0,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        xOffset: 0,
        yOffset: 0,
        xAdvance: 12,
        empty: true
      }
    ],
    characterSource: "manual",
    glyphPixel: [53, 198, 107, 255],
    emptyPixel: [0, 0, 0, 0],
    binaryAlpha: true
  });
  expect(extendedMetadata.diagnostics.binaryOutput).toBe(true);
  expect(extendedMetadata.diagnostics.outputInvalidPixels).toBe(0);
});

test("auto-detects character order when the override is blank", async ({ page }, testInfo) => {
  const fontPath = await writeFixtureFont(testInfo.outputPath("fixture-pixel.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await expect(page.getByTestId("characters")).toHaveValue(" A");
  await page.getByTestId("atlas-file").fill("auto-atlas.png");
  await page.getByTestId("characters").fill("");
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("auto-detected order");
  await expect(page.getByTestId("glyph-count")).toHaveText("2");
  await expect(page.getByTestId("warnings")).toBeHidden();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("auto-export.zip");
  await download.saveAs(zipPath);

  const files = unzipSync(new Uint8Array(await readFile(zipPath)));
  const metadata = JSON.parse(strFromU8(files["metadata.json"]));

  expect(Object.keys(files)).toContain("auto-atlas.png");
  expect(metadata.characters).toBe(" A");
});

test("preserves OpenType left side bearing when the glyph outline starts at x zero", async ({ page }, testInfo) => {
  const fontPath = await writeSideBearingFixtureFont(testInfo.outputPath("side-bearing.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await page.getByTestId("atlas-file").fill("side-bearing-atlas.png");
  await page.getByTestId("characters").fill("i");
  await page.getByTestId("cell-width").fill("20");
  await page.getByTestId("cell-height").fill("28");
  await page.getByTestId("padding").fill("0");
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("Generated");
  await expect.poll(async () => {
    return page.getByTestId("sheet-canvas").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (!context) {
        return -1;
      }

      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let firstBlackX = canvas.width;

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          if (
            data[index] === 0 &&
            data[index + 1] === 0 &&
            data[index + 2] === 0 &&
            data[index + 3] === 255
          ) {
            firstBlackX = Math.min(firstBlackX, x);
          }
        }
      }

      return firstBlackX;
    });
  }).toBe(8);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-extended-button").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("side-bearing-extended-export.zip");
  await download.saveAs(zipPath);

  const files = unzipSync(new Uint8Array(await readFile(zipPath)));
  const metadata = JSON.parse(strFromU8(files["metadata.json"]));

  expect(metadata).toMatchObject({
    atlas: "side-bearing-atlas.png",
    characters: "i",
    cellWidth: 20,
    cellHeight: 28,
    columns: 16,
    format: "proportional-grid-v1",
    glyphs: [
      {
        char: "i",
        codePoint: 105,
        glyphIndex: 1,
        index: 0,
        x: 8,
        y: 0,
        width: 4,
        height: 28,
        bounds: { x: 8, y: 0, width: 4, height: 28 },
        xOffset: 8,
        yOffset: -28,
        xAdvance: 20,
        empty: false
      }
    ]
  });
});

test("filters auto-detected characters with presets", async ({ page }, testInfo) => {
  const fontPath = await writeFixtureFont(testInfo.outputPath("fixture-pixel.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await expect(page.getByTestId("characters")).toHaveValue(" A");
  await page.getByTestId("character-filter-enabled").check();
  await page.getByTestId("character-filter-add").selectOption("uppercase");
  await page.getByTestId("add-character-filter").click();
  await expect(page.getByTestId("character-filter-set")).toHaveValue("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  await page.getByTestId("atlas-file").fill("filtered-atlas.png");
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("Generated");
  await expect(page.getByTestId("glyph-count")).toHaveText("1");
  await expect(page.getByTestId("warnings")).toBeHidden();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("filtered-export.zip");
  await download.saveAs(zipPath);

  const files = unzipSync(new Uint8Array(await readFile(zipPath)));
  const metadata = JSON.parse(strFromU8(files["metadata.json"]));

  expect(Object.keys(files)).toContain("filtered-atlas.png");
  expect(metadata.characters).toBe("A");
});

test("auto-detects the minimum cell width and height", async ({ page }, testInfo) => {
  const fontPath = await writeFixtureFont(testInfo.outputPath("fixture-pixel.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await page.getByTestId("auto-cell-size").click();

  await expect(page.getByTestId("status")).toContainText("Minimum cell size set to 6x7");
  await expect(page.getByTestId("cell-width")).toHaveValue("6");
  await expect(page.getByTestId("cell-height")).toHaveValue("7");

  await page.getByTestId("atlas-file").fill("minimum-atlas.png");
  await page.getByTestId("generate-button").click();
  await expect(page.getByTestId("status")).toContainText("Generated");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("minimum-export.zip");
  await download.saveAs(zipPath);

  const files = unzipSync(new Uint8Array(await readFile(zipPath)));
  const metadata = JSON.parse(strFromU8(files["metadata.json"]));

  expect(metadata).toMatchObject({
    atlas: "minimum-atlas.png",
    cellWidth: 6,
    cellHeight: 7
  });
});

test("warns and blocks export when requested characters are missing", async ({ page }, testInfo) => {
  const fontPath = await writeFixtureFont(testInfo.outputPath("fixture-pixel.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await page.getByTestId("characters").fill("PLAY");
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("warnings");
  await expect(page.getByTestId("warnings")).toContainText("Missing characters");
  await expect(page.getByTestId("warnings")).toContainText("P L Y");
  await expect(page.getByTestId("export-button")).toBeDisabled();
  await expect(page.getByTestId("export-extended-button")).toBeDisabled();
});

test("shows a readable error for invalid uploads", async ({ page }, testInfo) => {
  const invalidPath = testInfo.outputPath("invalid-font.ttf");
  await mkdir(path.dirname(invalidPath), { recursive: true });
  await writeFile(invalidPath, new Uint8Array([1, 2, 3, 4]));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(invalidPath);
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("Could not parse the font file");
});

async function writeFixtureFont(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(createFixtureFontArrayBuffer()));
  return filePath;
}

async function writeSideBearingFixtureFont(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(createSideBearingFixtureFontArrayBuffer()));
  return filePath;
}

async function readPngColorStats(
  page: Page,
  pngBytes: Uint8Array,
  glyphRgb: [number, number, number]
): Promise<{ glyphPixels: number; transparentPixels: number; invalidPixels: number }> {
  return page.evaluate(
    async ({ bytes, glyphRgb: expectedGlyphRgb }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not inspect exported PNG.");
      }

      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let glyphPixels = 0;
      let transparentPixels = 0;
      let invalidPixels = 0;

      for (let index = 0; index < data.length; index += 4) {
        const glyph =
          data[index] === expectedGlyphRgb[0] &&
          data[index + 1] === expectedGlyphRgb[1] &&
          data[index + 2] === expectedGlyphRgb[2] &&
          data[index + 3] === 255;
        const transparent =
          data[index] === 0 &&
          data[index + 1] === 0 &&
          data[index + 2] === 0 &&
          data[index + 3] === 0;

        if (glyph) {
          glyphPixels += 1;
        } else if (transparent) {
          transparentPixels += 1;
        } else {
          invalidPixels += 1;
        }
      }

      return { glyphPixels, transparentPixels, invalidPixels };
    },
    {
      bytes: Array.from(pngBytes),
      glyphRgb
    }
  );
}
