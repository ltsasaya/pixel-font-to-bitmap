import "./styles.css";
import {
  DEFAULT_SETTINGS,
  characterFilterPresetCharacters,
  convertFontToBitmap,
  detectFontCharacterOrderFromBuffer,
  detectMinimumCellSizeFromBuffer,
  normalizeSettings
} from "./converter";
import { createBitmapZip, downloadBlob, type BitmapZipMode } from "./exportZip";
import type {
  BitmapConversionResult,
  BitmapConverterSettings,
  CharacterFilterMode,
  CharacterFilterPreset
} from "./types";

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
      <div class="export-actions">
        <div class="export-action">
          <button id="export" class="button button-primary" type="button" disabled data-testid="export-button" aria-describedby="help-export-basic">
            Export Basic ZIP
          </button>
          <span id="help-export-basic" class="export-help" role="tooltip">PNG atlas plus fixed-grid metadata.</span>
        </div>
        <div class="export-action">
          <button id="export-extended" class="button" type="button" disabled data-testid="export-extended-button" aria-describedby="help-export-extended">
            Export Extended ZIP
          </button>
          <span id="help-export-extended" class="export-help" role="tooltip">Adds proportional glyph metrics, diagnostics, and color info.</span>
        </div>
      </div>
    </header>

    <div class="tool-grid">
      <section class="controls" aria-label="Converter controls">
        <section class="control-section" aria-labelledby="source-section-title">
          <div class="section-heading">
            <h2 id="source-section-title">Source</h2>
            <p>Font file and atlas name.</p>
          </div>
          <div class="field field-file">
            <label class="field-heading" for="font-file">
              <span class="field-title">Font file</span>
              <span class="help-wrap">
                <span class="help-icon" tabindex="0" aria-describedby="help-font-file">?</span>
                <span id="help-font-file" class="field-help" role="tooltip">Upload the font to convert.</span>
              </span>
            </label>
            <input
              id="font-file"
              data-testid="font-file"
              type="file"
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
            />
          </div>

          <label class="field" for="atlas-file">
            <span class="field-heading">
              <span class="field-title">Atlas filename</span>
              <span class="help-wrap">
                <span class="help-icon" tabindex="0" aria-describedby="help-atlas-file">?</span>
                <span id="help-atlas-file" class="field-help" role="tooltip">PNG name used in metadata.</span>
              </span>
            </span>
            <input id="atlas-file" data-testid="atlas-file" type="text" value="${DEFAULT_SETTINGS.atlasFileName}" placeholder="font-name.png" />
          </label>
        </section>

        <section class="control-section" aria-labelledby="characters-section-title">
          <div class="section-heading">
            <h2 id="characters-section-title">Characters</h2>
            <p>Order and optional filtering.</p>
          </div>
          <label class="field" for="characters">
            <span class="field-heading">
              <span class="field-title">Character order override</span>
              <span class="help-wrap">
                <span class="help-icon" tabindex="0" aria-describedby="help-characters">?</span>
                <span id="help-characters" class="field-help" role="tooltip">Blank auto-detects Unicode order.</span>
              </span>
            </span>
            <textarea id="characters" data-testid="characters" rows="4" placeholder="Leave blank to auto-detect Unicode character order from the font.">${DEFAULT_SETTINGS.characters}</textarea>
          </label>

          <div class="subsection">
            <div class="subsection-heading">
              <span>Filter add-on</span>
              <p>Build a keep set from presets or typed characters.</p>
            </div>
            <div class="character-filter-panel">
              <label class="filter-toggle" for="character-filter-enabled">
                <input id="character-filter-enabled" data-testid="character-filter-enabled" type="checkbox" />
                <span class="field-title">Filter</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-character-filter">?</span>
                  <span id="help-character-filter" class="field-help" role="tooltip">Keeps only characters in the set.</span>
                </span>
              </label>

              <div id="character-filter-options" class="character-filter-options" hidden>
                <label class="field" for="character-filter-add">
                  <span class="field-heading">
                    <span class="field-title">Add to filter</span>
                    <span class="help-wrap">
                      <span class="help-icon" tabindex="0" aria-describedby="help-character-filter-add">?</span>
                      <span id="help-character-filter-add" class="field-help" role="tooltip">Adds preset characters below.</span>
                    </span>
                  </span>
                  <span class="filter-add-row">
                    <select id="character-filter-add" data-testid="character-filter-add">
                      <option value="uppercase">Uppercase A-Z</option>
                      <option value="lowercase">Lowercase a-z</option>
                      <option value="digits">Digits 0-9</option>
                      <option value="ascii-alphanumeric">ASCII letters and digits</option>
                      <option value="ascii-printable">Standard ASCII printable</option>
                      <option value="common-game">Common game text</option>
                    </select>
                    <button id="add-character-filter" class="button" type="button" data-testid="add-character-filter">
                      Add
                    </button>
                  </span>
                </label>

                <label class="field" for="character-filter-set">
                  <span class="field-heading">
                    <span class="field-title">Keep set</span>
                    <span class="help-wrap">
                      <span class="help-icon" tabindex="0" aria-describedby="help-character-filter-set">?</span>
                      <span id="help-character-filter-set" class="field-help" role="tooltip">Editable characters to keep.</span>
                    </span>
                  </span>
                  <textarea id="character-filter-set" data-testid="character-filter-set" rows="3" placeholder="Add a preset or type characters to keep."></textarea>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section class="control-section" aria-labelledby="cell-section-title">
          <div class="section-heading">
            <h2 id="cell-section-title">Cell Size</h2>
            <p>Grid size and glyph margins.</p>
          </div>
          <div class="control-grid">
            <div class="field auto-cell-field">
              <div class="field-heading">
                <span class="field-title">Auto cell size</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-auto-cell-size">?</span>
                  <span id="help-auto-cell-size" class="field-help" role="tooltip">Smallest 1x cell that fits.</span>
                </span>
              </div>
              <button id="auto-cell-size" class="button" type="button" data-testid="auto-cell-size">
                Auto-detect Minimum Cell Size
              </button>
            </div>
            <label class="field" for="cell-width">
              <span class="field-heading">
                <span class="field-title">Cell width</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-cell-width">?</span>
                  <span id="help-cell-width" class="field-help" role="tooltip">Pixel width of each grid cell.</span>
                </span>
              </span>
              <input id="cell-width" data-testid="cell-width" type="number" min="1" max="512" step="1" value="${DEFAULT_SETTINGS.cellWidth}" />
            </label>
            <label class="field" for="cell-height">
              <span class="field-heading">
                <span class="field-title">Cell height</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-cell-height">?</span>
                  <span id="help-cell-height" class="field-help" role="tooltip">Pixel height of each grid cell.</span>
                </span>
              </span>
              <input id="cell-height" data-testid="cell-height" type="number" min="1" max="512" step="1" value="${DEFAULT_SETTINGS.cellHeight}" />
            </label>
            <label class="field" for="padding">
              <span class="field-heading">
                <span class="field-title">Padding</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-padding">?</span>
                  <span id="help-padding" class="field-help" role="tooltip">Empty pixels around each glyph.</span>
                </span>
              </span>
              <input id="padding" data-testid="padding" type="number" min="0" max="255" step="1" value="${DEFAULT_SETTINGS.padding}" />
            </label>
          </div>
        </section>

        <section class="control-section" aria-labelledby="tuning-section-title">
          <div class="section-heading">
            <h2 id="tuning-section-title">Tuning</h2>
            <p>Pixel detection sensitivity.</p>
          </div>
          <div class="control-grid">
            <label class="field" for="threshold">
              <span class="field-heading">
                <span class="field-title">Threshold</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-threshold">?</span>
                  <span id="help-threshold" class="field-help" role="tooltip">Alpha cutoff for filled pixels.</span>
                </span>
              </span>
              <input id="threshold" type="number" min="0" max="255" step="1" value="${DEFAULT_SETTINGS.threshold}" />
            </label>
          </div>
        </section>

        <section class="control-section" aria-labelledby="raster-section-title">
          <div class="section-heading">
            <h2 id="raster-section-title">Raster Output</h2>
            <p>Export glyph color.</p>
          </div>
          <div class="control-grid">
            <label class="field" for="export-text-color">
              <span class="field-heading">
                <span class="field-title">Export text color</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-export-text-color">?</span>
                  <span id="help-export-text-color" class="field-help" role="tooltip">Glyph color in the PNG export.</span>
                </span>
              </span>
              <input id="export-text-color" data-testid="export-text-color" type="color" value="${DEFAULT_SETTINGS.exportTextColor}" />
            </label>
          </div>
        </section>

        <section class="control-section" aria-labelledby="layout-section-title">
          <div class="section-heading">
            <h2 id="layout-section-title">Layout</h2>
            <p>Atlas row wrapping.</p>
          </div>
          <div class="control-grid">
            <label class="field" for="columns">
              <span class="field-heading">
                <span class="field-title">Columns</span>
                <span class="help-wrap">
                  <span class="help-icon" tabindex="0" aria-describedby="help-columns">?</span>
                  <span id="help-columns" class="field-help" role="tooltip">Cells per row in the atlas.</span>
                </span>
              </span>
              <input id="columns" type="number" min="1" max="128" step="1" value="${DEFAULT_SETTINGS.columns}" />
            </label>
          </div>
        </section>

        <div id="warnings" class="warnings" data-testid="warnings" hidden></div>

        <button id="generate" class="button" type="button" data-testid="generate-button">
          Generate Bitmap Atlas
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
          <h2>Basic Metadata Preview</h2>
          <span id="metadata-note">-</span>
        </div>
        <pre id="metadata-preview" class="metadata-preview" data-testid="metadata-preview">No metadata.</pre>
      </section>
    </div>
  </div>
