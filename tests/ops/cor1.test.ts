import { describe, expect, it } from "vitest";
import { assemble, merge, split } from "../../src/ops";
import type { OpResult } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const valid = ["plain-3p", "mixed-sizes", "rotated", "links-annots", "outline", "forms", "signed", "javascript"];
const damaged = ["broken-xref", "truncated"];

async function verify(r: OpResult, pages: number, allowWarnings = false) {
  qpdfCheck(r.bytes, allowWarnings);
  expect((await readPdf(r.bytes)).length).toBe(pages);
}

describe("A-COR-1 every op output passes qpdf --check and re-opens in pdf.js", () => {
  for (const n of valid) {
    it(`A-COR-1 ${n}: merge, assemble, split`, async () => {
      const f = corpus(n);
      const m = await merge([f, f], opts(), engines);
      const count = (await readPdf(m.bytes)).length;
      expect(count % 2).toBe(0);
      await verify(m, count);
      const a = await assemble([f], [{ source: 0, page: 0, rotate: 90 }], "x", opts(), engines);
      await verify(a, 1);
      for (const part of await split(f, { kind: "every", n: 1 }, opts(), engines)) await verify(part, 1);
    });
  }
  for (const n of damaged) {
    it(`A-COR-1 ${n} (repaired): merge and split give valid files`, async () => {
      const f = corpus(n);
      const m = await merge([f], opts(), engines);
      expect(m.warnings.map((w) => w.code)).toContain("repaired");
      await verify(m, 3, true);
    });
  }
  it("A-COR-1 encrypted inputs open with the password and the output is unencrypted", async () => {
    for (const n of ["encrypted-aes256", "encrypted-rc4-40"]) {
      const r = await merge([corpus(n, { password: "test-pass" })], opts(), engines);
      await verify(r, 3);
      expect((await readPdf(r.bytes)).map((p) => p.text)).toEqual(["PAGE-MARKER p1", "PAGE-MARKER p2", "PAGE-MARKER p3"]);
    }
  });
  it("A-COR-1 large files: 1,000 pages split every 250, image-heavy merge", async () => {
    const parts = await split(corpus("text-1000p"), { kind: "every", n: 250 }, opts({ producerCredit: false }), engines);
    expect(parts).toHaveLength(4);
    await verify(parts[3], 250);
    const img = await merge([corpus("image-heavy")], opts({ producerCredit: false }), engines);
    qpdfCheck(img.bytes);
  });
});
