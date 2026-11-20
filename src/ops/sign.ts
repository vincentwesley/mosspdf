// Visual signatures, initials, dates and text placed on pages. This is a picture, not a certified digital signature (D15).
// Positions are fractions of the page as the viewer shows it (after /Rotate and CropBox), measured from the top left, so the same
// numbers work at any zoom and on pages of different sizes. The op turns them into user space for each page.
import { PDFDocument, StandardFonts, type PDFImage } from "@cantoo/pdf-lib";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { checkWinAnsi, hex, toUser, view } from "./stamp";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

interface Where {
  /** 0-based pages, or "all". */
  pages: number[] | "all";
  /** Top-left of the box, as a fraction of the shown page width / height. */
  fx: number;
  fy: number;
}
export type StampItem =
  | (Where & { kind: "image"; image: number; fw: number }) // `image` indexes StampInput.images; width = fw of the page width, height keeps the picture's shape
  | (Where & { kind: "text"; text: string; size: number; color?: string }); // fx/fy = the left end of the baseline; size in pt
export interface StampInput {
  images: Uint8Array[]; // PNG
  items: StampItem[];
}

export async function stampPage(file: InFile, input: StampInput, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const pages = doc.getPages();
  if (!input.items.length) throw new PdfError("unsupported", "Nothing is placed yet. Add a signature or some text to a page first.", file.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const imgs: (PDFImage | undefined)[] = [];
  const img = async (i: number) => {
    const png = input.images[i];
    if (!png) throw new PdfError("unsupported", "A placed picture is missing.", file.name);
    try { return (imgs[i] ??= await doc.embedPng(png)); } catch { throw new PdfError("corrupt", "A picture could not be read as a PNG.", file.name); }
  };
  const finite = (...n: number[]) => n.every(Number.isFinite);
  // per page: the ops to draw, then one wrapped content stream
  const draws = new Map<number, string[]>();
  for (const [k, it] of input.items.entries()) {
    if (k % 25 === 0) checkAbort(o.signal);
    const targets = it.pages === "all" ? pages.map((_, i) => i) : it.pages;
    if (!finite(it.fx, it.fy) || !targets.length || targets.some((t) => !Number.isInteger(t) || t < 0 || t >= pages.length))
      throw new PdfError("unsupported", `A placed item points at a page that doesn't exist in "${file.name}", which has ${pages.length} page${pages.length === 1 ? "" : "s"}.`, file.name);
    if (it.kind === "text") {
      if (!finite(it.size) || it.size < 2 || it.size > 400) throw new PdfError("unsupported", "The text size must be between 2 and 400.", file.name);
      checkWinAnsi(font, it.text, "The text");
    } else if (!finite(it.fw) || it.fw <= 0 || it.fw > 4) throw new PdfError("unsupported", "A placed picture has a size that can't be used.", file.name);
    const image = it.kind === "image" ? await img(it.image) : undefined;
    for (const t of targets) {
      const page = pages[t];
      const v = view(page);
      const node = page.node;
      node.normalize();
      let op: string;
      if (it.kind === "image" && image) {
        const w = it.fw * v.w, h = (w * image.height) / image.width;
        const left = it.fx * v.w, bottom = v.h - it.fy * v.h - h; // displayed space: u right, v up
        const [x, y] = toUser(v, left, bottom);
        const [xu, yu] = toUser(v, left + w, bottom);
        const [xv, yv] = toUser(v, left, bottom + h);
        const name = node.newXObject("PHI", image.ref).decodeText();
        op = `q ${[xu - x, yu - y, xv - x, yv - y, x, y].map((n) => n.toFixed(4)).join(" ")} cm /${name} Do Q`;
      } else if (it.kind === "text") {
        const left = it.fx * v.w, base = v.h - it.fy * v.h;
        const [x, y] = toUser(v, left, base);
        const [xu, yu] = toUser(v, left + 1, base);
        const [xv, yv] = toUser(v, left, base + 1);
        const f = node.newFontDictionary("PHF", font.ref).decodeText();
        const [r, g, b] = hex(it.color ?? "#000000");
        op = `q ${r} ${g} ${b} rg BT /${f} ${it.size} Tf ${[xu - x, yu - y, xv - x, yv - y, x, y].map((n) => n.toFixed(5)).join(" ")} Tm ${font.encodeText(it.text).toString()} Tj ET Q`;
      } else continue;
      (draws.get(t) ?? draws.set(t, []).get(t)!).push(op);
    }
  }
  for (const [t, ops] of draws) {
    const node = pages[t].node;
    node.normalize();
    // wrap what's there in q/Q so a leaky page can't distort the placements
    node.wrapContentStreams(doc.context.register(doc.context.stream("q")), doc.context.register(doc.context.stream("Q")));
    node.addContentStream(doc.context.register(doc.context.stream(ops.join("\n"))));
  }
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: `${safeName(file.name, "document").slice(0, -4)}-signed.pdf`, warnings: p.warnings };
}
