import { PDFArray, PDFDict, PDFRawStream, decodePDFRawStream, PDFDocument, PDFName, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { annotMatrix, flatten } from "../../src/ops/flatten";
import { inkRatio, isBlank } from "../../src/ops/blank";
import { engines, opts } from "../helpers/env";
import { qpdfCheck } from "../helpers/qpdf";

const inf = (bytes: Uint8Array, name = "t.pdf") => ({ name, bytes });
const annotsOf = (doc: PDFDocument, i = 0) => doc.getPage(i).node.Annots()?.size() ?? 0;

async function withForm() {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  const t = d.getForm().createTextField("name");
  t.setText("Ada");
  t.addToPage(p, { x: 20, y: 100, width: 100, height: 20 });
  return d.save();
}

/** A page with a Square annotation (AP with a translated BBox + Matrix), a Link and a hidden Text note. */
async function withAnnots() {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  const ctx = d.context;
  const ap = ctx.stream("1 0 0 rg 0 0 10 10 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10], Matrix: [1, 0, 0, 1, 0, 0] });
  const apRef = ctx.register(ap);
  const mk = (extra: Record<string, unknown>) => ctx.register(ctx.obj({ Type: "Annot", ...extra }));
  const sq = mk({ Subtype: "Square", Rect: [50, 50, 100, 100], F: 4, AP: { N: apRef } });
  const hidden = mk({ Subtype: "Text", Rect: [10, 10, 30, 30], F: 2, AP: { N: apRef } });
  const link = mk({ Subtype: "Link", Rect: [0, 0, 20, 20] });
  p.node.set(PDFName.of("Annots"), ctx.obj([sq, hidden, link]));
  p.drawText("hi", { x: 10, y: 190, size: 8, font: await d.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
  return d.save();
}

describe("annotMatrix", () => {
  it("scales and moves the box onto the rectangle, through /Matrix", () => {
    expect(annotMatrix([0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [50, 50, 100, 100])).toEqual([5, 0, 0, 5, 50, 50]);
    expect(annotMatrix([0, 0, 10, 10], [1, 0, 0, 1, 5, 5], [0, 0, 10, 10])).toEqual([1, 0, 0, 1, -5, -5]);
    expect(annotMatrix([0, 0, 10, 20], [0, 1, -1, 0, 0, 0], [0, 0, 20, 10])).toEqual([1, 0, 0, 1, 20, 0]); // 90 degree matrix swaps the box
  });
});

describe("flatten", () => {
  it("turns form fields into page content", async () => {
    const r = await flatten(inf(await withForm()), { forms: true, annotations: false }, opts(), engines);
    qpdfCheck(r.bytes);
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(annotsOf(doc)).toBe(0);
  });
  it("says so when there is no form", async () => {
    const d = await PDFDocument.create();
    d.addPage();
    await expect(flatten(inf(await d.save()), { forms: true, annotations: false }, opts(), engines)).rejects.toThrow(/no form fields/);
  });
  it("bakes visible annotations, removes them, and keeps links and hidden notes", async () => {
    const r = await flatten(inf(await withAnnots()), { forms: true, annotations: true }, opts(), engines);
    qpdfCheck(r.bytes);
    const doc = await PDFDocument.load(r.bytes);
    const annots = doc.getPage(0).node.Annots()!;
    const subs = Array.from({ length: annots.size() }, (_, i) => (annots.lookup(i, PDFDict).get(PDFName.of("Subtype")) as PDFName).decodeText());
    expect(subs).toEqual(["Text", "Link"]);
    const xo = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    expect(xo.keys().length).toBe(1);
    const cs = doc.getPage(0).node.Contents() as PDFArray;
    const content = Array.from({ length: cs.size() }, (_, i) => Buffer.from(decodePDFRawStream(cs.lookup(i, PDFRawStream)).decode()).toString("latin1")).join(" ");
    expect(content).toMatch(/5 0 0 5 50 50 cm/);
  });
  it("refuses a file with nothing to flatten in annotation mode", async () => {
    const d = await PDFDocument.create();
    d.addPage();
    await expect(flatten(inf(await d.save()), { forms: true, annotations: true }, opts(), engines)).rejects.toThrow(/nothing|no form fields or notes/);
  });
});

describe("blank detection", () => {
  const px = (n: number, inkPx: number) => { const a = new Uint8ClampedArray(n * 4).fill(255); for (let i = 0; i < inkPx; i++) a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 0; return a; };
  it("counts only non-near-white opaque pixels", () => {
    expect(inkRatio(px(1000, 0))).toBe(0);
    expect(inkRatio(px(1000, 10))).toBe(0.01);
    expect(inkRatio(new Uint8ClampedArray(4000))).toBe(0); // transparent
    const grey = new Uint8ClampedArray(4).fill(240); grey[3] = 255;
    expect(inkRatio(grey)).toBe(0);
  });
  it("sensitivity widens what counts as blank", () => {
    const speck = inkRatio(px(36000, 20)); // 0.00056
    expect(isBlank(speck, "strict")).toBe(false);
    expect(isBlank(speck, "normal")).toBe(true);
    expect(isBlank(inkRatio(px(36000, 150)), "normal")).toBe(false);
    expect(isBlank(inkRatio(px(36000, 150)), "loose")).toBe(true);
    expect(isBlank(0, "strict")).toBe(true);
  });
});
