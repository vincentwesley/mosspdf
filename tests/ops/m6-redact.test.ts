/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js's Node canvas factory is not in its types */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { detect, findText } from "../../src/core/detect";
import { layoutText, overlaps, rangeRects, type Rect, type TextItem } from "../../src/core/textpos";
import { redact, type RedactInput } from "../../src/ops";
import { qpdfBin } from "../../scripts/qpdf-bin.mjs";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const S = 2; // pixels per point for the page picture
const PW = 595.28, PH = 841.89;
const W = Math.ceil(PW * S), H = Math.ceil(PH * S);
const file = corpus("redact-sample");
const helv = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
/** The real glyph widths of the fixture's font (Helvetica), what the tool gets from a canvas. */
const measure = (it: TextItem) => Array.from({ length: it.str.length + 1 }, (_, n) => helv.widthOfTextAtSize(it.str.slice(0, n), 100));

/** Renders page `n` with pdf.js (needs @napi-rs/canvas, which pdf.js ships as an optional dependency); undefined when that is missing. */
async function render(doc: pdfjs.PDFDocumentProxy, n: number) {
  try {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: S });
    const { canvas, context } = (doc as any).canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
    await page.render({ canvasContext: context, viewport: vp, canvas, background: "#ffffff" } as any).promise;
    return context.getImageData(0, 0, canvas.width, canvas.height) as { data: Uint8ClampedArray; width: number; height: number };
  } catch {
    return undefined;
  }
}
const canRender = !!(await (async () => {
  const task = pdfjs.getDocument({ data: new Uint8Array(file.bytes), verbosity: 0, useSystemFonts: false });
  try { return await render(await task.promise, 1); } finally { await task.destroy(); }
})());

interface Box { text: string; page: number; x0: number; y0: number; x1: number; y1: number } // points, from the top left
/** What the tool does in the browser, with pdf.js in Node: read the text, detect, paint the boxes onto the page picture, keep the words outside them. */
async function plan(extraSearch?: string, measured = true): Promise<{ input: RedactInput; boxes: Box[] }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(file.bytes), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const pages: RedactInput["pages"] = [];
  const needles = new Set<string>();
  const boxes: Box[] = [];
  let items = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const pt = layoutText((tc.items as unknown as TextItem[]).filter((it) => "str" in it), vp.transform, vp.width, vp.height, measured ? measure : undefined);
    const hits = [...detect(pt.text), ...(extraSearch ? findText(pt.text, extraSearch, false) : [])];
    if (!hits.length) continue;
    const rects: Rect[] = [];
    for (const h of hits) for (const r of rangeRects(pt, h.start, h.end)) { rects.push(r); boxes.push({ text: h.text, page: i - 1, x0: r.x * PW, y0: r.y * PH, x1: (r.x + r.w) * PW, y1: (r.y + r.h) * PH }); }
    hits.forEach((h) => needles.add(h.text));
    items += hits.length;
    const pic = await render(doc, i);
    const rgba = pic ? new Uint8Array(pic.data.buffer, pic.data.byteOffset, pic.data.byteLength) : new Uint8Array(W * H * 4).fill(255);
    for (const r of rects) for (let y = Math.floor(r.y * H); y < Math.ceil((r.y + r.h) * H); y++) for (let x = Math.floor(r.x * W); x < Math.ceil((r.x + r.w) * W); x++) { const o = (y * W + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = 0; }
    const words = pt.words.filter((w) => !rects.some((r) => overlaps(w.r, r))).map((w) => ({ text: w.text, conf: 100, eol: false, eop: false, x0: w.r.x * W, y0: w.r.y * H, x1: (w.r.x + w.r.w) * W, y1: (w.r.y + w.r.h) * H }));
    pages.push({ page: i - 1, jpeg: await engines.jpeg.encode(rgba, W, H, 95, false), width: W, height: H, words });
  }
  await task.destroy();
  return { input: { pages, needles: [...needles], items }, boxes };
}

