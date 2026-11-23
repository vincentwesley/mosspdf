// Edit PDF: text, white-out boxes, highlights, rectangles and lines drawn onto pages. Nothing already on the page is changed or removed
// (a white-out only covers; use redact to remove). Positions are fractions of the page as the viewer shows it (after /Rotate and CropBox),
// from its top left, like sign.ts, so rotated and cropped pages need no special case: each item is drawn in displayed units under one matrix.
import { PDFDocument, PDFName, StandardFonts, type PDFImage } from "@cantoo/pdf-lib";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { hex, toUser, view } from "./stamp";
import { WIN_ANSI } from "../core/winansi";
import { checkCovered, pickFont } from "./ufont";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

type Box = { x: number; y: number; w: number; h: number }; // top-left corner and size, fractions of the shown page
export type EditItem =
  | { kind: "text"; page: number; text: string; size: number; color?: string; bold?: boolean; x: number; y: number } // x, y = left end of the baseline; size in pt; bold only for WinAnsi text (Helvetica-Bold)
  | ({ kind: "image"; page: number; image: number } & Box) // `image` indexes EditInput.images; the box keeps the picture's shape (the caller sets it)
  | ({ kind: "whiteout" | "highlight"; page: number } & Box)
  | ({ kind: "rect"; page: number; color?: string; stroke: number } & Box)
  | { kind: "line"; page: number; color?: string; stroke: number; x1: number; y1: number; x2: number; y2: number };
export interface EditInput { items: EditItem[]; images?: { bytes: Uint8Array; jpeg: boolean }[] }

const f = (n: number) => n.toFixed(4);

export async function editPages(file: InFile, input: EditInput, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const pages = doc.getPages();
  if (!input.items.length) throw new PdfError("unsupported", "Nothing is added yet. Add some text or a shape to a page first.", file.name);
  const font = await pickFont(doc, input.items.flatMap((it) => (it.kind === "text" ? [it.text] : [])));
  const imgs: (PDFImage | undefined)[] = [];
  let boldFont: Awaited<ReturnType<typeof doc.embedFont>> | undefined;
  const hl = doc.context.register(doc.context.obj({ Type: "ExtGState", ca: 0.45, CA: 0.45, BM: PDFName.of("Multiply") }));
  const draws = new Map<number, string[]>();
  const bad = (m: string) => new PdfError("unsupported", m, file.name);
  for (const [k, it] of input.items.entries()) {
    if (k % 25 === 0) checkAbort(o.signal);
    const nums = it.kind === "line" ? [it.x1, it.y1, it.x2, it.y2] : it.kind === "text" ? [it.x, it.y, it.size] : [it.x, it.y, it.w, it.h];
    if (!Number.isInteger(it.page) || it.page < 0 || it.page >= pages.length || !nums.every(Number.isFinite))
      throw bad(`An added item points at a page that doesn't exist in "${file.name}", which has ${pages.length} page${pages.length === 1 ? "" : "s"}.`);
    if ("stroke" in it && !(it.stroke > 0 && it.stroke <= 50)) throw bad("The line width must be between 0 and 50.");
    const page = pages[it.page];
    const v = view(page);
    const node = page.node;
    node.normalize();
    // displayed space (u right, v up, origin bottom-left of the shown page) -> user space
    const [x, y] = toUser(v, 0, 0), [xu, yu] = toUser(v, 1, 0), [xv, yv] = toUser(v, 0, 1);
    const cm = `${[xu - x, yu - y, xv - x, yv - y, x, y].map((n) => n.toFixed(5)).join(" ")} cm`;
    const px = (a: number) => a * v.w, py = (a: number) => v.h - a * v.h; // fractions -> displayed units
    let body: string;
    if (it.kind === "text") {
      if (!(it.size >= 2 && it.size <= 400)) throw bad("The text size must be between 2 and 400.");
      const bold = it.bold && [...it.text].every((c) => WIN_ANSI.test(c));
      const fnt = bold ? (boldFont ??= await doc.embedFont(StandardFonts.HelveticaBold)) : font;
      checkCovered(fnt, it.text, "The text");
      const name = node.newFontDictionary("PHF", fnt.ref).decodeText();
      const [r, g, b] = hex(it.color ?? "#000000");
      body = `${r} ${g} ${b} rg BT /${name} ${it.size} Tf ${f(px(it.x))} ${f(py(it.y))} Td ${fnt.encodeText(it.text).toString()} Tj ET`;
    } else if (it.kind === "line") {
      const [r, g, b] = hex(it.color ?? "#000000");
      body = `${r} ${g} ${b} RG ${it.stroke} w 1 J ${f(px(it.x1))} ${f(py(it.y1))} m ${f(px(it.x2))} ${f(py(it.y2))} l S`;
    } else {
      if (!(it.w >= 0 && it.h >= 0)) throw bad("A box has a size that can't be used.");
      if (it.kind === "image") {
        const src = input.images?.[it.image];
        if (!src) throw bad("A placed picture is missing.");
        let im: PDFImage;
        try { im = (imgs[it.image] ??= src.jpeg ? await doc.embedJpg(src.bytes) : await doc.embedPng(src.bytes)); } catch { throw new PdfError("corrupt", "A picture could not be read.", file.name); }
        const name = node.newXObject("PHI", im.ref).decodeText();
        (draws.get(it.page) ?? draws.set(it.page, []).get(it.page)!).push(`q ${cm} ${f(px(it.w))} 0 0 ${f(it.h * v.h)} ${f(px(it.x))} ${f(py(it.y + it.h))} cm /${name} Do Q`);
        continue;
      }
      const re = `${f(px(it.x))} ${f(py(it.y + it.h))} ${f(px(it.w))} ${f(it.h * v.h)} re`;
      if (it.kind === "whiteout") body = `1 1 1 rg ${re} f`;
      else if (it.kind === "highlight") body = `/${node.newExtGState("PHG", hl).decodeText()} gs 1 0.92 0.2 rg ${re} f`;
      else if (it.kind === "rect") { const [r, g, b] = hex(it.color ?? "#000000"); body = `${r} ${g} ${b} RG ${it.stroke} w ${re} S`; }
      else body = "";
    }
    (draws.get(it.page) ?? draws.set(it.page, []).get(it.page)!).push(`q ${cm} ${body} Q`);
  }
  for (const [t, ops] of draws) {
    const node = pages[t].node;
    // wrap what's there in q/Q so a leaky page can't distort what is added
    node.wrapContentStreams(doc.context.register(doc.context.stream("q")), doc.context.register(doc.context.stream("Q")));
    node.addContentStream(doc.context.register(doc.context.stream(ops.join("\n"))));
  }
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: `${safeName(file.name, "document").slice(0, -4)}-edited.pdf`, warnings: p.warnings };
}
