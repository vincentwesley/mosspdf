import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { createOcr } from "../../src/engines/ocr";
import { addTextLayer } from "../../src/ops";
import { grayPng, scanGray, SCAN_LINES } from "../../scripts/scan-image.mjs";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck } from "../helpers/qpdf";

const req = createRequire(import.meta.url);
const bytes = (p: string) => new Uint8Array(readFileSync(req.resolve(p)));
const ocr = await createOcr(bytes("tesseract.js-core/tesseract-core-simd-lstm.wasm"), bytes("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"));
const scan = scanGray(SCAN_LINES);
const png = new Uint8Array(grayPng(scan));

describe("OCR", () => {
  it("reads the scanned fixture", () => {
    const words = ocr.recognize(png);
    const text = words.map((w) => w.text).join(" ");
    for (const want of ["OCR", "FIXTURE", "TOTAL", "SCANNED", "PAGE", "ONE"]) expect(text).toContain(want);
    expect(words.filter((w) => w.eol)).toHaveLength(3); // three lines
  });

  it("adds an invisible, positioned text layer that stays a valid PDF", async () => {
    const words = ocr.recognize(png);
    const r = await addTextLayer(corpus("scan-1p"), [{ page: 0, width: scan.w, height: scan.h, words }], opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.name).toBe("scan-1p-searchable.pdf");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(r.bytes), verbosity: 0, useSystemFonts: false }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.flatMap((it) => ("str" in it && it.str.trim() ? [it] : []));
    const find = (s: string) => items.find((it) => "str" in it && it.str === s)!;
    expect(find("FIXTURE")).toBeTruthy();
    // pdf.js text origin (pt, y up) is near the word's box: x0*595/1240, baseline a little above the box bottom
    const w = words.find((x) => x.text === "FIXTURE")!;
    const [px, py] = [(w.x0 * 595.28) / scan.w, 841.89 - (w.y1 * 841.89) / scan.h];
    expect(Math.abs(find("FIXTURE").transform[4] - px)).toBeLessThan(2);
    expect(Math.abs(find("FIXTURE").transform[5] - py)).toBeLessThan(12);
    // the picture itself is still there, untouched
    expect(r.bytes.length).toBeGreaterThan(corpus("scan-1p").bytes.length);
  });
});
