import { describe, expect, it } from "vitest";
import { detect, findText, mask, nricValid, type Kind } from "../../src/core/detect";
import { readExif } from "../../src/core/exif";
import { layoutText } from "../../src/core/textpos";
import { readFileSync } from "node:fs";

const found = (s: string, kind: Kind) => detect(s).filter((h) => h.kind === kind).map((h) => h.text);

describe("NRIC / FIN", () => {
  it("checksum for S, T, F, G", () => {
    for (const ok of ["S1234567D", "S0000001I", "T0123456G", "F1234567N", "G1234567X"]) expect(nricValid(ok), ok).toBe(true);
    for (const bad of ["S1234567A", "S1234567E", "T0123456A", "F1234567D", "X1234567D", "S123456D", "S12345678D"]) expect(nricValid(bad), bad).toBe(false);
  });
  it("M numbers are format-only and flagged", () => {
    expect(nricValid("M1234567K")).toBeUndefined();
    const h = detect("ID M1234567K here").find((x) => x.kind === "nric")!;
    expect(h.text).toBe("M1234567K");
    expect(h.note).toMatch(/Check this one/);
  });
  it("finds valid ones in text, ignores wrong checksums and look-alikes", () => {
    expect(found("NRIC: S1234567D, FIN F1234567N.", "nric")).toEqual(["S1234567D", "F1234567N"]);
    expect(found("s1234567d", "nric")).toEqual(["s1234567d"]);
    expect(found("S1234567A", "nric")).toEqual([]);
    expect(found("XS1234567D", "nric")).toEqual([]);
    expect(found("S1234567D1", "nric")).toEqual([]);
    expect(found("ref S12345678", "nric")).toEqual([]);
  });
});

describe("phone numbers", () => {
  it("SG numbers with optional +65, space or hyphen", () => {
    expect(found("Call 9123 4567 or +65 6123-4567 or 81234567 or +6591234567.", "phone")).toEqual(["9123 4567", "+65 6123-4567", "81234567", "+6591234567"]);
    expect(found("3123 4567", "phone")).toEqual(["3123 4567"]);
  });
  it("not other digit runs", () => {
    expect(found("order 1234 5678", "phone")).toEqual([]); // starts with 1
    expect(found("5123 4567", "phone")).toEqual([]);
    expect(found("code 912345678", "phone")).toEqual([]); // 9 digits
    expect(found("id 12345 9123 4567", "phone")).toHaveLength(1); // the phone-shaped tail is still shown for review
    expect(found("S1234567D", "phone")).toEqual([]);
    expect(found("Singapore 689123", "phone")).toEqual([]);
  });
});

describe("emails", () => {
  it("finds addresses", () => {
    expect(found("mail wei.ming+x@example.com.sg, or a_b@c-d.org.", "email")).toEqual(["wei.ming+x@example.com.sg", "a_b@c-d.org"]);
  });
  it("not things that are not", () => {
    expect(found("user@ example.com", "email")).toEqual([]);
    expect(found("@handle and a@b", "email")).toEqual([]);
  });
});

describe("addresses and postal codes", () => {
  it("a block address with unit and postal code is one hit", () => {
    const hits = detect("Address: Blk 123 Ang Mo Kio Ave 6, #12-34, Singapore 560123 end");
    expect(hits.map((h) => [h.kind, h.text])).toEqual([["address", "Blk 123 Ang Mo Kio Ave 6, #12-34, Singapore 560123"]]);
  });
  it("street addresses", () => {
    expect(found("Visit 12 Orchard Road today", "address")).toEqual(["12 Orchard Road"]);
    expect(found("10 Anson Road #05-01", "address")).toEqual(["10 Anson Road #05-01"]);
    expect(found("Block 45 Toa Payoh Lorong 5 Street", "address")).toHaveLength(1);
    expect(found("5 Marine Parade Drive", "address")).toEqual(["5 Marine Parade Drive"]);
  });
  it("unit numbers alone", () => {
    expect(found("Unit #12-34 please", "address")).toEqual(["#12-34"]);
    expect(found("issue #12 and #3-", "address")).toEqual([]);
  });
  it("postal codes near Singapore / S( only", () => {
    expect(found("Singapore 560123", "postal")).toEqual(["560123"]);
    expect(found("Singapore (560123)", "postal")).toEqual(["560123"]);
    expect(found("S(560123)", "postal")).toEqual(["560123"]);
    expect(found("order 560123 shipped", "postal")).toEqual([]);
    expect(found("Singapore 56012", "postal")).toEqual([]);
    expect(found("Singapore 5601234", "postal")).toEqual([]);
  });
  it("ordinary sentences are left alone", () => {
    expect(found("I paid 3 dollars for the road trip", "address")).toEqual([]);
    expect(found("We sold 12 big cats on the Road", "address")).toEqual([]);
    expect(detect("Quarterly notes: revenue grew 12% in 2026.")).toEqual([]);
  });
});

