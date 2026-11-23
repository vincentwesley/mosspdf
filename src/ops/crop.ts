// Crop: sets CropBox and TrimBox so the viewer shows less of each page. Margins are measured on the page as displayed (so /Rotate is
// honoured) and the content outside stays in the file: this hides it, it does not remove it (Redact removes).
import { PDFDocument } from "@cantoo/pdf-lib";
import { prepare, selectPages } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { toUser, view } from "./stamp";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface CropOptions {
  /** Points to cut from each displayed edge. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** 0-based; default every page. */
  pages?: number[];
}

export const MIN_SIDE = 18; // pt left over, so a page never collapses to nothing (tools/crop.ts repeats it)

export async function cropPages(file: InFile, opts: CropOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  const m = [opts.top, opts.right, opts.bottom, opts.left];
  if (m.some((n) => !Number.isFinite(n) || n < 0)) throw new PdfError("unsupported", "Margins must be numbers, 0 or more.");
  if (m.every((n) => n === 0)) throw new PdfError("unsupported", "Set at least one margin to cut.");
  const p = await prepare(file, o, e);
  const sel = selectPages(opts.pages, p.info, file);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const all = doc.getPages();
  for (const [k, i] of sel.entries()) {
    if (k % 25 === 0) checkAbort(o.signal);
    const page = all[i];
    const v = view(page);
    if (v.w - opts.left - opts.right < MIN_SIDE || v.h - opts.top - opts.bottom < MIN_SIDE)
      throw new PdfError("unsupported", `The margins leave nothing of page ${i + 1}. Use smaller margins.`, file.name);
    const a = toUser(v, opts.left, opts.bottom);
    const b = toUser(v, v.w - opts.right, v.h - opts.top);
    const [x, y, w, h] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
    page.setCropBox(x, y, w, h);
    page.setTrimBox(x, y, w, h);
    o.onProgress?.(k + 1, sel.length);
  }
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: file.name, warnings: p.warnings };
}
