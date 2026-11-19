import { describe, expect, it } from "vitest";
import { merge } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { readPdf } from "../helpers/qpdf";

describe("performance smoke", () => {
  it("A-E2E-7 (node) merging two 500-page files takes under 10 s", async () => {
    const f = corpus("text-500p");
    const t = Date.now();
    const r = await merge([f, f], opts(), engines);
    expect(Date.now() - t).toBeLessThan(10_000);
    expect((await readPdf(r.bytes)).length).toBe(1000);
  });
});
