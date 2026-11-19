// pdf.js on the main thread (its worker is ours, see engines.ts). Everything it needs comes from memory: no fetches after the seal.
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/build/pdf.mjs";
import { pdfjs, pdfjsData, pdfWorker } from "./engines";

/** Serves cmaps, standard fonts and wasm from memory (replaces pdf.js's fetching factory). */
class MemoryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const d = pdfjsData.get(`${kind}/${filename}`);
    if (!d) throw new Error(`pdf.js data ${kind}/${filename} was not preloaded`);
    return d;
  }
}

export async function openDoc(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer
    password,
    worker: pdfWorker,
    BinaryDataFactory: MemoryDataFactory,
    useWorkerFetch: false,
    ...({ isEvalSupported: false } as object), // no 'unsafe-eval' under our CSP
    disableFontFace: true, // glyphs are drawn as paths: no FontFace/blob font loading
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  return task.promise;
}

// At most two renders at once keeps the UI responsive on phones.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

/** Draws page `pageNo` (1-based) into `canvas`, `extraRotate` degrees on top of the page's own rotation. */
export function renderThumb(doc: PDFDocumentProxy, pageNo: number, extraRotate: number, canvas: HTMLCanvasElement, cssWidth: number): { done: Promise<void>; cancel: () => void } {
  let task: RenderTask | undefined;
  let cancelled = false;
  const done = slot(async () => {
    if (cancelled) return;
    const page = await doc.getPage(pageNo);
    const rotation = (page.rotate + extraRotate) % 360;
    const base = page.getViewport({ scale: 1, rotation });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width, rotation });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    if (cancelled) return;
    task = page.render({ canvas, viewport });
    await task.promise;
    page.cleanup();
  }).catch((e: unknown) => {
    if (!(e instanceof Error) || e.name !== "RenderingCancelledException") throw e;
  });
  return { done, cancel: () => { cancelled = true; task?.cancel(); } };
}