function qdf(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "pagehold-"));
  try {
    writeFileSync(join(dir, "in.pdf"), bytes);
    const r = spawnSync(qpdfBin(), ["--qdf", "--object-streams=disable", join(dir, "in.pdf"), join(dir, "out.pdf")], { encoding: "utf8" });
    if (r.status !== 0 && r.status !== 3) throw new Error(r.stderr);
    return new TextDecoder("latin1").decode(readFileSync(join(dir, "out.pdf")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const utf16 = (s: string) => [...s].map((c) => "\0" + c).join("");

// The fixture's lines as drawn by corpus.mjs: x 50, size 14, baseline y from the page bottom.
const LINES: [string, number][] = [["Applicant: Tan Wei Ming", 700], ["NRIC: S1234567D", 670], ["Phone: 9123 4567", 640], ["Email: wei.ming@example.com", 610], ["Address: Blk 123 Ang Mo Kio Ave 6, #12-34, Singapore 560123", 580]];

/** Does the box cover its text? Positions come from the real font's metrics, not from the layout code under test. */
function covers(b: Box): string | undefined {
  const [line, y] = LINES.find(([l]) => l.includes(b.text))!;
  const i = line.indexOf(b.text);
  const [sx, ex] = [50 + helv.widthOfTextAtSize(line.slice(0, i), 14), 50 + helv.widthOfTextAtSize(line.slice(0, i + b.text.length), 14)];
  const base = PH - y;
  if (b.x0 > sx) return `"${b.text}": box starts ${(b.x0 - sx).toFixed(1)} pt after the first character`;
  if (b.x1 < ex) return `"${b.text}": box ends ${(ex - b.x1).toFixed(1)} pt before the last character`;
  if (b.y0 > base - 0.73 * 14) return `"${b.text}": box starts below the top of the letters`;
  if (b.y1 < base + 0.21 * 14) return `"${b.text}": box ends above the bottom of the letters`;
  return undefined;
}

describe("redact", () => {
  it("the detectors find what the fixture holds", async () => {
    const { input } = await plan();
    expect(input.needles).toEqual(expect.arrayContaining(["S1234567D", "9123 4567", "wei.ming@example.com"]));
    expect(input.pages).toHaveLength(1);
    expect(input.needles.some((n) => n.startsWith("Blk 123") && n.includes("560123"))).toBe(true);
  });

  it("every hit box fully contains its matched characters (glyph widths measured, not assumed equal)", async () => {
    const { boxes } = await plan("Tan Wei Ming");
    expect(boxes.map((b) => b.text)).toEqual(expect.arrayContaining(["S1234567D", "9123 4567", "wei.ming@example.com", "Tan Wei Ming"]));
    for (const b of boxes) expect(covers(b), covers(b)).toBeUndefined();
  });

  it("the check has teeth: with equal-width layout the boxes drift and miss characters", async () => {
    const { boxes } = await plan(undefined, false);
    expect(boxes.map(covers).some(Boolean)).toBe(true);
  });

  it.skipIf(!canRender)("the redacted page shows no dark pixels in a thin strip just outside any box (nothing of a character is left at an edge)", async () => {
    const { input, boxes } = await plan();
    const r = await redact(file, input, opts(), engines);
    const task = pdfjs.getDocument({ data: new Uint8Array(r.bytes), verbosity: 0, useSystemFonts: false });
    try {
      const doc = await task.promise;
      const img = (await render(doc, 1))!;
      const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4] < 40;
      const strip = (x0: number, y0: number, x1: number, y1: number) => {
        let n = 0;
        for (let y = Math.floor(y0 * S); y < Math.ceil(y1 * S); y++) for (let x = Math.floor(x0 * S); x < Math.ceil(x1 * S); x++) if (dark(x, y)) n++;
        return n;
      };
      for (const b of boxes) {
        // 1 pt gap (JPEG ringing at the black edge), then 1.5 pt of strip, on every side
        const bad = { top: strip(b.x0, b.y0 - 2.5, b.x1, b.y0 - 1), bottom: strip(b.x0, b.y1 + 1, b.x1, b.y1 + 2.5), left: strip(b.x0 - 2, b.y0, b.x0 - 1, b.y1), right: strip(b.x1 + 1, b.y0, b.x1 + 2.5, b.y1) };
        expect(bad, `dark pixels beside the box over "${b.text}"`).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
      }
      // and the boxes themselves are black
      const b = boxes[0];
      expect(dark(Math.round(((b.x0 + b.x1) / 2) * S), Math.round(((b.y0 + b.y1) / 2) * S))).toBe(true);
    } finally {
      await task.destroy();
    }
  });

  it("removes every redacted string from text, bytes, metadata, outline and annotations; the rest stays searchable", async () => {
    const { input } = await plan("Tan Wei Ming");
    const r = await redact(file, input, opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.name).toBe("redact-sample-redacted.pdf");
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/Redacted \d+ items on 1 page\. That page is now an image with a hidden text layer, so text outside the boxes can still be searched and copied\./);

    const pages = await readPdf(r.bytes);
    expect(pages).toHaveLength(2);
    const all = pages.map((p) => p.text).join("\n").toLowerCase();
    for (const n of [...input.needles, "Tan Wei Ming", "S1234567D", "560123", "ming"]) expect(all, `pdf.js text still has "${n}"`).not.toContain(n.toLowerCase());
    expect(pages[0].text).toContain("KEEP-THIS-SENTENCE"); // outside the boxes
    expect(pages[0].text).toContain("searchable");
    expect(pages[1].text).toContain("PAGE-MARKER r2"); // page that was not touched

    const raw = qdf(r.bytes);
    for (const n of [...input.needles, "S1234567D", "Tan Wei Ming", "Application for", "Contact wei"]) {
      expect(raw.toLowerCase(), `bytes have "${n}"`).not.toContain(n.toLowerCase());
      expect(raw, `bytes have "${n}" as UTF-16`).not.toContain(utf16(n));
    }
    expect(raw).not.toMatch(/\/Annots|\/Author|\/Info\b|\/Metadata|\/OpenAction|\/EmbeddedFiles|\/AcroForm/);
    expect(raw).toMatch(/\/Subtype \/Image/); // page 1 is a picture now
    expect(raw).toMatch(/\/Outlines/); // the bookmark stays, its title does not
    expect(raw.toLowerCase()).not.toContain("wei.ming");
    expect(pages[0].w).toBeCloseTo(595.28, 1);
  });

  it("refuses to hand back a file that still holds a redacted string", async () => {
    const { input } = await plan();
    await expect(redact(file, { ...input, needles: [...input.needles, "PAGE-MARKER r2"] }, opts(), engines)).rejects.toThrow(/still contained/);
  });

  it("nothing selected is a plain error", async () => {
    await expect(redact(file, { pages: [], needles: [], items: 0 }, opts(), engines)).rejects.toThrow(/Nothing is selected/);
  });
});
