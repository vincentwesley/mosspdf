// Pages per sheet: 2-up, 4-up and a saddle-stitch booklet. Each source page is embedded as a form XObject and drawn scaled to fit and
// centred in its cell, turned by its own /Rotate (an embedded page ignores it) so it shows the way the viewer shows it.
import { PDFDocument, PDFName, radians, rgb } from "@cantoo/pdf-lib";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { view } from "./stamp";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface NupOptions {
  layout: "2" | "4" | "booklet";
  /** "same": the first page's size (2-up and booklet turned to landscape). */
  sheet?: "same" | "a4" | "letter";
  /** Thin line around each placed page. */
  border?: boolean;
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const INSET = 10; // pt kept free inside each cell

/** Booklet imposition: page indexes (null = blank) per output side, front then back of each sheet, [left, right]. */
export function bookletOrder(n: number): ([number | null, number | null])[] {
  const t = Math.ceil(n / 4) * 4;
  const pg = (i: number) => (i < n ? i : null);
  const sides: ([number | null, number | null])[] = [];
  for (let k = 0; k < t / 4; k++) {
    sides.push([pg(t - 1 - 2 * k), pg(2 * k)]);
    sides.push([pg(2 * k + 1), pg(t - 2 - 2 * k)]);
  }
  return sides;
}

export async function nupPages(file: InFile, opts: NupOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  if (!["2", "4", "booklet"].includes(opts.layout)) throw new PdfError("unsupported", "Choose 2 per sheet, 4 per sheet or booklet.");
  const p = await prepare(file, o, e);
  const src = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const pages = src.getPages();
  for (const pg of pages) if (!pg.node.Contents()) pg.node.set(PDFName.of("Contents"), src.context.register(src.context.stream(""))); // pdf-lib cannot embed a page with no content
  const views = pages.map(view);
  const first = views[0];
  let [sw, sh]: number[] = opts.sheet === "a4" || opts.sheet === "letter" ? [...SIZES[opts.sheet]] : [first.w, first.h];
  const four = opts.layout === "4";
  if (!four && sw < sh) [sw, sh] = [sh, sw]; // 2-up and booklet sheets are landscape
  const cols = 2;
  const rows = four ? 2 : 1;
  const cw = sw / cols;
  const ch = sh / rows;

  const sides: (number | null)[][] = [];
  if (opts.layout === "booklet") sides.push(...bookletOrder(pages.length));
  else {
    const per = cols * rows;
    for (let i = 0; i < pages.length; i += per) sides.push(Array.from({ length: per }, (_, k) => (i + k < pages.length ? i + k : null)));
  }

  const out = await PDFDocument.create();
  const emb = await out.embedPages(pages, views.map((v) => ({ left: v.x0, bottom: v.y0, right: v.x1, top: v.y1 })));
  for (const [s, cells] of sides.entries()) {
    if (s % 25 === 0) checkAbort(o.signal);
    const sheet = out.addPage([sw, sh]);
    cells.forEach((idx, c) => {
      if (idx === null) return;
      const v = views[idx];
      const cx = (c % cols) * cw;
      const cy = sh - (Math.floor(c / cols) + 1) * ch; // row 0 is the top
      const k = Math.min((cw - 2 * INSET) / v.w, (ch - 2 * INSET) / v.h);
      // Draw turned clockwise by the page's /Rotate: pdf-lib rotates counter-clockwise, about (x, y).
      const th = (-v.rot * Math.PI) / 180;
      const [cos, sin] = [Math.round(Math.cos(th)), Math.round(Math.sin(th))];
      const [ew, eh] = [v.x1 - v.x0, v.y1 - v.y0];
      const corners = [[0, 0], [ew, 0], [0, eh], [ew, eh]];
      const xs = corners.map(([px, py]) => k * (px * cos - py * sin));
      const ys = corners.map(([px, py]) => k * (px * sin + py * cos));
      const dw = Math.max(...xs) - Math.min(...xs);
      const dh = Math.max(...ys) - Math.min(...ys);
      const x = cx + (cw - dw) / 2 - Math.min(...xs);
      const y = cy + (ch - dh) / 2 - Math.min(...ys);
      sheet.drawPage(emb[idx], { x, y, xScale: k, yScale: k, rotate: radians(th) });
      if (opts.border) sheet.drawRectangle({ x: cx + (cw - dw) / 2, y: cy + (ch - dh) / 2, width: dw, height: dh, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.5 });
    });
    o.onProgress?.(s + 1, sides.length);
  }
  if (o.producerCredit) applyCredit(out);
  return { bytes: await out.save({ useObjectStreams: false }), name: file.name, warnings: p.warnings };
}
