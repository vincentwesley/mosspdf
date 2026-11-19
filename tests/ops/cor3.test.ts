import { describe, expect, it } from "vitest";
import { assemble, inspect, merge, split } from "../../src/ops";
import { PdfError } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const guard = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("hung")), 20_000))]);
const attempt = async (name: string, extra = {}) => {
  try {
    return { ok: await guard(merge([corpus(name, extra)], opts(), engines)) };
  } catch (e) {
    return { err: e };
  }
};

describe("A-COR-3 bad inputs give a valid output or a typed, readable error, never a hang", () => {
  const cases: [string, string, object?][] = [
    ["empty", "empty"],
    ["renamed-png", "not-pdf"],
    ["renamed-text", "not-pdf"],
    ["encrypted-aes256", "encrypted"],
    ["encrypted-rc4-40", "encrypted"],
    ["encrypted-aes256", "wrong-password", { password: "nope" }],
  ];
  for (const [name, code, extra] of cases) {
    it(`A-COR-3 ${name} -> ${code}`, async () => {
      const r = await attempt(name, extra);
      expect(r.err).toBeInstanceOf(PdfError);
      const err = r.err as PdfError;
      expect(err.code).toBe(code);
      expect(err.message.length).toBeGreaterThan(20);
      expect(err.message).not.toMatch(/qpdf|pdf-lib|wasm|stack|undefined/i);
      expect(err.fileName).toBe(`${name}.pdf`);
    });
  }
  for (const name of ["corrupt", "truncated", "broken-xref"]) {
    it(`A-COR-3 ${name}: valid output or typed error`, async () => {
      const r = await attempt(name);
      if (r.ok) {
        qpdfCheck(r.ok.bytes, true);
        expect(r.ok.warnings.map((w) => w.code)).toContain("repaired");
        expect((await readPdf(r.ok.bytes)).length).toBeGreaterThan(0);
      } else {
        expect(r.err).toBeInstanceOf(PdfError);
        expect((r.err as PdfError).code).toBe("corrupt");
      }
    });
  }
  it("A-COR-3 inspect reports the password need without throwing, and the right password works", async () => {
    const i = await inspect(corpus("encrypted-aes256"), engines);
    expect(i).toMatchObject({ encrypted: true, needsPassword: true });
    const ok = await inspect(corpus("encrypted-aes256", { password: "test-pass" }), engines);
    expect(ok).toMatchObject({ encrypted: true, needsPassword: false, pageCount: 3 });
  });
  it("A-COR-3 inspect describes the corpus", async () => {
    expect(await inspect(corpus("forms"), engines)).toMatchObject({ hasForms: true, hasSignatures: false, pageCount: 1 });
    expect(await inspect(corpus("signed"), engines)).toMatchObject({ hasSignatures: true });
    expect(await inspect(corpus("javascript"), engines)).toMatchObject({ hasJavaScript: true });
    expect(await inspect(corpus("outline"), engines)).toMatchObject({ hasOutline: true, pageCount: 4 });
    const m = await inspect(corpus("mixed-sizes"), engines);
    expect(m.pageSizes.map((s) => Math.round(s.w))).toEqual([595, 612, 1191]);
    expect((await inspect(corpus("rotated"), engines)).pageSizes.map((s) => s.rotate)).toEqual([0, 90, 180, 270]);
    expect((await inspect(corpus("plain-3p"), engines)).title).toBe("Quarterly notes (made up)");
    expect((await inspect(corpus("broken-xref"), engines)).repaired).toBe(true);
    await expect(inspect(corpus("empty"), engines)).rejects.toMatchObject({ code: "empty" });
  });
  it("A-COR-3 cancelling stops before any work", async () => {
    const c = new AbortController();
    c.abort();
    await expect(merge([corpus("plain-3p")], opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
    await expect(split(corpus("plain-3p"), { kind: "every", n: 1 }, opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
    await expect(assemble([corpus("plain-3p")], [{ source: 0, page: 0, rotate: 0 }], "x", opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
});
