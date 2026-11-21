/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js's Node canvas factory is not in its types */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
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
async function render(doc: pdfjs.PDFDocumentProxy, n: number, extra: Record<string, unknown> = {}) {
  try {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: S });
    const { canvas, context } = (doc as any).canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
    await page.render({ canvasContext: context, viewport: vp, canvas, background: "#ffffff", ...extra } as any).promise;
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
async function plan(extraSearch?: string, measured = true, f = file, whole = false, measureWith = measure): Promise<{ input: RedactInput; boxes: Box[] }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(f.bytes), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const pages: RedactInput["pages"] = [];
  const needles = new Set<string>();
  const boxes: Box[] = [];
  let items = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const pt = layoutText((tc.items as unknown as TextItem[]).filter((it) => "str" in it), vp.transform, vp.width, vp.height, measured ? measureWith : undefined);
    const hits = [...detect(pt.text), ...(extraSearch ? findText(pt.text, extraSearch, whole) : [])];
    if (!hits.length) continue;
    const rects: Rect[] = [];
    for (const h of hits) for (const r of rangeRects(pt, h.start, h.end)) { rects.push(r); boxes.push({ text: h.text, page: i - 1, x0: r.x * PW, y0: r.y * PH, x1: (r.x + r.w) * PW, y1: (r.y + r.h) * PH }); }
    for (const h of hits) for (const t of h.text.split("\n")) if (t.trim()) needles.add(t.trim()); // as the tool: one needle per line
    items += hits.length;
    const pic = await render(doc, i, { annotationMode: 0 }); // as the tool: annotations are not drawn into the picture
    const rgba = pic ? new Uint8Array(pic.data.buffer, pic.data.byteOffset, pic.data.byteLength) : new Uint8Array(W * H * 4).fill(255);
    for (const r of rects) for (let y = Math.floor(r.y * H); y < Math.ceil((r.y + r.h) * H); y++) for (let x = Math.floor(r.x * W); x < Math.ceil((r.x + r.w) * W); x++) { const o = (y * W + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = 0; }
    const words = pt.words.filter((w) => !rects.some((r) => overlaps(w.r, r))).map((w) => ({ text: w.text, conf: 100, eol: false, eop: false, x0: w.r.x * W, y0: w.r.y * H, x1: (w.r.x + w.r.w) * W, y1: (w.r.y + w.r.h) * H }));
    pages.push({ page: i - 1, jpeg: await engines.jpeg.encode(rgba, W, H, 95, false), width: W, height: H, words });
  }
  await task.destroy();
  return { input: { pages, needles: [...needles], items }, boxes };
}

function qdf(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "mosspdf-"));
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
        // 1 pt gap (JPEG ringing at the black edge), then 1.5 pt of strip, above and below
        const bad = { top: strip(b.x0, b.y0 - 2.5, b.x1, b.y0 - 1), bottom: strip(b.x0, b.y1 + 1, b.x1, b.y1 + 2.5) }; // the sides: `covers` above (the box now reaches into the gap to the neighbouring word)
        expect(bad, `dark pixels beside the box over "${b.text}"`).toEqual({ top: 0, bottom: 0 });
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

// Completeness gaps found by the security review (each builds its own small file).
const gaps = {
  pdf: async (build: (doc: PDFDocument, pages: PDFPage[], font: PDFFont) => void | Promise<void>) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = [doc.addPage([595.28, 841.89]), doc.addPage([595.28, 841.89])];
    await build(doc, pages, font);
    return { ...file, bytes: await doc.save({ useObjectStreams: false }) };
  },
  bookmark(doc: PDFDocument, page: PDFPage, title: string) {
    const ctx = doc.context, outlines = ctx.nextRef(), item = ctx.nextRef();
    ctx.assign(item, ctx.obj({ Title: PDFString.of(title), Parent: outlines, Dest: [page.ref, PDFName.of("Fit")] }));
    ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 1 }));
    doc.catalog.set(PDFName.of("Outlines"), outlines);
  },
};
const line = (p: PDFPage, font: PDFFont, s: string, y: number, size = 14) => p.drawText(s, { x: 50, y, size, font });
const raw = (bytes: Uint8Array) => qdf(bytes).toLowerCase();
const firstTitle = async (bytes: Uint8Array) => {
  const d = await PDFDocument.load(bytes);
  const first = (d.catalog.lookup(PDFName.of("Outlines")) as PDFDict).lookup(PDFName.of("First")) as PDFDict;
  return (first.lookup(PDFName.of("Title")) as PDFString | PDFHexString).decodeText();
};

