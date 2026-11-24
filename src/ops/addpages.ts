// Add blank pages: inserted into the file as it is (bookmarks and links stay), each the size of the page it follows
// (the first page for "before the first"), as the viewer shows it.
import { PDFDocument } from "@cantoo/pdf-lib";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { view } from "./stamp";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface AddPagesOptions {
  where: "start" | "end" | "every" | "after";
  /** 1-based, for where "after". */
  page?: number;
  /** Blank pages at each place, 1 to 10. */
  count: number;
}

export async function addBlankPages(file: InFile, opts: AddPagesOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 10) throw new PdfError("unsupported", "You can add 1 to 10 blank pages at a time. Change the number and try again.");
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const n = doc.getPageCount();
  const sizes = doc.getPages().map((pg) => { const v = view(pg); return [v.w, v.h] as [number, number]; });
  // 0-based index of the page each batch follows (-1 = before the first), taken from the end so earlier indexes stay valid.
  let at: number[];
  if (opts.where === "start") at = [-1];
  else if (opts.where === "end") at = [n - 1];
  else if (opts.where === "every") at = Array.from({ length: n }, (_, i) => n - 1 - i);
  else if (opts.where === "after" && Number.isInteger(opts.page) && opts.page! >= 1 && opts.page! <= n) at = [opts.page! - 1];
  else throw new PdfError("unsupported", `Page ${opts.page} doesn't exist in "${file.name}", which has ${n} page${n === 1 ? "" : "s"}.`, file.name);
  for (const a of at) for (let k = 0; k < opts.count; k++) doc.insertPage(a + 1, sizes[Math.max(a, 0)]);
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: file.name, warnings: p.warnings };
}
