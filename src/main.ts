import "./styles.css";
import { DEFAULT_SETTINGS, convertFontToBitmap, normalizeSettings } from "./converter";
import { createBitmapZip, downloadBlob } from "./exportZip";
import type { BitmapConversionResult, BitmapConverterSettings } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing application mount node.");
}

app.innerHTML = `
  <div class="workspace">
    <header class="topbar">
      <div>
        <h1>Pixel Font To Bitmap</h1>
        <p id="status" class="status" data-testid="status">No font loaded.</p>
      </div>
      <button id="export" class="button button-primary" type="button" disabled data-testid="export-button">
        Export ZIP
      </button>
    </header>

    <div class="tool-grid">
      <section class="controls" aria-label="Converter controls">
        <div class="field field-file">
          <label for="font-file">Font file</label>
          <input
            id="font-file"
            data-testid="font-file"
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          />
        </div>

        <div class="control-grid">
          <label class="field" for="cell-width">
            <span>Cell width</span>
            <input id="cell-width" type="number" min="1" max="512" step="1" value="${DEFAULT_SETTINGS.cellWidth}" />
          </label>
          <label class="field" for="cell-height">
            <span>Cell height</span>
            <input id="cell-height" type="number" min="1" max="512" step="1" value="${DEFAULT_SETTINGS.cellHeight}" />
          </label>
          <label class="field" for="padding">
            <span>Padding</span>
            <input id="padding" type="number" min="0" max="255" step="1" value="${DEFAULT_SETTINGS.padding}" />
          </label>
          <label class="field" for="threshold">
            <span>Threshold</span>
            <input id="threshold" type="number" min="0" max="255" step="1" value="${DEFAULT_SETTINGS.threshold}" />
          </label>
          <label class="field" for="columns">
            <span>Columns</span>
            <input id="columns" type="number" min="1" max="128" step="1" value="${DEFAULT_SETTINGS.columns}" />
          </label>
        </div>

        <fieldset class="field radio-group">
          <legend>Background</legend>
          <label>
            <input type="radio" name="background" value="solid" checked />
            Solid black/white
          </label>
          <label>
            <input type="radio" name="background" value="transparent" />
            Transparent
          </label>
        </fieldset>

        <button id="generate" class="button" type="button" data-testid="generate-button">
          Generate Bitmap Sheet
        </button>
      </section>

      <section class="output" aria-label="Generated output">
        <div class="metrics" aria-live="polite">
          <div>
            <span class="metric-label">Glyphs</span>
            <strong id="glyph-count" data-testid="glyph-count">0</strong>
          </div>
          <div>
            <span class="metric-label">Sheets</span>
            <strong id="sheet-count">0</strong>
          </div>
          <div>
            <span class="metric-label">Cell</span>
            <strong id="cell-size">-</strong>
          </div>
          <div>
            <span class="metric-label">Pixel fit</span>
            <strong id="pixel-fit" data-testid="pixel-fit">-</strong>
          </div>
        </div>

        <div id="fit-report" class="fit-report" data-testid="fit-report">
          Upload a font to inspect its pixel grid.
        </div>

        <div id="preview" class="preview" data-testid="preview" aria-label="Bitmap sheet preview">
          <div class="empty-state">No sheet generated.</div>
        </div>

        <div class="metadata-head">
          <h2>Glyph Metadata</h2>
          <span id="metadata-note">-</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Glyph</th>
                <th>Name</th>
                <th>Unicode</th>
                <th>Sheet</th>
                <th>Bounds</th>
              </tr>
            </thead>
            <tbody id="glyph-table">
              <tr><td colspan="5">No glyphs.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
`;

const fileInput = mustGet<HTMLInputElement>("font-file");
const generateButton = mustGet<HTMLButtonElement>("generate");
const exportButton = mustGet<HTMLButtonElement>("export");
const statusNode = mustGet<HTMLElement>("status");
const glyphCountNode = mustGet<HTMLElement>("glyph-count");
const sheetCountNode = mustGet<HTMLElement>("sheet-count");
const cellSizeNode = mustGet<HTMLElement>("cell-size");
const pixelFitNode = mustGet<HTMLElement>("pixel-fit");
const fitReportNode = mustGet<HTMLElement>("fit-report");
const previewNode = mustGet<HTMLElement>("preview");
const glyphTableNode = mustGet<HTMLTableSectionElement>("glyph-table");
const metadataNoteNode = mustGet<HTMLElement>("metadata-note");

let latestResult: BitmapConversionResult | null = null;

fileInput.addEventListener("change", () => {
  latestResult = null;
  exportButton.disabled = true;
  renderEmptyOutput(fileInput.files?.[0] ? "File ready." : "No font loaded.");
});

generateButton.addEventListener("click", () => {
  void generate();
});

exportButton.addEventListener("click", () => {
  void exportLatestResult();
});

