// Searchable PDF: the original pages stay untouched; the recognised words are added as an invisible text layer
// (text render mode 3, Helvetica/WinAnsi) placed over each word's box. Isomorphic, no OCR engine in here.
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import type { OcrWord } from "../engines/ocr";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { toUser, view } from "./stamp";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface OcrPage {
  /** 0-based page in the file. */
  page: number;
  /** Size in pixels of the picture that was read; word boxes are in these pixels, origin top-left. */
  width: number;
  height: number;
  words: OcrWord[];
}

export async function addTextLayer(file: InFile, pages: OcrPage[], o: OpOptions, e: Engines): Promise<OpResult> {
  if (!pages.length) throw new PdfError("unsupported", "There is no text to add.", file.name);
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  await drawLayer(doc, pages, file, o);
  if (o.producerCredit) applyCredit(doc);
  const name = safeName(file.name, "document").replace(/\.pdf$/i, "") + "-searchable.pdf";
  return { bytes: await doc.save({ useObjectStreams: false }), name, warnings: p.warnings };
}

/** Adds the invisible words of `pages` to the matching pages of `doc` (shared with redaction, which rebuilds the pages first). */
export async function drawLayer(doc: PDFDocument, pages: OcrPage[], file: InFile, o: OpOptions): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const known = new Set(font.getCharacterSet());
  const all = doc.getPages();
  for (const [k, pg] of pages.entries()) {
    checkAbort(o.signal);
    const page = all[pg.page];
    if (!page) throw new PdfError("unsupported", `Page ${pg.page + 1} doesn't exist in "${file.name}".`, file.name);
    const v = view(page);
    const [sx, sy] = [v.w / pg.width, v.h / pg.height];
    const a = (v.rot * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)].map((n) => n.toFixed(5));
    const ops: string[] = [];
    for (const w of pg.words) {
      // Helvetica/WinAnsi only: other characters are dropped (the picture still shows them).
      const text = [...w.text].filter((ch) => known.has(ch.codePointAt(0)!)).join("");
      const [bw, bh] = [(w.x1 - w.x0) * sx, (w.y1 - w.y0) * sy];
      if (!text || bw <= 0 || bh <= 0) continue;
      const size = Math.max(1, bh * 0.75);
      const wide = font.widthOfTextAtSize(text, size);
      if (!wide) continue;
      const [x, y] = toUser(v, w.x0 * sx, (pg.height - w.y1) * sy + size * 0.2); // baseline a descender above the box bottom
      ops.push(`BT 3 Tr ${((bw / wide) * 100).toFixed(2)} Tz /PHO ${size.toFixed(2)} Tf ${c} ${s} -${s} ${c} ${x.toFixed(3)} ${y.toFixed(3)} Tm ${font.encodeText(text).toString()} Tj ET`);
    }
    if (ops.length) {
      const node = page.node;
      node.normalize();
      node.newFontDictionary("PHO", font.ref);
      const ref = doc.context.register(doc.context.stream(`q\n${ops.join("\n")}\nQ`));
      // wrap what's there in q/Q so a leaky page can't distort the layer
      node.wrapContentStreams(doc.context.register(doc.context.stream("q")), doc.context.register(doc.context.stream("Q")));
      node.addContentStream(ref);
    }
    o.onProgress?.(k + 1, pages.length);
  }
}