`;

const fileInput = mustGet<HTMLInputElement>("font-file");
const generateButton = mustGet<HTMLButtonElement>("generate");
const exportButton = mustGet<HTMLButtonElement>("export");
const exportExtendedButton = mustGet<HTMLButtonElement>("export-extended");
const statusNode = mustGet<HTMLElement>("status");
const glyphCountNode = mustGet<HTMLElement>("glyph-count");
const sheetCountNode = mustGet<HTMLElement>("sheet-count");
const cellSizeNode = mustGet<HTMLElement>("cell-size");
const pixelFitNode = mustGet<HTMLElement>("pixel-fit");
const fitReportNode = mustGet<HTMLElement>("fit-report");
const previewNode = mustGet<HTMLElement>("preview");
const metadataPreviewNode = mustGet<HTMLElement>("metadata-preview");
const metadataNoteNode = mustGet<HTMLElement>("metadata-note");
const warningsNode = mustGet<HTMLElement>("warnings");
const atlasFileNameInput = mustGet<HTMLInputElement>("atlas-file");
const charactersInput = mustGet<HTMLTextAreaElement>("characters");
const characterFilterEnabledInput = mustGet<HTMLInputElement>("character-filter-enabled");
const characterFilterOptionsNode = mustGet<HTMLElement>("character-filter-options");
const characterFilterAddInput = mustGet<HTMLSelectElement>("character-filter-add");
const characterFilterSetInput = mustGet<HTMLTextAreaElement>("character-filter-set");
const addCharacterFilterButton = mustGet<HTMLButtonElement>("add-character-filter");
const autoCellSizeButton = mustGet<HTMLButtonElement>("auto-cell-size");

let latestResult: BitmapConversionResult | null = null;
let atlasFileNameEdited = false;
let characterOrderEdited = false;

atlasFileNameInput.addEventListener("input", () => {
  atlasFileNameEdited = atlasFileNameInput.value.length > 0;
});

charactersInput.addEventListener("input", () => {
  characterOrderEdited = charactersInput.value.length > 0;
});

characterFilterEnabledInput.addEventListener("change", () => {
  renderCharacterFilterState();
});

addCharacterFilterButton.addEventListener("click", () => {
  addPresetToCharacterFilter();
});

fileInput.addEventListener("change", () => {
  latestResult = null;
  exportButton.disabled = true;
  exportExtendedButton.disabled = true;
  hideWarnings();
  autoFillAtlasFileName(fileInput.files?.[0]);
  renderEmptyOutput(fileInput.files?.[0] ? "File ready." : "No font loaded.");
  void autoDetectCharacterOrder();
});

generateButton.addEventListener("click", () => {
  void generate();
});

autoCellSizeButton.addEventListener("click", () => {
  void autoDetectMinimumCellSize();
});

exportButton.addEventListener("click", () => {
  void exportLatestResult("basic");
});

exportExtendedButton.addEventListener("click", () => {
  void exportLatestResult("extended");
});

renderCharacterFilterState();

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
    renderWarnings(latestResult);

    if (hasBlockingWarnings(latestResult)) {
      setStatus("Atlas generated with warnings. Fix the character order before export.", "warning");
      exportButton.disabled = true;
      exportExtendedButton.disabled = true;
    } else {
      setStatus(
        `Generated ${latestResult.characterCount} fixed-grid characters into ${latestResult.metadata.atlas}${latestResult.characterSource === "auto" ? " using auto-detected order" : ""}.`,
        "success"
      );
      exportButton.disabled = false;
      exportExtendedButton.disabled = false;
    }
  } catch (error) {
    latestResult = null;
    exportButton.disabled = true;
    exportExtendedButton.disabled = true;
    hideWarnings();
    renderEmptyOutput("Generation failed.");
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function exportLatestResult(mode: BitmapZipMode): Promise<void> {
  if (!latestResult) {
    return;
  }

  if (hasBlockingWarnings(latestResult)) {
    renderWarnings(latestResult);
    setStatus("Export blocked until missing or duplicate characters are fixed.", "warning");
    return;
  }

  setBusy(true);
  setStatus("Preparing ZIP...");

  try {
    const zip = await createBitmapZip(latestResult, mode);
    downloadBlob(zip, exportFileName(latestResult.metadata.atlas, mode));
    setStatus(`${mode === "extended" ? "Extended" : "Basic"} ZIP exported.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

