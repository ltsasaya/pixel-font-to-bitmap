import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFixtureFontArrayBuffer } from "../tests/fontFixture";

test("generates and exports a bitmap sheet from an uploaded font", async ({ page }, testInfo) => {
  const fontPath = await writeFixtureFont(testInfo.outputPath("fixture-pixel.ttf"));

  await page.goto("/");
  await page.getByTestId("font-file").setInputFiles(fontPath);
  await page.getByTestId("generate-button").click();

  await expect(page.getByTestId("status")).toContainText("Generated");
  await expect(page.getByTestId("glyph-count")).toHaveText("4");
  await expect(page.getByTestId("pixel-fit")).not.toHaveText("-");
  await expect(page.getByTestId("fit-report")).toContainText("binary output verified");
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
        const black =
          data[index] === 0 &&
          data[index + 1] === 0 &&
          data[index + 2] === 0 &&
          data[index + 3] === 255;
        const white =
          data[index] === 255 &&
          data[index + 1] === 255 &&
          data[index + 2] === 255 &&
          data[index + 3] === 255;

        if (!black && !white) {
          invalid += 1;
        }
      }

      return invalid;
    });
  }).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("export.zip");
  await download.saveAs(zipPath);

  const zipBytes = new Uint8Array(await readFile(zipPath));
  const files = unzipSync(zipBytes);
  const metadata = JSON.parse(strFromU8(files["metadata.json"]));

  expect(Object.keys(files)).toContain("fixture-pixel-sheet-1.png");
  expect(metadata.version).toBe(1);
  expect(metadata.font.familyName).toBe("Fixture Pixel");
  expect(metadata.raster.binaryOutput).toBe(true);
  expect(metadata.raster.outputInvalidPixels).toBe(0);
  expect(metadata.glyphs).toHaveLength(4);
  expect(metadata.glyphs.some((glyph: { name?: string; unicodes: number[] }) => {
    return glyph.name === "internal.box" && glyph.unicodes.length === 0;
  })).toBe(true);
  expect(metadata.glyphs.find((glyph: { name?: string }) => glyph.name === "A").pixels.length).toBeGreaterThan(0);
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
