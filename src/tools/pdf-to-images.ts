import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { h, plural } from "../ui/dom";
import { numberField, radioGroup } from "../ui/fields";
import { pageChoice } from "./pagesel";
import type { Ctx, ToolDef } from "./types";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
/** Canvas limit that still works on phones (iOS caps a canvas near 16.7 million pixels). */
const MAX_PIXELS = 16_000_000;
const WARN_PAGES = 50;

const ui = (ctx: Ctx) => ctx.local(() => ({
  format: radioGroup({ name: "format", legend: "Picture type", value: "png", testid: (v) => `format-${v}`, onChange: () => ctx.refresh(), options: [["png", "PNG", "Sharp text and lines. Larger files."], ["jpeg", "JPG", "Smaller files. Best for photos."]] }),
  quality: numberField({ id: "quality", label: "JPG quality (1 to 100)", value: 85, min: 1, max: 100, testid: "quality-input", onInput: () => ctx.refresh() }),
  dpi: radioGroup({ name: "dpi", legend: "Sharpness", value: "150", testid: (v) => `dpi-${v}`, onChange: () => ctx.refresh(), options: [["72", "72 dpi", "For screens."], ["150", "150 dpi", "Good for most uses."], ["300", "300 dpi", "For printing. Slower."]] }),
  pages: pageChoice(ctx, "p2i"),
}));

const plan = (ctx: Ctx) => {
  const u = ui(ctx);
  const sel = u.pages.read(ctx.file?.info?.pageCount);
  const q = Math.floor(Number(u.quality.input.value));
  const jpeg = u.format.value() === "jpeg";
  return { sel, jpeg, quality: q, dpi: Number(u.dpi.value()), qualityOk: !jpeg || (q >= 1 && q <= 100) };
};

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not save a picture of the page. Try a lower sharpness."))), type, quality));
}

export const pdfToImages: ToolDef = {
  id: "pdf-to-images", title: "PDF to images", heading: "Turn a PDF into pictures", group: "Convert",
  blurb: "Save each page as a picture.",
  lede: "Save the pages of a PDF as PNG or JPG pictures. Several pages come as one .zip.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "p2i" }, u.format.el, u.quality.el, u.dpi.el, u.pages.el);
  },
  sync(ctx) {
    const u = ui(ctx);
    u.quality.el.hidden = u.format.value() !== "jpeg";
    const p = plan(ctx);
    u.quality.setError(p.qualityOk ? null : "Use a number from 1 to 100.");
  },
  warnings(ctx) {
    const p = plan(ctx);
    const n = p.sel?.pages.length ?? 0;
    return p.dpi >= 300 && n > WARN_PAGES ? [`${plural(n, "page")} at 300 dpi takes a long time and a lot of memory. Pick fewer pages or a lower sharpness if this device slows down.`] : [];
  },
  ready(ctx) { const p = plan(ctx); return !!ctx.file && !!p.sel && p.qualityOk; },
  primaryLabel(ctx) { const n = plan(ctx).sel?.pages.length; return n ? `Save ${plural(n, "page")} as pictures` : "Save pages as pictures"; },
  async run(ctx) {
    const p = plan(ctx);
    const f = ctx.file!;
    const pages = p.sel!.pages;
    const doc = await store.doc(f);
    const ext = p.jpeg ? "jpg" : "png";
    const width = String(f.info!.pageCount).length;
    const results: OpResult[] = [];
    const warnings: OpResult["warnings"] = [];
    const signal = ctx.o.signal;
    const canvas = document.createElement("canvas");
    let shrunk = false;
    try {
      // one page at a time: bounded memory
      for (const [k, i] of pages.entries()) {
        if (signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
        const page = await doc.getPage(i + 1);
        let scale = p.dpi / 72;
        const base = page.getViewport({ scale });
        const area = base.width * base.height;
        if (area > MAX_PIXELS) { scale *= Math.sqrt(MAX_PIXELS / area); shrunk = true; }
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
        const blob = await toBlob(canvas, p.jpeg ? "image/jpeg" : "image/png", p.jpeg ? p.quality / 100 : undefined);
        results.push({ bytes: new Uint8Array(await blob.arrayBuffer()), name: `${stem(f.name)}-page-${String(i + 1).padStart(width, "0")}.${ext}`, warnings: [] });
        page.cleanup();
        ctx.o.onProgress?.(k + 1, pages.length);
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    if (shrunk) warnings.push({ code: "shrunk", message: "Some pages are very large, so they were saved a little smaller than the sharpness you chose." });
    results[0].warnings = warnings;
    return results;
  },
};
