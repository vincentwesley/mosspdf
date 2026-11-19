import { describe, expect, it } from "vitest";
import { repair } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

describe("repair", () => {
  it("@A-COR-1 a healthy file is re-written and reported as undamaged", async () => {
    const r = await repair(corpus("plain-3p"), opts(), engines);
    qpdfCheck(r.bytes);
    expect(r).toMatchObject({ repaired: false, pagesAfter: 3, complete: true, pagesBefore: null });
    expect(r.warnings).toEqual([]);
    expect((await readPdf(r.bytes)).length).toBe(3);
  });

  it("@A-COR-3 a broken xref is repaired and said so", async () => {
    const r = await repair(corpus("broken-xref"), opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.repaired).toBe(true);
    expect(r.pagesAfter).toBe(3);
    expect(r.complete).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("repaired");
    expect(r.actions.join(" ")).toMatch(/cross-reference/);
  });

  it("@A-COR-3 truncated and corrupt: never claims full success when pages are lost, else a typed error", async () => {
    for (const name of ["truncated", "corrupt"]) {
      const r: Awaited<ReturnType<typeof repair>> | Error = await repair(corpus(name), opts(), engines).catch((e: Error) => e);
      if (r instanceof Error) {
        expect(r).toMatchObject({ name: "PdfError" });
        continue;
      }
      qpdfCheck(r.bytes, true);
      expect(r.repaired, name).toBe(true);
      expect(r.warnings.length, name).toBeGreaterThan(0);
      if (r.pagesBefore !== null && r.pagesBefore > r.pagesAfter) {
        expect(r.complete).toBe(false);
        expect(r.warnings.map((w) => w.code)).toContain("pages-lost");
      }
    }
  });

  it("@A-COR-3 empty, not-pdf and wrong-password inputs give typed errors", async () => {
    await expect(repair(corpus("empty"), opts(), engines)).rejects.toMatchObject({ code: "empty" });
    await expect(repair(corpus("renamed-png"), opts(), engines)).rejects.toMatchObject({ code: "not-pdf" });
    await expect(repair(corpus("encrypted-aes256", { password: "bad" }), opts(), engines)).rejects.toMatchObject({ code: "wrong-password" });
  });
});