describe("search and masks", () => {
  it("case-insensitive, whole words optional", () => {
    expect(findText("Tan tan TAN stand", "tan", false).map((h) => h.start)).toEqual([0, 4, 8, 13]);
    expect(findText("Tan tan TAN stand", "tan", true).map((h) => h.start)).toEqual([0, 4, 8]);
    expect(findText("a.b (c)", "a.b", false)).toHaveLength(1); // regex characters are literal
    expect(findText("x", "  ", false)).toEqual([]);
    expect(findText("naÃ¯ve cafÃ©", "cafÃ©", true)).toHaveLength(1);
  });
  it("masks keep the shape", () => {
    expect(mask("S1234567D")).toBe("S****567D");
    expect(mask("9123 4567")).toBe("9****4567");
    expect(mask("ab")).toBe("a*");
    expect(mask("abcdef")).toBe("a****f");
    expect(mask("x")).toBe("x");
  });
});

describe("text positions", () => {
  const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], width, hasEOL });
  // viewport for a 200 x 100 pt upright page: y flips
  const vt = [1, 0, 0, -1, 0, 100];
  it("maps match ranges to boxes across items and keeps lines apart", () => {
    const pt = layoutText([item("NRIC: ", 10, 80, 30), item("S1234567D", 40, 80, 45, true), item("next line", 10, 60, 45)], vt, 200, 100);
    expect(pt.text).toBe("NRIC: S1234567D\nnext line");
    expect(pt.words.map((w) => w.text)).toEqual(["NRIC:", "S1234567D", "next", "line"]);
    const w = pt.words[1].r;
    expect(w.x * 200).toBeCloseTo(40, 3);
    expect(w.w * 200).toBeCloseTo(45, 3);
    expect(w.y * 100).toBeCloseTo(100 - 80 - 10, 3); // top of the glyph box, y down
  });
  it("adds a space between separate items on a line", () => {
    const pt = layoutText([item("9123", 10, 80, 20), item("4567", 40, 80, 20)], vt, 200, 100);
    expect(pt.text).toBe("9123 4567");
  });
});

describe("EXIF reader", () => {
  const jpg = (n: string) => new Uint8Array(readFileSync(new URL(`../corpus/generated/${n}`, import.meta.url)));
  it("reads camera, date and GPS presence from the fixture", () => {
    expect(readExif(jpg("photo-gps.jpg"))).toEqual({ hasExif: true, camera: "PagerCam PH-1", date: "2026-01-02 03:04:05", gps: true });
  });
  it("no EXIF, not a JPEG, damaged", () => {
    expect(readExif(jpg("photo-small.jpg"))).toEqual({ hasExif: false, gps: false });
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({ hasExif: false, gps: false });
    expect(readExif(new Uint8Array(0)).hasExif).toBe(false);
    const cut = jpg("photo-gps.jpg").slice(0, 40);
    expect(() => readExif(cut)).not.toThrow();
  });
  it("EXIF without a GPS block says so", () => {
    const b = jpg("photo-gps.jpg").slice();
    // turn the GPS pointer tag 0x8825 into an unknown tag
    const at = b.findIndex((_, i) => b[i] === 0x25 && b[i + 1] === 0x88 && b[i - 1] === 0x00);
    expect(at).toBeGreaterThan(0);
    b[at] = 0x26;
    expect(readExif(b)).toMatchObject({ hasExif: true, gps: false, camera: "PagerCam PH-1" });
  });
});
