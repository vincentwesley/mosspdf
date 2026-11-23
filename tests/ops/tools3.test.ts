import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { cropPages, rotatePages } from "../../src/ops";
import { joinPages, pageText } from "../../src/core/pagetext";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const box = (b: { x: number; y: number; width: number; height: number }) => [b.x, b.y, b.x + b.width, b.y + b.height].map((n) => Math.round(n * 100) / 100);

describe("rotate", () => {
  it("adds the turn to every page, or only the chosen ones, and keeps the file valid", async () => {
    const all = await rotatePages(corpus("plain-3p"), { angle: 90 }, opts(), engines);
    qpdfCheck(all.bytes);
    expect((await readPdf(all.bytes)).map((p) => p.rotate)).toEqual([90, 90, 90]);
    const some = await rotatePages({ ...corpus("plain-3p"), bytes: all.bytes }, { angle: 270, pages: [1] }, opts(), engines);
    expect((await readPdf(some.bytes)).map((p) => p.rotate)).toEqual([90, 0, 90]);
  });
  it("wraps around 360 and rejects bad pages", async () => {
    const r = await rotatePages(corpus("plain-3p"), { angle: 180, pages: [0] }, opts(), engines);
    const twice = await rotatePages({ ...corpus("plain-3p"), bytes: r.bytes }, { angle: 180, pages: [0] }, opts(), engines);
    expect((await readPdf(twice.bytes))[0].rotate).toBe(0);
    await expect(rotatePages(corpus("plain-3p"), { angle: 90, pages: [9] }, opts(), engines)).rejects.toThrow(/doesn't exist/);
  });
});

describe("crop", () => {
  it("sets CropBox and TrimBox from the displayed margins", async () => {
    const r = await cropPages(corpus("plain-3p"), { top: 10, right: 20, bottom: 30, left: 40 }, opts(), engines);
    qpdfCheck(r.bytes);
    const src = await PDFDocument.load(corpus("plain-3p").bytes);
    const m = src.getPage(0).getMediaBox();
    const out = (await PDFDocument.load(r.bytes)).getPage(0);
    expect(box(out.getCropBox())).toEqual(box({ x: m.x + 40, y: m.y + 30, width: m.width - 60, height: m.height - 40 }));
    expect(box(out.getTrimBox())).toEqual(box(out.getCropBox()));
  });
  it("respects /Rotate: the left margin is the left of the displayed page", async () => {
    const d = await PDFDocument.create();
    d.addPage([200, 100]).setRotation(degrees(90)); // shown 100 wide, 200 tall
    const bytes = await d.save();
    const r = await cropPages({ name: "r.pdf", bytes }, { top: 0, right: 0, bottom: 0, left: 30 }, opts(), engines);
    // rotated 90 clockwise: displayed left edge is the bottom of the user-space page
    expect(box((await PDFDocument.load(r.bytes)).getPage(0).getCropBox())).toEqual([0, 30, 200, 100]);
  });
  it("only crops the chosen pages and refuses margins that leave nothing", async () => {
    const r = await cropPages(corpus("plain-3p"), { top: 10, right: 0, bottom: 0, left: 0, pages: [2] }, opts(), engines);
    const doc = await PDFDocument.load(r.bytes);
    expect(box(doc.getPage(0).getCropBox())).toEqual(box(doc.getPage(0).getMediaBox()));
    expect(box(doc.getPage(2).getCropBox())).not.toEqual(box(doc.getPage(2).getMediaBox()));
    await expect(cropPages(corpus("plain-3p"), { top: 400, right: 0, bottom: 500, left: 0 }, opts(), engines)).rejects.toThrow(/nothing of page/);
    await expect(cropPages(corpus("plain-3p"), { top: 0, right: 0, bottom: 0, left: 0 }, opts(), engines)).rejects.toThrow(/at least one margin/);
  });
});

describe("text join", () => {
  it("joins items, ends lines at hasEOL and keeps separators for empty pages", () => {
    expect(pageText([{ str: "Hello " }, { str: "world", hasEOL: true }, { str: "Next  ", hasEOL: true }, { str: "line" }])).toBe("Hello world\nNext\nline");
    expect(joinPages(["a", "", "c"])).toBe("--- Page 1 ---\na\n\n--- Page 2 ---\n\n\n--- Page 3 ---\nc\n");
  });
});