async function generate(): Promise<void> {
  const file = fileInput.files?.[0];

  if (!file) {
    setStatus("Choose a TTF, OTF, or WOFF file first.", "error");
    return;
  }

  setBusy(true);
  setStatus("Scanning glyphs...");

  try {
    const settings = readSettings();
    const buffer = await file.arrayBuffer();
    await nextFrame();
    latestResult = await convertFontToBitmap(buffer, file.name, settings);
    renderResult(latestResult);
    setStatus(
      `Generated ${latestResult.metadata.glyphs.length} glyphs across ${latestResult.metadata.sheets.length} sheet${latestResult.metadata.sheets.length === 1 ? "" : "s"}.`,
      "success"
    );
    exportButton.disabled = false;
  } catch (error) {
    latestResult = null;
    exportButton.disabled = true;
    renderEmptyOutput("Generation failed.");
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function exportLatestResult(): Promise<void> {
  if (!latestResult) {
    return;
  }

  setBusy(true);
  setStatus("Preparing ZIP...");

  try {
    const zip = await createBitmapZip(latestResult);
    downloadBlob(zip, exportFileName(latestResult.metadata.font.fileName));
    setStatus("ZIP exported.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

function renderResult(result: BitmapConversionResult): void {
  glyphCountNode.textContent = String(result.metadata.glyphs.length);
  sheetCountNode.textContent = String(result.metadata.sheets.length);
  cellSizeNode.textContent = `${result.metadata.settings.cellWidth}x${result.metadata.settings.cellHeight}`;
  pixelFitNode.textContent = `${result.metadata.raster.fit.outputPixelsPerSourcePixel}x`;
  fitReportNode.textContent = formatFitReport(result);
  metadataNoteNode.textContent = `${result.metadata.font.familyName ?? result.metadata.font.fileName}`;

  previewNode.replaceChildren(
    ...result.sheets.map((sheet, index) => {
      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption");
      const canvas = sheet.canvas;

      canvas.setAttribute("aria-label", sheet.fileName);
      canvas.dataset.testid = index === 0 ? "sheet-canvas" : `sheet-canvas-${index + 1}`;
      caption.textContent = `${sheet.fileName} (${canvas.width}x${canvas.height})`;
      figure.append(canvas, caption);
      return figure;
    })
  );

  renderGlyphRows(result);
}

function renderGlyphRows(result: BitmapConversionResult): void {
  const fragment = document.createDocumentFragment();
  const visibleRows = result.metadata.glyphs.slice(0, 128);

  for (const glyph of visibleRows) {
    const row = document.createElement("tr");
    row.append(
      tableCell(String(glyph.glyphIndex)),
      tableCell(glyph.name ?? "-"),
      tableCell(formatUnicodes(glyph.unicodes)),
      tableCell(String(glyph.sheet + 1)),
      tableCell(
        glyph.empty
          ? "empty"
          : `${glyph.bounds.x},${glyph.bounds.y} ${glyph.bounds.width}x${glyph.bounds.height}`
      )
    );
    fragment.append(row);
  }

  if (result.metadata.glyphs.length > visibleRows.length) {
    const row = document.createElement("tr");
    row.append(tableCell(`Showing ${visibleRows.length} of ${result.metadata.glyphs.length}`, 5));
    fragment.append(row);
  }

  glyphTableNode.replaceChildren(fragment);
}

function renderEmptyOutput(statusText: string): void {
  setStatus(statusText);
  glyphCountNode.textContent = "0";
  sheetCountNode.textContent = "0";
  cellSizeNode.textContent = "-";
  pixelFitNode.textContent = "-";
  fitReportNode.textContent = "Upload a font to inspect its pixel grid.";
  metadataNoteNode.textContent = "-";
  previewNode.replaceChildren(emptyState("No sheet generated."));
  glyphTableNode.replaceChildren(tableEmptyRow());
}

function readSettings(): Partial<BitmapConverterSettings> {
  return normalizeSettings({
    cellWidth: readNumber("cell-width"),
    cellHeight: readNumber("cell-height"),
    padding: readNumber("padding"),
    threshold: readNumber("threshold"),
    columns: readNumber("columns"),
    background:
      document.querySelector<HTMLInputElement>('input[name="background"]:checked')?.value === "solid"
        ? "solid"
        : "transparent"
  });
}

function formatFitReport(result: BitmapConversionResult): string {
  const { raster } = result.metadata;
  const rawGrayPercent = (raster.rawGrayRatio * 100).toFixed(2);
  const binaryStatus =
    raster.outputInvalidPixels === 0
      ? "binary output verified"
      : `${raster.outputInvalidPixels} non-binary output pixels found`;

  return [
    `Fit: ${raster.fit.strategy}`,
    `source grid ${formatNumber(raster.fit.sourceGridUnit)} font units`,
    `${raster.fit.sourceMaxGlyphWidthPixels}x${raster.fit.sourceMaxGlyphHeightPixels} source pixels`,
    `${raster.fit.outputPixelsPerSourcePixel} output pixels per source pixel`,
    `${rawGrayPercent}% raw gray before threshold`,
    binaryStatus
  ].join(" · ");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function readNumber(id: string): number {
  return mustGet<HTMLInputElement>(id).valueAsNumber;
}

function setBusy(isBusy: boolean): void {
  generateButton.disabled = isBusy;
  exportButton.disabled = isBusy || !latestResult;
  document.body.toggleAttribute("aria-busy", isBusy);
}

function setStatus(message: string, tone: "neutral" | "success" | "error" = "neutral"): void {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);

  if (!node) {
    throw new Error(`Missing element #${id}.`);
  }

  return node as T;
}

function tableCell(text: string, colSpan?: number): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (colSpan) {
    cell.colSpan = colSpan;
  }
  return cell;
}

function tableEmptyRow(): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.append(tableCell("No glyphs.", 5));
  return row;
}

function emptyState(text: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function formatUnicodes(unicodes: number[]): string {
  if (unicodes.length === 0) {
    return "-";
  }

  return unicodes.map((unicode) => `U+${unicode.toString(16).toUpperCase().padStart(4, "0")}`).join(", ");
}

function exportFileName(fileName: string): string {
  return `${fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-") || "font"}-bitmap.zip`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
