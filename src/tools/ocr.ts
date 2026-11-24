// OCR (M5). Pages are drawn with pdf.js here on the main thread; the OCR worker reads them one at a time (D16); the ops worker
// adds the invisible text layer. Cancel is checked between pages: one page is one synchronous wasm call, and the worker is never
// terminated because a new one could not be created once the page is sealed.
import { ocrLangs, ocrRpc } from "../core/engines";
import { chosenLangs, hashFor, loadSize, OCR_LANGS, saveLangs } from "../core/ocrlangs";
import { store } from "../core/store";
import type { OcrPage } from "../ops";
import type { OcrWord } from "../engines/ocr";
import { enhance, fixPage } from "../ops/scanfix";
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
    straighten: checkField({ id: "ocr-straighten", label: "Straighten crooked pages", checked: true, testid: "ocr-straighten", onChange: () => ctx.refresh() }),
    crop: checkField({ id: "ocr-crop", label: "Crop to the page (trim dark scanner edges)", checked: true, testid: "ocr-crop", onChange: () => ctx.refresh() }),
    clean: checkField({ id: "ocr-clean", label: "Clearer text (even out shadows, stronger contrast)", checked: true, testid: "ocr-clean", onChange: () => ctx.refresh() }),
    keep: checkField({ id: "ocr-use-cleaned", label: "Use the straightened, cropped pages in the PDF (otherwise your original pages stay as they are)", checked: false, testid: "ocr-use-cleaned", onChange: () => ctx.refresh() }),
    pdf: checkField({ id: "ocr-out-pdf", label: "Searchable PDF", checked: true, testid: "ocr-out-pdf", onChange: () => ctx.refresh() }),
    txt: checkField({ id: "ocr-out-txt", label: "Plain text (.txt)", checked: false, testid: "ocr-out-txt", onChange: () => ctx.refresh() }),
    missing: h("div", { class: "hs-banner hs-banner--info", attrs: { "data-testid": "ocr-missing", role: "note" } }, msg, clears, load),
    clears,
  };
});

const toBlob = (canvas: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not prepare a page for reading. Close other tabs and try again."))), type, q));
const toPng = (canvas: HTMLCanvasElement) => toBlob(canvas, "image/png");

function pageText(words: OcrWord[]): string {
  return words.map((w) => w.text + (w.eop ? "\n\n" : w.eol ? "\n" : " ")).join("").trim();
}

export const ocr: ToolDef = {
  id: "ocr", title: "OCR", heading: "Make a scan searchable", group: "OCR",
  blurb: "Make scans searchable.",
  lede: "Read the words on scanned pages and add them to the PDF, so you can search and copy from it. Reading happens on this device. Results can contain mistakes, especially on blurry, skewed or handwritten pages, so check them.",
  how: "Add a scanned PDF. MossPDF reads the words and adds them as hidden text you can search.",
  next: ["compress", "redact", "protect"],
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    window.addEventListener("mosspdf:sealed", () => ctx.refresh(), { once: true }); // the engine finishes loading just before the seal
    return h("div", { class: "ocropts" }, u.missing, u.lang, u.skip.el, h("fieldset", { class: "radios", attrs: { "data-testid": "ocr-cleanup" } }, h("legend", { text: "Clean up the scan first" }), u.straighten.el, u.crop.el, u.clean.el, u.keep.el), h("fieldset", { class: "radios" }, h("legend", { text: "Save as" }), u.pdf.el, u.txt.el));
  },
  sync(ctx) {
    const u = ui(ctx);
    const sel = u.picked();
    const stale = !ocrRpc || !same(sel, ocrLangs);
    u.missing.hidden = !stale;
    u.msg.textContent = ocrRpc
      ? "These languages are not loaded yet. MossPDF locks itself down after it loads, so they have to load first, and this tab then reloads."
      : "The OCR engine is not loaded on this page. MossPDF locks itself down after it loads, so the engine has to load first, and this tab then reloads.";
    u.load.textContent = `${ocrRpc ? "Load these languages" : "Load the OCR engine"} (about ${Math.round(loadSize(sel, !ocrRpc))} MB, stays on this device)`;
    u.clears.hidden = store.files.length === 0;
  },
  ready(ctx) { const u = ui(ctx); return !!ctx.file && !!ocrRpc && same(u.picked(), ocrLangs) && (u.pdf.input.checked || u.txt.input.checked); },
  primaryLabel: () => "Make PDF searchable",
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
        const [origW, origH] = [canvas.width, canvas.height];
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        let fixed: ReturnType<typeof fixPage> | undefined;
        let shown: OcrPage["image"];
        if (u.straighten.input.checked || u.crop.input.checked) {
          fixed = fixPage(g.getImageData(0, 0, origW, origH), { crop: u.crop.input.checked, straighten: u.straighten.input.checked });
          canvas.width = fixed.img.width;
          canvas.height = fixed.img.height;
          g.putImageData(new ImageData(fixed.img.data as Uint8ClampedArray<ArrayBuffer>, fixed.img.width, fixed.img.height), 0, 0);
        }
        if (u.keep.input.checked) shown = { bytes: new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.85)).arrayBuffer()), jpeg: true, ptWidth: canvas.width / scale, ptHeight: canvas.height / scale };
        if (u.clean.input.checked) {
          const img = g.getImageData(0, 0, canvas.width, canvas.height);
          enhance(img);
          g.putImageData(img, 0, 0);
        }
        const image = new Uint8Array(await (await toPng(canvas)).arrayBuffer());
        let words = await rpc.call<OcrWord[]>("page", { image }, { signal, transfer: [image.buffer as ArrayBuffer] });
        texts.push(pageText(words));
        if (fixed && !shown) { // the layer goes on the original page: put each word box back where it was before the clean-up
          const { toOriginal } = fixed;
          words = words.map((w) => {
            const c = [toOriginal(w.x0, w.y0), toOriginal(w.x1, w.y0), toOriginal(w.x0, w.y1), toOriginal(w.x1, w.y1)];
            const [xs, ys] = [c.map((p) => p[0]), c.map((p) => p[1])];
            return { ...w, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
          });
        }
        done.push({ page: i - 1, width: shown ? canvas.width : origW, height: shown ? canvas.height : origH, words, image: shown });
        page.cleanup();
        ctx.o.onProgress?.(i, total);
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    if (!done.length) throw new PdfError("unsupported", `${total === 1 ? "This page already has" : "Every page already has"} text, so there is nothing to read. Turn off "Skip pages that already have text" to read it anyway.`);
    if (!done.some((p) => p.words.length)) throw new PdfError("unsupported", "No words were found. The pages may be blank, or too faint or small to read. Try turning on the clean-up options and try again.");
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