describe("redact: completeness (security review)", () => {
  it("short needles count: 'Tan' scrubs the bookmark 'Tan Ah Kow', the leak scan covers it, and 'Tangent' on a kept page is not a hit", async () => {
    const f = await gaps.pdf((doc, [p1, p2], font) => { line(p1, font, "Client Tan Wei Ming here", 700); line(p2, font, "Tangent stays", 700); gaps.bookmark(doc, p1, "Tan Ah Kow"); });
    const { input } = await plan("Tan", true, f, true);
    expect(input.needles).toEqual(["Tan"]);
    expect(input.pages).toHaveLength(1);
    const r = await redact(f, input, opts(), engines);
    const out = raw(r.bytes);
    expect(await firstTitle(r.bytes)).toBe("[redacted]");
    expect(out).not.toContain("tan ah kow");
    expect((await readPdf(r.bytes))[1].text).toContain("Tangent"); // page 2 is untouched
    // a spot nothing scrubs: the scan must find the short needle there, whole word only
    const bad = await gaps.pdf((doc, [p1, p2], font) => { line(p1, font, "Client Tan Wei Ming here", 700); line(p2, font, "Tangent stays", 700); doc.catalog.set(PDFName.of("Zzz"), PDFString.of("Tan Ah Kow")); });
    await expect(redact(bad, (await plan("Tan", true, bad, true)).input, opts(), engines)).rejects.toThrow(/still contained/);
    const fine = await gaps.pdf((doc, [p1, p2], font) => { line(p1, font, "Client Tan Wei Ming here", 700); line(p2, font, "Tangent stays", 700); doc.catalog.set(PDFName.of("Zzz"), PDFString.of("Tangent")); });
    await expect(redact(fine, (await plan("Tan", true, fine, true)).input, opts(), engines)).resolves.toBeTruthy();
  });

  it.skipIf(!canRender)("a FreeText annotation on a rebuilt page is not burned into the picture, and not in the file", async () => {
    const f = await gaps.pdf((doc, [p1], font) => {
      const ctx = doc.context;
      line(p1, font, "NRIC: S1234567D", 700);
      const ap = ctx.register(ctx.stream("BT /F1 18 Tf 4 14 Td (S7654321F) Tj ET", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 200, 40], Resources: { Font: { F1: font.ref } } }));
      const note = ctx.register(ctx.obj({ Type: "Annot", Subtype: "FreeText", Rect: [300, 400, 500, 440], Contents: PDFString.of("S7654321F"), DA: PDFString.of("/Helv 18 Tf 0 g"), AP: { N: ap }, F: 4 }));
      p1.node.set(PDFName.of("Annots"), ctx.obj([note]));
    });
    const dark = async (bytes: Uint8Array, extra: Record<string, unknown>) => {
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false });
      try {
        const img = (await render(await task.promise, 1, extra))!;
        let n = 0;
        for (let y = Math.floor((PH - 440) * S); y < Math.ceil((PH - 400) * S); y++) for (let x = 300 * S; x < 500 * S; x++) if (img.data[(y * img.width + x) * 4] < 100) n++;
        return n;
      } finally { await task.destroy(); }
    };
    expect(await dark(f.bytes, {}), "the annotation shows with the default render (test has teeth)").toBeGreaterThan(20);
    const { input } = await plan(undefined, true, f);
    const r = await redact(f, input, opts(), engines);
    expect(await dark(r.bytes, {})).toBe(0);
    expect(raw(r.bytes)).not.toMatch(/s7654321f|\/annots|freetext/);
    expect(readFileSync(new URL("../../src/tools/redact.ts", import.meta.url), "utf8")).toMatch(/page\.render\(\{[^}]*annotationMode: 0/); // the tool renders like the plan above
  });

  it("a needle that also sits in text that stays: scrubbed from the bookmark, not a refusal; still caught outside page content", async () => {
    const mk = (extra?: (doc: PDFDocument) => void) => gaps.pdf((doc, [p1, p2], font) => { line(p1, font, "Contact Jonas Lim", 700); line(p2, font, "Jonas stays here", 700); gaps.bookmark(doc, p1, "Jonas Lim"); extra?.(doc); });
    const f = await mk();
    const { input } = await plan("Jonas", true, f);
    const one = { ...input, pages: input.pages.filter((p) => p.page === 0) }; // page 2's hit is unticked
    expect(one.pages).toHaveLength(1);
    await expect(redact(f, one, opts(), engines)).rejects.toThrow(/still contained/);
    const r = await redact(f, { ...one, keptNeedles: ["Jonas"] }, opts(), engines);
    const out = raw(r.bytes);
    expect(out).not.toContain("jonas lim");
    expect(await firstTitle(r.bytes)).toBe("[redacted]");
    const bad = await mk((doc) => doc.catalog.set(PDFName.of("Zzz"), PDFString.of("Jonas")));
    await expect(redact(bad, { ...one, keptNeedles: ["Jonas"] }, opts(), engines)).rejects.toThrow(/still contained/);
  });

  it("named destinations, page-label prefixes and layer names that hold a needle are scrubbed", async () => {
    const f = await gaps.pdf((doc, [p1, p2], font) => {
      const ctx = doc.context;
      line(p1, font, "Hello John Smith", 700);
      doc.catalog.set(PDFName.of("Dests"), ctx.obj({ Home: [p1.ref, PDFName.of("Fit")] }));
      doc.catalog.set(PDFName.of("Names"), ctx.obj({ Dests: { Names: [PDFString.of("John desk"), [p2.ref, PDFName.of("Fit")]] } }));
      doc.catalog.set(PDFName.of("PageLabels"), ctx.obj({ Nums: [0, { S: "D", P: PDFString.of("John-") }, 1, { S: "D", P: PDFString.of("Annex-") }] }));
      const g = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("John layer") }));
      doc.catalog.set(PDFName.of("OCProperties"), ctx.obj({ OCGs: [g], D: {} }));
    });
    const r = await redact(f, (await plan("John", true, f)).input, opts(), engines);
    const out = raw(r.bytes);
    expect(out).not.toMatch(/john|\/dests|home/);
    expect(out).toContain("annex-"); // other labels stay
    expect(out).toContain("feff004c0061007900650072"); // the layer is renamed "Layer"
  });

  it.each([
    ["a name with #xx escapes", "name"],
    ["a literal string with an octal escape", "octal"],
    ["a literal string with a backslash escape", "escape"],
    ["a hex string", "hex"],
    ["a UTF-16 hex string", "hex16"],
  ])("the leak scan sees a needle written as %s", async (_label, kind) => {
    const place = (doc: PDFDocument) => {
      const c = doc.catalog;
      if (kind === "name") c.set(PDFName.of("Zzz"), PDFName.of("Jxxxxx"));
      if (kind === "octal") c.set(PDFName.of("Zzz"), PDFString.of("Jo\\150n"));
      if (kind === "escape") c.set(PDFName.of("Zzz"), PDFString.of("J" + String.fromCharCode(92) + "ohn"));
      if (kind === "hex") c.set(PDFName.of("Zzz"), PDFHexString.of("4A6F686E"));
      if (kind === "hex16") c.set(PDFName.of("Zzz"), PDFHexString.of("FEFF004A006F0068006E"));
    };
    const make = async (withIt: boolean) => {
      const f = await gaps.pdf((doc, [p1], font) => { line(p1, font, "Hello John Smith", 700); if (withIt) place(doc); });
      if (kind === "name") f.bytes = new Uint8Array(Buffer.from(Buffer.from(f.bytes).toString("latin1").replace("/Jxxxxx", "/J#6Fhn"), "latin1")); // same length: the xref stays valid
      return f;
    };
    const clean = await make(false);
    await expect(redact(clean, (await plan("John", true, clean)).input, opts(), engines)).resolves.toBeTruthy();
    const bad = await make(true);
    await expect(redact(bad, (await plan("John", true, bad)).input, opts(), engines)).rejects.toThrow(/still contained/);
  });

  it("a phrase split over a line wrap is found, and both parts are boxed", async () => {
    expect(findText("call Tan Wei\nMing now", "Tan Wei Ming", false).map((h) => h.text)).toEqual(["Tan Wei\nMing"]);
    expect(findText("Jonathan Pe-\nreira", "Pereira", false).map((h) => h.text)).toEqual(["Pe-\nreira"]);
    expect(findText("1-\n2", "12", false)).toHaveLength(0); // a hyphen only joins letters
    expect(detect("ring 9123\n4567 now").map((h) => h.text)).toEqual(["9123\n4567"]);
    const f = await gaps.pdf((_doc, [p1], font) => { line(p1, font, "Meet Tan Wei", 700); line(p1, font, "Ming is away until tomorrow", 686); });
    const { input, boxes } = await plan("Tan Wei Ming", true, f);
    expect(boxes.map((b) => b.text)).toEqual(["Tan Wei\nMing", "Tan Wei\nMing"]);
    expect(boxes[0].y0).toBeLessThan(boxes[1].y0); // two lines, two boxes
    expect(boxes[0].x0).toBeLessThanOrEqual(50 + helv.widthOfTextAtSize("Meet ", 14));
    expect(boxes[0].x1).toBeGreaterThanOrEqual(50 + helv.widthOfTextAtSize("Meet Tan Wei", 14));
    expect(boxes[1].x0).toBeLessThanOrEqual(50);
    expect(boxes[1].x1).toBeGreaterThanOrEqual(50 + helv.widthOfTextAtSize("Ming", 14));
    expect(input.needles).toEqual(["Tan Wei", "Ming"]);
    const r = await redact(f, input, opts(), engines);
    expect((await readPdf(r.bytes))[0].text).toContain("tomorrow");
    expect((await readPdf(r.bytes))[0].text).not.toContain("Ming");
  });

  it.skipIf(!canRender)("a word mid-line in a differently-proportioned font is covered although the measured widths come from another font", async () => {
    const times = await (await PDFDocument.create()).embedFont(StandardFonts.TimesRoman);
    const text = "Dear friends, please phone Jonathan Pereira about the invoice";
    const f = await gaps.pdf(async (doc, [p1]) => { p1.drawText(text, { x: 50, y: 700, size: 14, font: await doc.embedFont(StandardFonts.TimesRoman) }); });
    const { input, boxes } = await plan("Pereira", true, f); // widths measured with Helvetica: the mismatch the padding has to absorb
    const i = text.indexOf("Pereira");
    const [sx, ex] = [50 + times.widthOfTextAtSize(text.slice(0, i), 14), 50 + times.widthOfTextAtSize(text.slice(0, i + 7), 14)];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x0, "box starts after the first letter").toBeLessThanOrEqual(sx);
    expect(boxes[0].x1, "box ends before the last letter").toBeGreaterThanOrEqual(ex);
    const r = await redact(f, input, opts(), engines);
    const task = pdfjs.getDocument({ data: new Uint8Array(r.bytes), verbosity: 0, useSystemFonts: false });
    try {
      const img = (await render(await task.promise, 1))!;
      let n = 0; // light pixels inside the word's real extent: the page must be black there
      for (let y = Math.floor((PH - 700 - 0.7 * 14) * S); y < Math.ceil((PH - 700 + 0.2 * 14) * S); y++) for (let x = Math.ceil((sx + 1) * S); x < Math.floor((ex - 1) * S); x++) if (img.data[(y * img.width + x) * 4] > 128) n++;
      expect(n).toBe(0);
    } finally { await task.destroy(); }
  });
});
