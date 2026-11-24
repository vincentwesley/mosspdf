// Page numbers and text watermarks. Text is drawn in Helvetica, or in Noto Sans when it has characters beyond WinAnsi (D20, ufont.ts),
// positioned in the page as the viewer shows it: /Rotate and CropBox are honoured so the text is always upright.
import { PDFArray, PDFDocument, PDFFont, PDFPage, PDFRef } from "@cantoo/pdf-lib";
import { prepare, selectPages } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { checkCovered, pickFont } from "./ufont";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export type NumberPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-center" | "top-right";
export interface PageNumberOptions {
  pages?: number[]; // 0-based; default every page
  position?: NumberPosition; // default bottom-center
  format?: string; // {n}, {total}, {date}, {file}; default "{n}"
  startAt?: number; // number shown on the first selected page; default 1. {total} is the last number shown.
  fontSize?: number; // pt, default 10
  margin?: number; // pt from the visible edge, default 36
  mirror?: boolean; // swap left and right on even pages (printed books)
  allowPlain?: boolean; // header/footer text may have no token at all
  date?: string; // {date}; default today, locale-short
  fileName?: string; // {file}; default the input name without .pdf
}
export interface WatermarkOptions {
  text: string;
  pages?: number[];
  opacity?: number; // 0..1, default 0.25
  angle?: number; // degrees counter-clockwise as seen on screen, default 45
  fontSize?: number; // default 64
  color?: string; // #rrggbb, default #808080
  layer?: "over" | "under"; // default over
}

export interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rot: 0 | 90 | 180 | 270;
  w: number; // displayed width
  h: number;
}
export function view(page: PDFPage): View {
  const m = page.getMediaBox();
  const c = page.getCropBox();
  const x0 = Math.max(Math.min(m.x, m.x + m.width), Math.min(c.x, c.x + c.width));
  const y0 = Math.max(Math.min(m.y, m.y + m.height), Math.min(c.y, c.y + c.height));
  const x1 = Math.min(Math.max(m.x, m.x + m.width), Math.max(c.x, c.x + c.width));
  const y1 = Math.min(Math.max(m.y, m.y + m.height), Math.max(c.y, c.y + c.height));
  const rot = ((((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360) as View["rot"];
  const swap = rot === 90 || rot === 270;
  return { x0, y0, x1, y1, rot, w: swap ? y1 - y0 : x1 - x0, h: swap ? x1 - x0 : y1 - y0 };
}
/** Displayed (u right, v up, origin bottom-left of what the viewer shows) -> user space. */
export function toUser(v: View, u: number, vv: number): [number, number] {
  switch (v.rot) {
    case 0:
      return [v.x0 + u, v.y0 + vv];
    case 90:
      return [v.x1 - vv, v.y0 + u];
    case 180:
      return [v.x1 - u, v.y1 - vv];
    default:
      return [v.x0 + vv, v.y1 - u];
  }
}

export const hex = (c: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new PdfError("unsupported", `"${c}" isn't a colour. Enter it as #rrggbb, for example #ff0000.`);
  return [0, 2, 4].map((i) => (parseInt(m[1].slice(i, i + 2), 16) / 255).toFixed(3));
};
const num = (v: number | undefined, d: number, min: number, max: number, what: string) => {
  const x = v ?? d;
  if (!Number.isFinite(x) || x < min || x > max) throw new PdfError("unsupported", `${what} must be between ${min} and ${max}. Change it and try again.`);
  return x;
};

interface Stamp {
  text: string;
  size: number;
  /** displayed position of the text's start (baseline left) and its angle on screen */
  at: (width: number, v: View) => { u: number; v: number; angle: number };
  rgb: string[];
  gs?: PDFRef;
  under?: boolean;
}

function stampPage(doc: PDFDocument, page: PDFPage, font: PDFFont, s: Stamp) {
  const v = view(page);
  const width = font.widthOfTextAtSize(s.text, s.size);
  const p = s.at(width, v);
  const [x, y] = toUser(v, p.u, p.v);
  const a = ((p.angle + v.rot) * Math.PI) / 180;
  const [c, sn] = [Math.cos(a), Math.sin(a)].map((n) => n.toFixed(5));
  const node = page.node;
  node.normalize();
  const f = node.newFontDictionary("PHF", font.ref);
  const g = s.gs ? node.newExtGState("PHG", s.gs) : undefined;
  const ops = `q${g ? ` /${g.decodeText()} gs` : ""} ${s.rgb.join(" ")} rg BT /${f.decodeText()} ${s.size} Tf ${c} ${sn} -${sn} ${c} ${x.toFixed(3)} ${y.toFixed(3)} Tm ${font.encodeText(s.text).toString()} Tj ET Q`;
  const ref = doc.context.register(doc.context.stream(ops));
  if (s.under) {
    (node.Contents() as PDFArray).insert(0, ref); // normalize() made it an array
  } else {
    // wrap what's there in q/Q so a leaky page can't distort the stamp
    node.wrapContentStreams(doc.context.register(doc.context.stream("q")), doc.context.register(doc.context.stream("Q")));
    node.addContentStream(ref);
  }
}

async function run(file: InFile, pages: number[] | undefined, text: string, what: string, o: OpOptions, e: Engines, make: (doc: PDFDocument, n: number) => (k: number, i: number) => Stamp): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const sel = selectPages(pages, p.info, file);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const font = await pickFont(doc, [text]);
  checkCovered(font, text, what);
  const stamp = make(doc, sel.length);
  const all = doc.getPages();
  for (const [k, i] of sel.entries()) {
    if (k % 25 === 0) checkAbort(o.signal);
    stampPage(doc, all[i], font, stamp(k, i));
    o.onProgress?.(k + 1, sel.length);
  }
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: file.name, warnings: p.warnings };
}

export async function addPageNumbers(file: InFile, opts: PageNumberOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  const position = opts.position ?? "bottom-center";
  const format = opts.format ?? "{n}";
  const size = num(opts.fontSize, 10, 4, 72, "The font size");
  const margin = num(opts.margin, 36, 0, 300, "The margin");
  const start = num(opts.startAt, 1, -9999, 999999, "The first number");
  if (!Number.isInteger(start)) throw new PdfError("unsupported", "The first number must be a whole number. Change it and try again.");
  const date = opts.date ?? new Date().toLocaleDateString(undefined, { dateStyle: "short" });
  const name = opts.fileName ?? file.name.replace(/\.pdf$/i, "");
  if (!opts.allowPlain && !/\{n\}|\{total\}/.test(format)) throw new PdfError("unsupported", "The format needs {n} in it so each page gets its number. For example \"Page {n} of {total}\".");
  if (!format.trim()) throw new PdfError("unsupported", "Enter some text first, then try again.");
  const fill = (n: string, total: string) => format.replace(/\{n\}/g, n).replace(/\{total\}/g, total).replace(/\{date\}/g, () => date).replace(/\{file\}/g, () => name);
  const [vert, horiz] = position.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  return await run(file, opts.pages, fill("0", "0"), "The text", o, e, (_doc, count) => {
    return (k, i) => {
      const h = opts.mirror && i % 2 === 1 ? (horiz === "left" ? "right" : horiz === "right" ? "left" : horiz) : horiz;
      return {
        text: fill(String(start + k), String(start + count - 1)),
        size,
        rgb: ["0", "0", "0"],
        at: (w, v) => ({
          u: h === "left" ? margin : h === "right" ? v.w - margin - w : (v.w - w) / 2,
          v: vert === "bottom" ? margin : v.h - margin - size * 0.72,
          angle: 0,
        }),
      };
    };
  });
}

export async function watermark(file: InFile, opts: WatermarkOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  if (!opts.text?.trim()) throw new PdfError("unsupported", "Enter the watermark text first, then try again.");
  const opacity = num(opts.opacity, 0.25, 0.01, 1, "The opacity");
  const angle = num(opts.angle, 45, -360, 360, "The angle");
  const size = num(opts.fontSize, 64, 4, 400, "The font size");
  const rgb = hex(opts.color ?? "#808080");
  return await run(file, opts.pages, opts.text, "The watermark text", o, e, (doc) => {
    const gs = opacity < 1 ? doc.context.register(doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity })) : undefined;
    return () => ({
      text: opts.text,
      size,
      rgb,
      gs,
      under: opts.layer === "under",
      // centre the text's box on the visible page centre, then step back along the baseline
      at: (w, v) => {
        const r = (angle * Math.PI) / 180;
        const [hx, hy] = [w / 2, size * 0.35];
        return { u: v.w / 2 - (hx * Math.cos(r) - hy * Math.sin(r)), v: v.h / 2 - (hx * Math.sin(r) + hy * Math.cos(r)), angle };
      },
    });
  });
}