function renderResult(result: BitmapConversionResult): void {
  glyphCountNode.textContent = String(result.characterCount);
  sheetCountNode.textContent = String(result.sheets.length);
  cellSizeNode.textContent = `${result.metadata.cellWidth}x${result.metadata.cellHeight}`;
  pixelFitNode.textContent = `${result.diagnostics.fit.outputPixelsPerSourcePixel}x`;
  fitReportNode.textContent = formatFitReport(result);
  metadataNoteNode.textContent = result.metadata.atlas;
  metadataPreviewNode.textContent = JSON.stringify(result.metadata, null, 2);

  previewNode.replaceChildren(
    ...result.sheets.map((sheet, index) => {
      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption");
      const canvas = sheet.previewCanvas;

      canvas.setAttribute("aria-label", sheet.fileName);
      canvas.dataset.testid = index === 0 ? "sheet-canvas" : `sheet-canvas-${index + 1}`;
      caption.textContent = `${sheet.fileName} (${canvas.width}x${canvas.height})`;
      figure.append(canvas, caption);
      return figure;
    })
  );
}

function renderEmptyOutput(statusText: string): void {
  setStatus(statusText);
  glyphCountNode.textContent = "0";
  sheetCountNode.textContent = "0";
  cellSizeNode.textContent = "-";
  pixelFitNode.textContent = "-";
  fitReportNode.textContent = "Upload a font to inspect its pixel grid.";
  metadataNoteNode.textContent = "-";
  metadataPreviewNode.textContent = "No metadata.";
  previewNode.replaceChildren(emptyState("No sheet generated."));
}

