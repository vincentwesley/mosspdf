import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assemble, merge, parseRanges, split } from "../../src/ops";
import type { PageSpec } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { marker, qpdfCheck, qpdfJson, readPdf } from "../helpers/qpdf";

const sources = [corpus("plain-3p"), corpus("rotated"), corpus("mixed-sizes")];
// marker prefix, page count and the rotation each page already has
const meta = [
  { pre: "p", rot: [0, 0, 0] },
  { pre: "r", rot: [0, 90, 180, 270] },
  { pre: "m", rot: [0, 0, 0] },
];
const spec = fc.nat(2).chain((source) => fc.record({ source: fc.constant(source), page: fc.nat(meta[source].rot.length - 1), rotate: fc.constantFrom(0, 90, 180, 270) as fc.Arbitrary<PageSpec["rotate"]> }));

describe("A-COR-2 page operations keep count, order, rotation and text", () => {
  it("A-COR-2 property: assemble with random pages and rotations", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(spec, { minLength: 1, maxLength: 8 }), async (pages) => {
        const r = await assemble(sources, pages, "out", opts({ producerCredit: false }), engines);
        const got = await readPdf(r.bytes);
        expect(got.map(marker)).toEqual(pages.map((p) => `${meta[p.source].pre}${p.page + 1}`));
        expect(got.map((g) => g.rotate)).toEqual(pages.map((p) => (meta[p.source].rot[p.page] + p.rotate) % 360));
      }),
      { numRuns: 20 },
    );
  });

  it("A-COR-2 merge keeps page order across files", async () => {
    const r = await merge(sources, opts(), engines);
    qpdfCheck(r.bytes);
    expect((await readPdf(r.bytes)).map(marker)).toEqual(["p1", "p2", "p3", "r1", "r2", "r3", "r4", "m1", "m2", "m3"]);
    expect(r.name).toBe("merged.pdf");
  });

  it("A-COR-2 mixed page sizes survive merge", async () => {
    const r = await merge([sources[2]], opts(), engines);
    const got = await readPdf(r.bytes);
    expect(got.map((p) => [Math.round(p.w), Math.round(p.h)])).toEqual([[595, 842], [612, 792], [1191, 842]]);
  });

  it("A-COR-2 extract, delete and reorder", async () => {
    const f = sources[0];
    const ex = await assemble([f], [{ source: 0, page: 2, rotate: 0 }], "report", opts(), engines);
    expect((await readPdf(ex.bytes)).map(marker)).toEqual(["p3"]);
    const del = await assemble([f], [0, 2].map((page) => ({ source: 0, page, rotate: 0 as const })), "x", opts(), engines);
    expect((await readPdf(del.bytes)).map(marker)).toEqual(["p1", "p3"]);
    const re = await assemble([f], [2, 0, 1, 0].map((page) => ({ source: 0, page, rotate: 0 as const })), "x", opts(), engines);
    expect((await readPdf(re.bytes)).map(marker)).toEqual(["p3", "p1", "p2", "p1"]);
  });

  it("A-COR-2 split by ranges, every N and size", async () => {
    const f = corpus("text-1000p");
    const noCredit = opts({ producerCredit: false });
    const a = await split(f, { kind: "ranges", ranges: "1-3, 5, 998-" }, noCredit, engines);
    expect(a.map((r) => r.name)).toEqual(["text-1000p-pages-1-3.pdf", "text-1000p-page-5.pdf", "text-1000p-pages-998-1000.pdf"]);
    expect((await readPdf(a[2].bytes)).map(marker)).toEqual(["k998", "k999", "k1000"]);
    const b = await split(sources[0], { kind: "every", n: 2 }, noCredit, engines);
    expect(b.map((r) => r.name)).toEqual(["plain-3p-pages-1-2.pdf", "plain-3p-page-3.pdf"]);
    const limit = Math.floor(f.bytes.length / 4);
    const c = await split(f, { kind: "size", maxBytes: limit }, noCredit, engines);
    expect(c.length).toBeGreaterThanOrEqual(4);
    expect(c.every((r) => r.bytes.length <= limit)).toBe(true);
    const all = (await Promise.all(c.map((r) => readPdf(r.bytes)))).flat().map(marker);
    expect(all).toHaveLength(1000);
    expect(all[0]).toBe("k1");
    expect(all[999]).toBe("k1000");
  });

  it("A-COR-2 forms and links are kept on page copy; outlines are reported as dropped", async () => {
    const f = await merge([corpus("forms"), corpus("forms")], opts({ producerCredit: false }), engines);
    const acro = qpdfJson(f.bytes, "acroform").acroform as { fields: { fullname: string }[] };
    expect(acro.fields.length).toBe(10); // 5 widgets per copy (radio has two)
    expect(new Set(acro.fields.map((x) => x.fullname)).size).toBe(8);
    expect(f.warnings.map((w) => w.code)).toContain("forms-renamed");
    const l = await merge([corpus("links-annots")], opts(), engines);
    const objs = JSON.stringify(qpdfJson(l.bytes, "qpdf"));
    expect(objs).toContain("https://example.com/");
    expect(objs).toContain("/Link");
    const o = await merge([corpus("outline")], opts(), engines);
    expect(o.warnings.map((w) => w.code)).toContain("outline-dropped");
    const s = await merge([corpus("signed")], opts(), engines);
    expect(s.warnings.map((w) => w.code)).toContain("signature-invalidated");
  });

  it("A-COR-2 inputs are never mutated", async () => {
    const f = corpus("plain-3p");
    const g = corpus("broken-xref");
    const e = corpus("encrypted-aes256", { password: "test-pass" });
    const before = [f, g, e].map((x) => Buffer.from(x.bytes));
    await merge([f, g, e], opts(), engines);
    [f, g, e].forEach((x, i) => expect(Buffer.from(x.bytes).equals(before[i])).toBe(true));
  });

  it("A-COR-2 parseRanges accepts good input and gives friendly errors", () => {
    expect(parseRanges("1-3, 5, 8-", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
    for (const bad of ["", "abc", "0", "11", "5-2", "1-99"]) expect(() => parseRanges(bad, 10)).toThrowError(/page|pages|range|Type|backwards/i);
    try {
      parseRanges("11", 10);
    } catch (e) {
      expect((e as { code: string }).code).toBe("unsupported");
    }
  });

  it("A-COR-2 reports out-of-range pages and empty selections as typed errors", async () => {
    await expect(assemble(sources, [{ source: 0, page: 9, rotate: 0 }], "x", opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(assemble(sources, [], "x", opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
  });
});
