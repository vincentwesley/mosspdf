import { zipSync } from "fflate";
import type { OpResult } from "../ops/types";

type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", zip: "application/zip", txt: "text/plain", json: "application/json" };
const extOf = (name: string) => name.split(".").pop()!.toLowerCase();

/** Save with the native file picker where it exists, else a blob link. The picker needs a click, so call this from one. */
async function save(blob: Blob, name: string): Promise<void> {
  const ext = extOf(name);
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker && !navigator.webdriver) { // automated browsers cannot answer the picker
    try {
      const w = await (await picker({ suggestedName: name, types: [{ description: ext.toUpperCase(), accept: { [blob.type]: [`.${ext}`] } }] })).createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user closed the picker
      /* otherwise fall back to a normal download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const saveResult = (r: OpResult) => save(new Blob([r.bytes as BlobPart], { type: MIME[extOf(r.name)] ?? "application/octet-stream" }), r.name);

/** Every result in one .zip (stored, not compressed: PDFs and images are already compressed). Repeated names get -2, -3. */
export function saveZip(results: OpResult[], zipName: string): Promise<void> {
  const seen = new Map<string, number>();
  const files: Record<string, Uint8Array> = {};
  for (const r of results) {
    const n = (seen.get(r.name) ?? 0) + 1;
    seen.set(r.name, n);
    files[n === 1 ? r.name : r.name.replace(/(\.[^.]*)?$/, `-${n}$1`)] = r.bytes;
  }
  return save(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: MIME.zip }), zipName);
}
