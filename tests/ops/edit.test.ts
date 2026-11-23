import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { editPages, type EditItem } from "../../src/ops";
import { setUnicodeFont } from "../../src/ops/ufont";
import { corpus, engines, opts } from "../helpers/env";
import { findText, qpdfCheck, readPdf } from "../helpers/qpdf";

const noto = new Uint8Array(readFileSync(new URL("../../src/fonts/notosans-unicode-400-normal.ttf", import.meta.url)));
const run = (name: string, items: EditItem[]) => editPages(corpus(name), { items }, opts(), engines);
const raw = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("editPages", () => {
  it("draws every kind, keeps the old text, names the file -edited", async () => {
    const r = await run("plain-3p", [
      { kind: "text", page: 0, text: "Hello EDIT", size: 14, color: "#c62828", x: 0.1, y: 0.2 },
      { kind: "whiteout", page: 0, x: 0.1, y: 0.3, w: 0.3, h: 0.05 },
      { kind: "highlight", page: 1, x: 0.1, y: 0.3, w: 0.3, h: 0.05 },
      { kind: "rect", page: 1, color: "#1a3a8a", stroke: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.1 },
      { kind: "line", page: 2, color: "#000000", stroke: 1, x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5 },
    ]);
    qpdfCheck(r.bytes);
    expect(r.name).toBe("plain-3p-edited.pdf");
    const s = raw(r.bytes);
    expect(s).toContain("1 1 1 rg"); // white-out
    expect(s).toMatch(/\/BM\s*\/Multiply/); // highlight
    expect(s).toMatch(/ re S/); // rectangle outline
    expect(s).toMatch(/ l S/); // line
    const pages = await readPdf(r.bytes);
    expect(pages[0].text).toContain("Hello EDIT");
    expect(pages[0].text).toContain("PAGE-MARKER p1"); // what was there is still there
  });
  it("text can be Unicode (Noto Sans), extractable", async () => {
    setUnicodeFont(noto);
    const r = await run("plain-3p", [{ kind: "text", page: 0, text: "Žluťoučký Ελληνικά Привет", size: 12, x: 0.1, y: 0.3 }]);
    qpdfCheck(r.bytes);
    expect((await readPdf(r.bytes))[0].text).toContain("Žluťoučký Ελληνικά Привет");
    await expect(run("plain-3p", [{ kind: "text", page: 0, text: "ழ", size: 12, x: 0.1, y: 0.3 }])).rejects.toMatchObject({ code: "unsupported" });
  });
  it("rotated and cropped pages: text upright at the displayed spot, boxes at the displayed rectangle", async () => {
    for (const name of ["rotated", "rotated-crop"]) {
      const box = { x: 0.2, y: 0.3, w: 0.25, h: 0.1 };
      const items: EditItem[] = [0, 1, 2, 3].flatMap((page): EditItem[] => [{ kind: "text", page, text: "EDITED-HERE", size: 14, x: 0.25, y: 0.5 }, { kind: "whiteout", page, ...box }]);
      const r = await run(name, items);
      qpdfCheck(r.bytes);
      for (let i = 0; i < 4; i++) {
        const t = await findText(r.bytes, i, "EDITED-HERE");
        expect(t, `page ${i + 1}`).toBeDefined();
        expect(Math.abs(t!.angle)).toBeLessThan(0.5);
        expect(Math.abs(t!.x - 0.25 * t!.w)).toBeLessThan(0.5);
        expect(Math.abs(t!.y - 0.5 * t!.h)).toBeLessThan(0.5);
        const b = await whiteBox(r.bytes, i);
        expect(Math.abs(b.left - box.x * b.W), `page ${i + 1} left`).toBeLessThan(0.5);
        expect(Math.abs(b.top - box.y * b.H), `page ${i + 1} top`).toBeLessThan(0.5);
        expect(Math.abs(b.w - box.w * b.W), `page ${i + 1} w`).toBeLessThan(0.5);
        expect(Math.abs(b.h - box.h * b.H), `page ${i + 1} h`).toBeLessThan(0.5);
      }
    }
  });
  it("picture: embedded as an image XObject on the page (PNG and JPEG)", async () => {
    const gen = (n: string) => new Uint8Array(readFileSync(new URL(`../corpus/generated/${n}`, import.meta.url)));
    const images = [{ bytes: gen("photo-alpha.png"), jpeg: false }, { bytes: gen("photo-small.jpg"), jpeg: true }];
    const r = await editPages(corpus("plain-3p"), { items: [{ kind: "image", page: 0, image: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, { kind: "image", page: 1, image: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.2 }], images }, opts(), engines);
    qpdfCheck(r.bytes);
    const s = raw(r.bytes);
    expect(s).toMatch(/\/Subtype\s*\/Image/);
    expect(s).toMatch(/\/DCTDecode/);
    expect(s).toMatch(/\/PHI-?\d* Do|\/PHI\w* Do/);
    await expect(editPages(corpus("plain-3p"), { items: [{ kind: "image", page: 0, image: 3, x: 0, y: 0, w: 0.1, h: 0.1 }], images }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
  });
  it("bold text uses Helvetica-Bold for Latin text, regular otherwise", async () => {
    const r = await run("plain-3p", [{ kind: "text", page: 0, text: "Strong", size: 14, bold: true, color: "#ffffff", x: 0.1, y: 0.2 }]);
    qpdfCheck(r.bytes);
    expect(raw(r.bytes)).toContain("/BaseFont /Helvetica-Bold");
    const r2 = await run("plain-3p", [{ kind: "text", page: 0, text: "Plain", size: 14, x: 0.1, y: 0.2 }]);
    expect(raw(r2.bytes)).not.toContain("Helvetica-Bold");
  });
  it("bad input gives plain errors", async () => {
    await expect(run("plain-3p", [])).rejects.toMatchObject({ code: "unsupported" });
    await expect(run("plain-3p", [{ kind: "whiteout", page: 9, x: 0, y: 0, w: 0.1, h: 0.1 }])).rejects.toMatchObject({ message: expect.stringContaining("3 pages") });
    await expect(run("plain-3p", [{ kind: "line", page: 0, stroke: 0, x1: 0, y1: 0, x2: 1, y2: 1 }])).rejects.toMatchObject({ code: "unsupported" });
  });
});

/** The white rectangle as displayed (points from the top left), read through pdf.js: the last constructPath filled after a transform. */
async function whiteBox(bytes: Uint8Array, i: number) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    const p = await doc.getPage(i + 1);
    const vp = p.getViewport({ scale: 1 });
    const { fnArray, argsArray } = await p.getOperatorList();
    let cm: number[] = [1, 0, 0, 1, 0, 0];
    let found: { cm: number[]; path: Float32Array } | undefined;
    const stack: number[][] = [];
    fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.save) stack.push(cm);
      else if (fn === pdfjs.OPS.restore) cm = stack.pop() ?? cm;
      else if (fn === pdfjs.OPS.transform) { const [a, b, c, d, e, f] = argsArray[k] as number[]; const [A, B, C, D, E, F] = cm; cm = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F]; }
      else if (fn === pdfjs.OPS.constructPath && (argsArray[k] as unknown[])[0] === pdfjs.OPS.fill) found = { cm, path: (argsArray[k] as unknown[][])[1][0] as Float32Array };
    });
    expect(found).toBeDefined();
    // the path data is [moveTo, x, y, lineTo, ...]: take every (x, y) pair after each op code
    const xy: [number, number][] = [];
    const d = found!.path;
    for (let k = 0; k < d.length;) { if (d[k] === 0 || d[k] === 1) { xy.push([d[k + 1], d[k + 2]]); k += 3; } else if (d[k] === 2) k += 7; else k += 1; }
    const pts = xy.map(([x, y]) => { const m = found!.cm, ux = m[0] * x + m[2] * y + m[4], uy = m[1] * x + m[3] * y + m[5], t = vp.transform; return [t[0] * ux + t[2] * uy + t[4], t[1] * ux + t[3] * uy + t[5]]; });
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), W: vp.width, H: vp.height };
  } finally {
    await task.destroy();
  }
}
