// Quick rotate: adds a turn to /Rotate of every (or the chosen) page. Nothing else in the file changes, so bookmarks and links stay.
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { prepare, selectPages } from "./common";
import { applyCredit } from "./metadata";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface RotateOptions {
  /** Clockwise turn to add: 90 (right), 180 or 270 (left). */
  angle: 90 | 180 | 270;
  /** 0-based; default every page. */
  pages?: number[];
}

export async function rotatePages(file: InFile, opts: RotateOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  if (![90, 180, 270].includes(opts.angle)) throw new PdfError("unsupported", "Choose a turn of 90, 180 or 270 degrees.");
  const p = await prepare(file, o, e);
  const sel = selectPages(opts.pages, p.info, file);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const all = doc.getPages();
  for (const i of sel) all[i].setRotation(degrees((((all[i].getRotation().angle + opts.angle) % 360) + 360) % 360));
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: file.name, warnings: p.warnings };
}
