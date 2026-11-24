import { describe, expect, it } from "vitest";
import { MAX_BYTES, parseSaved } from "../../src/ui/savedsigs";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==";
const one = { kind: "signature", png };

describe("parseSaved", () => {
  it("keeps valid PNG entries", () => expect(parseSaved(JSON.stringify([one, { kind: "initials", png }]))).toHaveLength(2));
  it("rejects non-PNG data, bad kinds, bad base64 and junk", () => {
    expect(parseSaved(JSON.stringify([{ kind: "signature", png: btoa("<svg onload=x>") }]))).toEqual([]);
    expect(parseSaved(JSON.stringify([{ kind: "date", png }, { kind: "signature", png: png + "!!" }, { kind: "signature" }, null, 5]))).toEqual([]);
    expect(parseSaved("{not json")).toEqual([]);
    expect(parseSaved(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseSaved(null)).toEqual([]);
  });
  it("rejects oversized pictures", () => expect(parseSaved(JSON.stringify([{ kind: "signature", png: png.slice(0, 11) + "A".repeat(Math.ceil((MAX_BYTES * 4) / 3)) }]))).toEqual([]));
  it("keeps at most 4", () => expect(parseSaved(JSON.stringify(Array(7).fill(one)))).toHaveLength(4));
});
