import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { stampPage } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { findText, qpdfCheck, readPdf } from "../helpers/qpdf";

const png = new Uint8Array(readFileSync(new URL("../corpus/generated/photo-alpha.png", import.meta.url))); // 400 x 300
const IMG = { fx: 0.1, fy: 0.2, fw: 0.3 };

/** Where the stamped picture ended up on page `i`, as displayed (points from the top left), read back through pdf.js. */
async function imageBox(bytes: Uint8Array, i: number) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    const p = await doc.getPage(i + 1);
    const vp = p.getViewport({ scale: 1 });
    const { fnArray, argsArray } = await p.getOperatorList();
    let cm: number[] | undefined;
    const found: number[][] = [];
    fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.transform) cm = argsArray[k] as number[];
      if (fn === pdfjs.OPS.paintImageXObject && cm) found.push(cm);
    });
    expect(found).toHaveLength(1);
    const [a, b, c, d, e, f] = found[0];
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => { const ux = a * x + c * y + e, uy = b * x + d * y + f, m = vp.transform; return [m[0] * ux + m[2] * uy + m[4], m[1] * ux + m[3] * uy + m[5]]; });
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), W: vp.width, H: vp.height };
  } finally {
    await task.destroy();
  }
}

describe("M4 stampPage", () => {
  for (const name of ["rotated", "rotated-crop"]) {
    it(`${name}: the picture lands at the same spot of every page as displayed (0/90/180/270, CropBox)`, async () => {
      const r = await stampPage(corpus(name), { images: [png], items: [{ kind: "image", image: 0, pages: "all", ...IMG }] }, opts(), engines);
      qpdfCheck(r.bytes);
      expect(r.name).toBe(`${name}-signed.pdf`);
      for (let i = 0; i < 4; i++) {
        const b = await imageBox(r.bytes, i);
        expect(Math.abs(b.left - IMG.fx * b.W), `page ${i + 1} left`).toBeLessThan(0.5);
        expect(Math.abs(b.top - IMG.fy * b.H), `page ${i + 1} top`).toBeLessThan(0.5);
        expect(Math.abs(b.w - IMG.fw * b.W), `page ${i + 1} width`).toBeLessThan(0.5);
        expect(Math.abs(b.h - (IMG.fw * b.W * 300) / 400), `page ${i + 1} height`).toBeLessThan(0.5);
      }
    });
    it(`${name}: text is upright at the displayed position`, async () => {
      const r = await stampPage(corpus(name), { images: [], items: [{ kind: "text", text: "SIGNED-HERE", size: 14, fx: 0.25, fy: 0.5, pages: "all" }] }, opts(), engines);
      qpdfCheck(r.bytes);
      for (let i = 0; i < 4; i++) {
        const t = await findText(r.bytes, i, "SIGNED-HERE");
        expect(t, `page ${i + 1}`).toBeDefined();
        expect(Math.abs(t!.angle)).toBeLessThan(0.5);
        expect(Math.abs(t!.x - 0.25 * t!.w)).toBeLessThan(0.5);
        expect(Math.abs(t!.y - (t!.h - 0.5 * t!.h))).toBeLessThan(0.5);
      }
    });
  }
  it("only the chosen pages get the item; the image is embedded once for many pages", async () => {
    const r = await stampPage(corpus("plain-3p"), { images: [png], items: [{ kind: "image", image: 0, pages: [0, 2], ...IMG }, { kind: "text", text: "Hello", size: 12, fx: 0.1, fy: 0.9, pages: [1] }] }, opts(), engines);
    qpdfCheck(r.bytes);
    const text = (await readPdf(r.bytes)).map((p) => p.text.includes("Hello"));
    expect(text).toEqual([false, true, false]);
    expect((Buffer.from(r.bytes).toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBeLessThanOrEqual(2); // image + its soft mask
  });
  it("bad input gives plain errors", async () => {
    const f = corpus("plain-3p");
    await expect(stampPage(f, { images: [], items: [] }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(stampPage(f, { images: [], items: [{ kind: "text", text: "李", size: 12, fx: 0, fy: 0, pages: "all" }] }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(stampPage(f, { images: [], items: [{ kind: "text", text: "x", size: 12, fx: 0, fy: 0, pages: [9] }] }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(stampPage(f, { images: [new Uint8Array([1, 2, 3])], items: [{ kind: "image", image: 0, ...IMG, pages: [0] }] }, opts(), engines)).rejects.toMatchObject({ code: "corrupt" });
  });
  it("signed input warns", async () => {
    const r = await stampPage(corpus("signed"), { images: [], items: [{ kind: "text", text: "x", size: 12, fx: 0.1, fy: 0.1, pages: "all" }] }, opts(), engines);
    expect(r.warnings.map((w) => w.code)).toContain("signature-invalidated");
  });
});