function autoFillAtlasFileName(file?: File): void {
  if (!file || atlasFileNameEdited) {
    return;
  }

  atlasFileNameInput.value = `${file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-") || "font"}.png`;
}

function renderCharacterFilterState(): void {
  const enabled = characterFilterEnabledInput.checked;

  characterFilterOptionsNode.hidden = !enabled;
  characterFilterAddInput.disabled = !enabled;
  addCharacterFilterButton.disabled = !enabled;
  characterFilterSetInput.disabled = !enabled;
}

function addPresetToCharacterFilter(): void {
  characterFilterEnabledInput.checked = true;
  renderCharacterFilterState();

  const preset = characterFilterAddInput.value as CharacterFilterPreset;
  const nextCharacters = appendUniqueCharacters(
    characterFilterSetInput.value,
    characterFilterPresetCharacters(preset)
  );

  characterFilterSetInput.value = nextCharacters;
  setStatus(`Added ${Array.from(characterFilterPresetCharacters(preset)).length} preset characters to the filter.`);
}

function appendUniqueCharacters(current: string, additions: string): string {
  let result = current;
  const seen = new Set(Array.from(current));

  for (const character of Array.from(additions)) {
    if (!seen.has(character)) {
      result += character;
      seen.add(character);
    }
  }

  return result;
}

async function autoDetectCharacterOrder(): Promise<void> {
  const file = fileInput.files?.[0];

  if (!file || characterOrderEdited) {
    return;
  }

  try {
    const detectedCharacters = detectFontCharacterOrderFromBuffer(await file.arrayBuffer());

    if (characterOrderEdited) {
      return;
    }

    if (detectedCharacters.length === 0) {
      setStatus("No Unicode-mapped characters were found. Enter a character order manually.", "warning");
      return;
    }

    charactersInput.value = detectedCharacters;
    setStatus(`Auto-detected ${Array.from(detectedCharacters).length} characters.`);
  } catch {
    setStatus("File ready.");
  }
}

