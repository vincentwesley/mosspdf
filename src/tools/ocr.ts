// OCR (M5). Pages are drawn with pdf.js here on the main thread; the OCR worker reads them one at a time (D16); the ops worker
// adds the invisible text layer. Cancel is checked between pages: one page is one synchronous wasm call, and the worker is never
// terminated because a new one could not be created once the page is sealed.
import { ocrLangs, ocrRpc } from "../core/engines";
import { chosenLangs, hashFor, loadSize, OCR_LANGS, saveLangs } from "../core/ocrlangs";
import { store } from "../core/store";
import type { OcrPage } from "../ops";
import type { OcrWord } from "../engines/ocr";
import { PdfError, type OpResult } from "../ops/types";
import { h, plural } from "../ui/dom";
import { checkField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
const DPI = 200;
/** Keeps one page bitmap (and its PNG) a few tens of MB. */
const MAX_PIXELS = 12_000_000;

const same = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c));

const ui = (ctx: Ctx) => ctx.local(() => {
  const start = ocrRpc ? ocrLangs : chosenLangs();
  const langs = OCR_LANGS.map((l) => checkField({
    id: `ocr-lang-${l.code}`, label: l.label, checked: start.includes(l.code), testid: `ocr-lang-${l.code}`,
    onChange() { if (!picked().length) langs.find((x) => x.input.id === `ocr-lang-${l.code}`)!.input.checked = true; /* at least one */ ctx.refresh(); },
  }));
  const picked = () => OCR_LANGS.map((l) => l.code).filter((_, i) => langs[i].input.checked);
  const load = h("button", { class: "hs-btn hs-btn--secondary", type: "button", attrs: { "data-testid": "ocr-load" }, on: { click: () => { saveLangs(picked()); location.hash = hashFor(picked()); location.reload(); } } });
  const msg = h("p");
  const clears = h("p", { class: "field__hint", text: "Files you added in this tab will be cleared.", attrs: { "data-testid": "ocr-load-clears" } });
  return {
    langs, picked, load, msg,
    lang: h("fieldset", { class: "radios", attrs: { "data-testid": "ocr-langs" } }, h("legend", { text: "Languages" }), ...langs.map((f) => f.el)),
    skip: checkField({ id: "ocr-skip", label: "Skip pages that already have text", checked: true, testid: "ocr-skip", onChange: () => ctx.refresh() }),
    clean: checkField({ id: "ocr-clean", label: "Clean up scans first (grey, stronger contrast)", checked: false, testid: "ocr-clean", onChange: () => ctx.refresh() }),
    pdf: checkField({ id: "ocr-out-pdf", label: "Searchable PDF", checked: true, testid: "ocr-out-pdf", onChange: () => ctx.refresh() }),
    txt: checkField({ id: "ocr-out-txt", label: "Plain text (.txt)", checked: false, testid: "ocr-out-txt", onChange: () => ctx.refresh() }),
    missing: h("div", { class: "hs-banner hs-banner--info", attrs: { "data-testid": "ocr-missing", role: "note" } }, msg, clears, load),
    clears,
  };
});

/** Grey and stretch the contrast (1% to 99% of the brightness range) so faint scans read better. */
function cleanUp(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] = d[i + 1] = d[i + 2] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8)]++;
  const n = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
  if (hi - lo > 16) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / (hi - lo)));
  g.putImageData(img, 0, 0);
}

const toPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not prepare the page for reading."))), "image/png"));

function pageText(words: OcrWord[]): string {
  return words.map((w) => w.text + (w.eop ? "\n\n" : w.eol ? "\n" : " ")).join("").trim();
}

