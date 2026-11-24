// Flatten: form fields via pdf-lib, and (optionally) every visible annotation's appearance stream (/AP /N) drawn into the page, then the annotation removed.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, type PDFObject, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "@cantoo/pdf-lib";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface FlattenOptions { forms: boolean; annotations: boolean }

const SKIP = new Set(["Link", "Popup"]);
const HIDDEN = 2, NOVIEW = 32;
type Mx = [number, number, number, number, number, number];

const nums = (a: PDFArray | undefined, n: number): number[] | undefined => {
  if (!a || a.size() < n) return undefined;
  const v = Array.from({ length: n }, (_, i) => (a.lookup(i) as PDFNumber | undefined)?.asNumber?.());
  return v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : undefined;
};

/** PDF 32000 12.5.5: map the Matrix-transformed BBox onto /Rect. */
export function annotMatrix(bbox: number[], m: Mx, rect: number[]): Mx {
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [rx0, rx1, ry0, ry1] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])];
  const sx = x1 - x0 ? (rx1 - rx0) / (x1 - x0) : 1;
  const sy = y1 - y0 ? (ry1 - ry0) / (y1 - y0) : 1;
  return [sx, 0, 0, sy, rx0 - x0 * sx, ry0 - y0 * sy];
}

/** The normal appearance stream of an annotation (follows /AS for state dictionaries), or undefined. */
function appearance(annot: PDFDict): PDFStream | undefined {
  const ap = annot.lookupMaybe(PDFName.of("AP"), PDFDict);
  let n = ap?.lookup(PDFName.of("N"));
  if (n instanceof PDFDict) n = n.lookup(annot.lookupMaybe(PDFName.of("AS"), PDFName) ?? PDFName.of("Off"));
  return n instanceof PDFStream ? n : undefined;
}

function bakeAnnotations(doc: PDFDocument): number {
  let baked = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep: PDFObject[] = [];
    const gone = new Set<PDFObject>();
    for (const r of Array.from({ length: annots.size() }, (_, i) => annots.get(i))) {
      const a = doc.context.lookupMaybe(r, PDFDict);
      const sub = a?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
      const flags = (a?.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0) | 0;
      const stream = a && sub && !SKIP.has(sub) && !(flags & (HIDDEN | NOVIEW)) ? appearance(a) : undefined;
      const rect = a && nums(a.lookupMaybe(PDFName.of("Rect"), PDFArray), 4);
      const bbox = stream && nums(stream.dict.lookupMaybe(PDFName.of("BBox"), PDFArray), 4);
      if (!a || !stream || !rect || !bbox) { keep.push(r); continue; }
      const m = (nums(stream.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray), 6) as Mx | undefined) ?? [1, 0, 0, 1, 0, 0];
      const tag = page.node.newXObject("Fl", doc.context.getObjectRef(stream) ?? doc.context.register(stream));
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...annotMatrix(bbox, m, rect)), drawObject(tag), popGraphicsState());
      gone.add(r);
      baked++;
    }
    // Popups of baked annotations go with them; everything else stays (links keep working).
    const out = keep.filter((r) => {
      const a = doc.context.lookupMaybe(r as PDFRef, PDFDict);
      const parent = a?.get(PDFName.of("Parent"));
      return !(a?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() === "Popup" && parent instanceof PDFRef && gone.has(parent));
    });
    if (out.length) page.node.set(PDFName.of("Annots"), doc.context.obj(out));
    else page.node.delete(PDFName.of("Annots"));
  }
  return baked;
}

export async function flatten(file: InFile, opts: FlattenOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  let fields = 0;
  if (opts.forms) {
    const form = doc.getForm();
    fields = form.getFields().length;
    if (fields) {
      try { form.updateFieldAppearances(); } catch { /* keep the appearances the file already has */ }
      form.flatten({ updateFieldAppearances: false });
    } else if (!opts.annotations) throw new PdfError("unsupported", `"${file.name}" has no form fields to flatten. Choose "Forms and annotations" to flatten notes too, or pick another file.`, file.name);
  }
  const notes = opts.annotations ? bakeAnnotations(doc) : 0;
  if (opts.annotations && !fields && !notes) throw new PdfError("unsupported", `"${file.name}" has no form fields or notes to flatten, so there is nothing to do. Pick another file.`, file.name);
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), name: file.name, warnings: p.warnings };
}
