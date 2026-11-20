import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { detect, findText } from "../../src/core/detect";
import { layoutText, overlaps, rangeRects, type Rect, type TextItem } from "../../src/core/textpos";
import { redact, type RedactInput } from "../../src/ops";
import { qpdfBin } from "../../scripts/qpdf-bin.mjs";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const W = 300, H = 424;
const file = corpus("redact-sample");

/** What the tool does in the browser, with pdf.js in Node: read the text, detect, paint the boxes, keep the words outside them. */
async function plan(extraSearch?: string): Promise<{ input: RedactInput; texts: string[] }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(file.bytes), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const pages: RedactInput["pages"] = [];
  const needles = new Set<string>();
  const texts: string[] = [];
  let items = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const pt = layoutText((tc.items as unknown as TextItem[]).filter((it) => "str" in it), vp.transform, vp.width, vp.height);
    texts.push(pt.text);
    const hits = [...detect(pt.text), ...(extraSearch ? findText(pt.text, extraSearch, false) : [])];
    if (!hits.length) continue;
    const rects: Rect[] = hits.flatMap((h) => rangeRects(pt, h.start, h.end));
    hits.forEach((h) => needles.add(h.text));
    items += hits.length;
    const rgba = new Uint8Array(W * H * 4).fill(255);
    for (const r of rects) for (let y = Math.floor(r.y * H); y < Math.ceil((r.y + r.h) * H); y++) for (let x = Math.floor(r.x * W); x < Math.ceil((r.x + r.w) * W); x++) { const o = (y * W + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = 0; }
    const words = pt.words.filter((w) => !rects.some((r) => overlaps(w.r, r))).map((w) => ({ text: w.text, conf: 100, eol: false, eop: false, x0: w.r.x * W, y0: w.r.y * H, x1: (w.r.x + w.r.w) * W, y1: (w.r.y + w.r.h) * H }));
    pages.push({ page: i - 1, jpeg: await engines.jpeg.encode(rgba, W, H, 80, false), width: W, height: H, words });
  }
  await task.destroy();
  return { input: { pages, needles: [...needles], items }, texts };
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

describe("redact", () => {
  it("the detectors find what the fixture holds", async () => {
    const { input } = await plan();
    expect(input.needles).toEqual(expect.arrayContaining(["S1234567D", "9123 4567", "wei.ming@example.com"]));
    expect(input.pages).toHaveLength(1);
    expect(input.needles.some((n) => n.startsWith("Blk 123") && n.includes("560123"))).toBe(true);
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
