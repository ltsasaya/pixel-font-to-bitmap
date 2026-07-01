import { strToU8, zipSync } from "fflate";
import type { BitmapConversionResult } from "./types";

export type BitmapZipMode = "basic" | "extended";

export async function createBitmapZip(
  result: BitmapConversionResult,
  mode: BitmapZipMode = "basic"
): Promise<Blob> {
  const metadata = mode === "extended" ? result.extendedMetadata : result.metadata;
  const files: Record<string, Uint8Array> = {
    "metadata.json": strToU8(`${JSON.stringify(metadata, null, 2)}\n`)
  };

  for (const sheet of result.sheets) {
    files[sheet.fileName] = await canvasToPngBytes(sheet.canvas);
  }

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
      } else {
        reject(new Error("Could not encode the bitmap sheet as PNG."));
      }
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}
