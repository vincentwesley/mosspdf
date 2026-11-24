// PDF to PowerPoint: every page is drawn to a canvas (as PDF to images does) and saved as a JPEG on its own slide. Slides are pictures, so no text is kept.
import { buildPptx, type Slide } from "../core/pptx";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

const DPI = 150;
const MAX_PIXELS = 16_000_000; // iOS caps a canvas near 16.7 million pixels

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not save a picture of a page. Try a smaller PDF."))), "image/jpeg", 0.85));

const ui = (ctx: Ctx) => ctx.local(() => ({ root: h("p", { class: "field__hint", text: "Slides are pictures of the pages, so the text is not editable." }) }));

export const pdfToPpt: ToolDef = {
  id: "pdf-to-ppt", title: "PDF to PowerPoint", heading: "Turn a PDF into slides", group: "Convert",
  blurb: "Each page becomes a slide.",
  lede: "Save every page of a PDF as a slide in a .pptx. Slides are pictures of the pages, so the text is not editable.",
  how: "Add a PDF, then save its pages as a PowerPoint file.",
  accepts: "pdf", batch: true,
  next: [],
  options: (ctx) => ui(ctx).root,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Make PowerPoint file",
  async run(ctx): Promise<OpResult[]> {
    const f = ctx.file!;
    const doc = await store.doc(f);
    const signal = ctx.o.signal;
    const canvas = document.createElement("canvas");
    const slides: Slide[] = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        if (signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
        ctx.note(`Drawing page ${i} of ${doc.numPages}`);
        ctx.o.onProgress?.(i - 1, doc.numPages);
        const page = await doc.getPage(i);
        let scale = DPI / 72;
        const area = page.getViewport({ scale }).width * page.getViewport({ scale }).height;
        if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
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
        slides.push({ jpeg: new Uint8Array(await (await toBlob(canvas)).arrayBuffer()), width: canvas.width, height: canvas.height });
        page.cleanup();
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    return [{ bytes: buildPptx(slides), name: `${base(f.name)}.pptx`, warnings: [] }];
  },
};
