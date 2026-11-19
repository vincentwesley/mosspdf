import type { OpResult } from "../ops/types";

type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;

/** Save with the native file picker where it exists, else a blob link. The picker needs a click, so call this from one. */
export async function saveResult(r: OpResult): Promise<void> {
  const blob = new Blob([r.bytes as BlobPart], { type: "application/pdf" });
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker && !navigator.webdriver) { // automated browsers cannot answer the picker
    try {
      const w = await (await picker({ suggestedName: r.name, types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] })).createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user closed the picker
      /* otherwise fall back to a normal download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: r.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
