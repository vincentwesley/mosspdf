import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { drawLayer } from "../../src/ops/ocr";
import { qpdfCheck } from "../helpers/qpdf";

const word = (text: string, i: number) => ({ text, conf: 90, x0: 50, y0: 40 + i * 60, x1: 50 + text.length * 30, y1: 80 + i * 60, eol: true, eop: false });

describe("glyphless OCR text layer (D21)", () => {
  it("round-trips Latin, CJK, Tamil and astral text through pdf.js and stays a valid PDF", async () => {
    const texts = ["Hello", "你好", "வணக்கம்", "Selamat", "𠮷野", "Hello"];
    const doc = await PDFDocument.create();
    doc.addPage([300, 500]);
    await drawLayer(doc, [{ page: 0, width: 300, height: 500, words: texts.map(word) }], { name: "t.pdf", bytes: new Uint8Array() }, { producerCredit: false });
    const bytes = await doc.save({ useObjectStreams: false });
    qpdfCheck(bytes);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const got = (await (await pdf.getPage(1)).getTextContent()).items.flatMap((it) => ("str" in it && it.str ? [it.str] : []));
    // Tamil comes back code point for code point (no normalisation) because each code point is its own CID.
    expect(got).toEqual(texts);
    expect(new TextDecoder("latin1").decode(bytes)).not.toMatch(/\/BaseFont\s*\/(Helvetica|NotoSans)/);
  });
});

describe("glyphless TrueType", () => {
  it("is a well-formed font: one glyph, one horizontal metric of the stated width", async () => {
    const { create } = await import("@cantoo/fontkit");
    const { emptyTtf, GLYPH_WIDTH } = await import("../../src/ops/glyphless");
    const f = create(Buffer.from(emptyTtf())) as unknown as { numGlyphs: number; hhea: { numberOfMetrics: number }; getGlyph(i: number): { advanceWidth: number } };
    expect(f.numGlyphs).toBe(1);
    expect(f.hhea.numberOfMetrics).toBe(1);
    expect(f.getGlyph(0).advanceWidth).toBe(GLYPH_WIDTH);
  });
});
