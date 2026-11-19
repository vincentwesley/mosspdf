import { describe, expect, it } from "vitest";
import { merge, split } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { readInfo } from "../helpers/qpdf";

describe("A-COR-10 output metadata", () => {
  for (const n of ["plain-3p", "forms", "rotated"]) {
    it(`A-COR-10 ${n}: credit on sets Producer and Creator`, async () => {
      const info = await readInfo((await merge([corpus(n)], opts({ producerCredit: true }), engines)).bytes);
      expect(info.Producer).toBe("Pagehold by Vin's Atelier");
      expect(info.Creator).toBe("Pagehold");
    });
    it(`A-COR-10 ${n}: credit off leaves no Producer or Creator (not even a library default)`, async () => {
      const info = await readInfo((await merge([corpus(n)], opts({ producerCredit: false }), engines)).bytes);
      expect(info.Producer).toBeUndefined();
      expect(info.Creator).toBeUndefined();
    });
  }
  it("A-COR-10 split parts follow the same rule", async () => {
    for (const credit of [true, false]) {
      const [p] = await split(corpus("plain-3p"), { kind: "every", n: 3 }, opts({ producerCredit: credit }), engines);
      expect((await readInfo(p.bytes)).Producer).toBe(credit ? "Pagehold by Vin's Atelier" : undefined);
    }
  });
});
