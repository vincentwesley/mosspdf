import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { merge } from "../../src/ops/assemble";
import { readOutline, setOutline, type BookmarkItem } from "../../src/ops/outline";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck } from "../helpers/qpdf";

const pdf = async (n: number, name = "t.pdf") => {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([200, 200]);
  return { name, bytes: await d.save() };
};
const read = (f: { name: string; bytes: Uint8Array }) => readOutline(f, {}, engines);

describe("outline", () => {
  it("round trip: write then read gives the same tree, Unicode titles included", async () => {
    const items: BookmarkItem[] = [
      { title: "Intro", page: 1, level: 0 },
      { title: "Cafe été 中文", page: 2, level: 1 },
      { title: "Deep", page: 3, level: 2 },
      { title: "Next", page: 4, level: 0 },
      { title: "Nowhere", page: null, level: 1 },
    ];
    const r = await setOutline(await pdf(4), { items }, opts(), engines);
    qpdfCheck(r.bytes);
    const back = await read({ name: "o.pdf", bytes: r.bytes });
    expect(back).toEqual({ items, pageCount: 4 });
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.catalog.lookup(PDFName.of("PageMode"))).toBe(PDFName.of("UseOutlines"));
  });

  it("clamps a level that jumps too deep, rejects a page that does not exist, and clearing removes the outline", async () => {
    const f = await pdf(2);
    const r = await setOutline(f, { items: [{ title: "a", page: 1, level: 2 }, { title: "b", page: 2, level: 2 }] }, opts(), engines);
    expect((await read({ name: "o.pdf", bytes: r.bytes })).items.map((i) => i.level)).toEqual([0, 1]);
    await expect(setOutline(f, { items: [{ title: "x", page: 9, level: 0 }] }, opts(), engines)).rejects.toThrow(/page 9/);
    const cleared = await setOutline({ name: "o.pdf", bytes: r.bytes }, { items: [] }, opts(), engines);
    expect((await read({ name: "o.pdf", bytes: cleared.bytes })).items).toEqual([]);
    expect((await PDFDocument.load(cleared.bytes)).catalog.lookup(PDFName.of("PageMode"))).toBeUndefined();
  });

  it("reads the corpus outline", async () => {
    const r = await read(corpus("outline"));
    expect(r.pageCount).toBe(4);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.page !== null)).toBe(true);
  });

  it("merge: one bookmark per file at its first page, existing bookmarks nested with remapped pages", async () => {
    const a = await pdf(2, "a.pdf");
    const o = corpus("outline");
    const own = await read(o);
    const r = await merge([a, o], opts(), engines, { bookmarks: true });
    qpdfCheck(r.bytes);
    expect(r.warnings.map((w) => w.code)).not.toContain("outline-dropped");
    const back = await read({ name: "m.pdf", bytes: r.bytes });
    expect(back.pageCount).toBe(6);
    expect(back.items[0]).toEqual({ title: "a", page: 1, level: 0 });
    expect(back.items[1]).toEqual({ title: "outline", page: 3, level: 0 });
    expect(back.items.slice(2).map((i) => [i.title, i.page])).toEqual(own.items.map((i) => [i.title, i.page! + 2]));
    expect(back.items.slice(2).every((i, k) => i.level === Math.min(own.items[k].level + 1, 2))).toBe(true);
  });

  it("merge without the option keeps the old behaviour", async () => {
    const r = await merge([corpus("outline")], opts(), engines);
    expect(r.warnings.map((w) => w.code)).toContain("outline-dropped");
  });
});