async function autoDetectMinimumCellSize(): Promise<void> {
  const file = fileInput.files?.[0];

  if (!file) {
    setStatus("Choose a font before auto-detecting cell size.", "error");
    return;
  }

  autoCellSizeButton.disabled = true;
  setStatus("Detecting minimum cell size...");

  try {
    const minimum = detectMinimumCellSizeFromBuffer(await file.arrayBuffer(), {
      characters: characterOrderEdited ? charactersInput.value : "",
      characterFilterMode: readCharacterFilterMode(),
      characterFilterSet: characterFilterSetInput.value,
      padding: readNumber("padding")
    });

    mustGet<HTMLInputElement>("cell-width").value = String(minimum.cellWidth);
    mustGet<HTMLInputElement>("cell-height").value = String(minimum.cellHeight);
    setStatus(
      `Minimum cell size set to ${minimum.cellWidth}x${minimum.cellHeight} from ${minimum.characterCount} ${minimum.characterSource === "auto" ? "auto-detected" : "selected"} characters.`,
      "success"
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    autoCellSizeButton.disabled = false;
  }
}

function readSettings(): Partial<BitmapConverterSettings> {
  return normalizeSettings({
    atlasFileName: atlasFileNameInput.value,
    characters: characterOrderEdited ? charactersInput.value : "",
    characterFilterMode: readCharacterFilterMode(),
    characterFilterSet: characterFilterSetInput.value,
    cellWidth: readNumber("cell-width"),
    cellHeight: readNumber("cell-height"),
    padding: readNumber("padding"),
    threshold: readNumber("threshold"),
    exportTextColor: mustGet<HTMLInputElement>("export-text-color").value,
    columns: readNumber("columns")
  });
}

function formatFitReport(result: BitmapConversionResult): string {
  const raster = result.diagnostics;
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

function renderWarnings(result: BitmapConversionResult): void {
  const warnings: string[] = [];

  if (result.missingCharacters.length > 0) {
    warnings.push(`Missing characters: ${formatCharacters(result.missingCharacters)}`);
  }

  if (result.duplicateCharacters.length > 0) {
    warnings.push(`Duplicate characters: ${formatCharacters(result.duplicateCharacters)}`);
  }

  if (result.diagnostics.outputInvalidPixels > 0) {
    warnings.push(`${result.diagnostics.outputInvalidPixels} non-binary alpha pixels found.`);
  }

  if (warnings.length === 0) {
    hideWarnings();
    return;
  }

  warningsNode.hidden = false;
  warningsNode.replaceChildren(
    ...warnings.map((warning) => {
      const item = document.createElement("div");
      item.textContent = warning;
      return item;
    })
  );
}

function hideWarnings(): void {
  warningsNode.hidden = true;
  warningsNode.replaceChildren();
}

function hasBlockingWarnings(result: BitmapConversionResult): boolean {
  return (
    result.missingCharacters.length > 0 ||
    result.duplicateCharacters.length > 0 ||
    result.diagnostics.outputInvalidPixels > 0
  );
}

function formatCharacters(characters: string[]): string {
  return characters.map((character) => (character === " " ? "[space]" : character)).join(" ");
}

function readNumber(id: string): number {
  return mustGet<HTMLInputElement>(id).valueAsNumber;
}

function readCharacterFilterMode(): CharacterFilterMode {
  return characterFilterEnabledInput.checked ? "keep-set" : "none";
}

function setBusy(isBusy: boolean): void {
  generateButton.disabled = isBusy;
  autoCellSizeButton.disabled = isBusy;
  const exportDisabled = isBusy || !latestResult || hasBlockingWarnings(latestResult);
  exportButton.disabled = exportDisabled;
  exportExtendedButton.disabled = exportDisabled;
  document.body.toggleAttribute("aria-busy", isBusy);
}

function setStatus(
  message: string,
  tone: "neutral" | "success" | "warning" | "error" = "neutral"
): void {
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

function emptyState(text: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function exportFileName(fileName: string, mode: BitmapZipMode): string {
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-") || "font";
  return `${baseName}-${mode === "extended" ? "extended" : "basic"}-bitmap.zip`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
