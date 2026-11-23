import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { addBlankPages, bookletOrder, nupPages } from "../../src/ops";
import { engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

/** n pages marked "P1".."Pn" (portrait Letter unless sized). */
async function marked(n: number, size: [number, number] = [612, 792]) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) d.addPage(size).drawText(`P${i}`, { x: 100, y: 100, size: 40, font: f });
  return { name: "m.pdf", bytes: await d.save() };
}
const words = (t: string) => t.match(/P\d+/g) ?? [];

describe("nup", () => {
  it("2 per sheet: landscape sheets of the first page's size, pages left then right", async () => {
    const r = await nupPages(await marked(5), { layout: "2" }, opts(), engines);
    qpdfCheck(r.bytes);
    const pages = await readPdf(r.bytes);
    expect(pages).toHaveLength(3);
    expect([pages[0].w, pages[0].h]).toEqual([792, 612]);
    expect(pages.map((p) => words(p.text))).toEqual([["P1", "P2"], ["P3", "P4"], ["P5"]]);
  });
  it("4 per sheet keeps portrait, and A4 / Letter override the size", async () => {
    const r = await nupPages(await marked(5), { layout: "4", sheet: "a4", border: true }, opts(), engines);
    qpdfCheck(r.bytes);
    const pages = await readPdf(r.bytes);
    expect(pages.map((p) => words(p.text))).toEqual([["P1", "P2", "P3", "P4"], ["P5"]]);
    expect([Math.round(pages[0].w), Math.round(pages[0].h)]).toEqual([595, 842]);
    const l = (await readPdf((await nupPages(await marked(2), { layout: "2", sheet: "letter" }, opts(), engines)).bytes))[0];
    expect([l.w, l.h]).toEqual([792, 612]);
  });
  it("booklet order pads to a multiple of 4 and pairs outer pages", async () => {
    expect(bookletOrder(8)).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]]);
    expect(bookletOrder(6)).toEqual([[null, 0], [1, null], [5, 2], [3, 4]]);
    const r = await nupPages(await marked(6), { layout: "booklet" }, opts(), engines);
    qpdfCheck(r.bytes);
    expect((await readPdf(r.bytes)).map((p) => words(p.text))).toEqual([["P1"], ["P2"], ["P6", "P3"], ["P4", "P5"]]);
  });
  it("handles a rotated page and a blank page without content", async () => {
    const d = await PDFDocument.create();
    d.addPage([200, 100]).setRotation(degrees(90));
    d.addPage([200, 100]).drawText("P2", { x: 10, y: 10, size: 20, font: await d.embedFont(StandardFonts.Helvetica) });
    const r = await nupPages({ name: "r.pdf", bytes: await d.save() }, { layout: "2" }, opts(), engines);
    qpdfCheck(r.bytes);
    const pages = await readPdf(r.bytes);
    expect(words(pages[0].text)).toEqual(["P2"]);
    expect([pages[0].w, pages[0].h]).toEqual([200, 100]); // first page shows 100 x 200, the sheet is its landscape
  });
});

describe("add blank pages", () => {
  const sizes = async (b: Uint8Array) => (await readPdf(b)).map((p) => [p.w, p.h]);
  it("before first, after last, after every page and after page N", async () => {
    const f = await marked(3);
    const t = async (o: Parameters<typeof addBlankPages>[1]) => (await readPdf((await addBlankPages(f, o, opts(), engines)).bytes)).map((p) => words(p.text)[0] ?? "-");
    expect(await t({ where: "start", count: 2 })).toEqual(["-", "-", "P1", "P2", "P3"]);
    expect(await t({ where: "end", count: 1 })).toEqual(["P1", "P2", "P3", "-"]);
    expect(await t({ where: "every", count: 1 })).toEqual(["P1", "-", "P2", "-", "P3", "-"]);
    expect(await t({ where: "after", page: 2, count: 2 })).toEqual(["P1", "P2", "-", "-", "P3"]);
    qpdfCheck((await addBlankPages(f, { where: "every", count: 1 }, opts(), engines)).bytes);
  });
  it("blank pages take the neighbouring page's size and reject bad input", async () => {
    const d = await PDFDocument.create();
    d.addPage([200, 300]);
    d.addPage([400, 100]);
    const f = { name: "s.pdf", bytes: await d.save() };
    expect(await sizes((await addBlankPages(f, { where: "every", count: 1 }, opts(), engines)).bytes)).toEqual([[200, 300], [200, 300], [400, 100], [400, 100]]);
    expect(await sizes((await addBlankPages(f, { where: "start", count: 1 }, opts(), engines)).bytes)).toEqual([[200, 300], [200, 300], [400, 100]]);
    await expect(addBlankPages(f, { where: "after", page: 3, count: 1 }, opts(), engines)).rejects.toThrow(/doesn't exist/);
    await expect(addBlankPages(f, { where: "end", count: 11 }, opts(), engines)).rejects.toThrow(/1 to 10/);
  });
});