export const ocr: ToolDef = {
  id: "ocr", title: "OCR", heading: "Make a scan searchable", group: "OCR",
  blurb: "Make scans searchable.",
  lede: "Read the words on scanned pages and add them to the PDF, so you can search and copy from it. Reading happens on this device. Results can contain mistakes, especially on blurry, skewed or handwritten pages, so check them.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    window.addEventListener("pagehold:sealed", () => ctx.refresh(), { once: true }); // the engine finishes loading just before the seal
    return h("div", { class: "ocropts" }, u.missing, u.lang, u.skip.el, u.clean.el, h("fieldset", { class: "radios" }, h("legend", { text: "Save as" }), u.pdf.el, u.txt.el));
  },
  sync(ctx) {
    const u = ui(ctx);
    const sel = u.picked();
    const stale = !ocrRpc || !same(sel, ocrLangs);
    u.missing.hidden = !stale;
    u.msg.textContent = ocrRpc
      ? "These languages are not loaded yet. Pagehold locks itself down after it loads, so they have to load first, and this tab then reloads."
      : "The OCR engine is not loaded on this page. Pagehold locks itself down after it loads, so the engine has to load first, and this tab then reloads.";
    u.load.textContent = `${ocrRpc ? "Load these languages" : "Load the OCR engine"} (about ${Math.round(loadSize(sel, !ocrRpc))} MB, stays on this device)`;
    u.clears.hidden = store.files.length === 0;
  },
  ready(ctx) { const u = ui(ctx); return !!ctx.file && !!ocrRpc && same(u.picked(), ocrLangs) && (u.pdf.input.checked || u.txt.input.checked); },
  primaryLabel: () => "Read the text",
  async run(ctx) {
    const u = ui(ctx);
    const rpc = ocrRpc!;
    const f = ctx.file!;
    const signal = ctx.o.signal;
    const total = f.info!.pageCount;
    const doc = await store.doc(f);
    const done: OcrPage[] = [];
    const texts: string[] = [];
    const skipped: number[] = [];
    const canvas = document.createElement("canvas");
    try {
      for (let i = 1; i <= total; i++) {
        if (signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
        ctx.note(`Reading page ${i} of ${total}`);
        const page = await doc.getPage(i);
        if (u.skip.input.checked) {
          const tc = await page.getTextContent();
          if (tc.items.some((it) => "str" in it && it.str.trim())) {
            skipped.push(i);
            texts.push(tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("").trim());
            page.cleanup();
            ctx.o.onProgress?.(i, total);
            continue;
          }
        }
        let scale = DPI / 72;
        const base = page.getViewport({ scale });
        if (base.width * base.height > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / (base.width * base.height));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvas, viewport, background: "#ffffff" });
        const stop = () => task.cancel();
        signal?.addEventListener("abort", stop);
        try {
          await task.promise;
        } catch (e) {
          if (e instanceof Error && e.name === "RenderingCancelledException") throw new PdfError("cancelled", "Cancelled.");
          throw e;
        } finally {
          signal?.removeEventListener("abort", stop);
        }
        if (u.clean.input.checked) cleanUp(canvas);
        const image = new Uint8Array(await (await toPng(canvas)).arrayBuffer());
        const words = await rpc.call<OcrWord[]>("page", { image }, { signal, transfer: [image.buffer as ArrayBuffer] });
        done.push({ page: i - 1, width: canvas.width, height: canvas.height, words });
        texts.push(pageText(words));
        page.cleanup();
        ctx.o.onProgress?.(i, total);
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    if (!done.length) throw new PdfError("unsupported", `${total === 1 ? "This page already has" : "Every page already has"} text, so there is nothing to read. Turn off "Skip pages that already have text" to read it anyway.`);
    if (!done.some((p) => p.words.length)) throw new PdfError("unsupported", "No words were found. The pages may be blank, or too faint or small to read. Try \"Clean up scans first\".");
    const results: OpResult[] = [];
    if (u.pdf.input.checked) {
      ctx.note("Adding the text to your PDF");
      results.push(await ctx.call<OpResult>("addTextLayer", { file: ctx.input(f), pages: done, o: { producerCredit: ctx.producerCredit } }));
    }
    if (u.txt.input.checked) results.push({ bytes: new TextEncoder().encode(texts.join("\n\n") + "\n"), name: `${stem(f.name)}.txt`, warnings: [] });
    if (skipped.length) results[0].warnings.push({ code: "skipped", message: `${plural(skipped.length, "page")} already had text and ${skipped.length === 1 ? "was" : "were"} not read again (page ${skipped.join(", ")}).` });
    return results;
  },
};
