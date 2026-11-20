import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addPageNumbers, watermark } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { findText, qpdfCheck, readInfo, readPdf } from "../helpers/qpdf";

const noMarker = (t: string) => t.replace(/PAGE-MARKER \S+/, "").trim();
const CREDIT = "Pagehold by Vin's Atelier";

describe("A-COR-6 page numbers", () => {
  it("A-COR-6 numbers every selected page (and only those), file is valid", async () => {
    const r = await addPageNumbers(corpus("text-500p"), { pages: [0, 1, 499], format: "Page {n} of {total}" }, opts(), engines);
    qpdfCheck(r.bytes);
    const pages = await readPdf(r.bytes);
    expect(noMarker(pages[0].text)).toBe("Page 1 of 3");
    expect(noMarker(pages[1].text)).toBe("Page 2 of 3");
    expect(noMarker(pages[499].text)).toBe("Page 3 of 3");
    expect(noMarker(pages[2].text)).toBe("");
  });
  it("A-COR-6 startAt and all pages", async () => {
    const r = await addPageNumbers(corpus("plain-3p"), { startAt: 7 }, opts(), engines);
    expect((await readPdf(r.bytes)).map((p) => noMarker(p.text))).toEqual(["7", "8", "9"]);
  });
  const pos = { "bottom-left": [0, 0], "bottom-center": [0.5, 0], "bottom-right": [1, 0], "top-left": [0, 1], "top-center": [0.5, 1], "top-right": [1, 1] } as const;
  for (const rotFile of ["rotated", "rotated-crop"]) {
    for (const [name, [fx, fy]] of Object.entries(pos)) {
      it(`A-COR-6 ${rotFile} ${name}: upright and at the visual position`, async () => {
        const r = await addPageNumbers(corpus(rotFile), { position: name as keyof typeof pos, format: "NUM{n}", fontSize: 12, margin: 30 }, opts(), engines);
        qpdfCheck(r.bytes);
        for (let i = 0; i < 4; i++) {
          const t = await findText(r.bytes, i, `NUM${i + 1}`);
          expect(t, `page ${i + 1}`).toBeDefined();
          expect(Math.abs(t!.angle)).toBeLessThan(0.5);
          const w = 12 * 0.55 * 4;
          const cx = fx === 0 ? 30 : fx === 1 ? t!.w - 30 - w : (t!.w - w) / 2;
          expect(Math.abs(t!.x - cx)).toBeLessThan(10);
          const cy = fy === 0 ? 30 : t!.h - 30 - 9;
          expect(Math.abs(t!.y - cy)).toBeLessThan(6);
        }
      });
    }
  }
  it("A-COR-6 bad inputs give typed errors", async () => {
    await expect(addPageNumbers(corpus("plain-3p"), { pages: [5] }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(addPageNumbers(corpus("plain-3p"), { pages: [] }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(addPageNumbers(corpus("plain-3p"), { format: "no placeholder" }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(addPageNumbers(corpus("plain-3p"), { format: "Seite {n} 中" }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(addPageNumbers(corpus("empty"), {}, opts(), engines)).rejects.toMatchObject({ code: "empty" });
    await expect(addPageNumbers(corpus("encrypted-aes256"), {}, opts(), engines)).rejects.toMatchObject({ code: "encrypted" });
  });
  it("A-COR-6 encrypted input with password works and says it was decrypted", async () => {
    const r = await addPageNumbers(corpus("encrypted-aes256", { password: "test-pass" }), {}, opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.warnings.map((w) => w.code)).toContain("decrypted");
  });
  it("A-COR-6 cancellation", async () => {
    const c = new AbortController();
    c.abort();
    await expect(addPageNumbers(corpus("plain-3p"), {}, opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("A-COR-6 input bytes are never mutated", async () => {
    const f = corpus("plain-3p");
    const copy = f.bytes.slice();
    await addPageNumbers(f, {}, opts(), engines);
    expect(f.bytes).toEqual(copy);
  });
  it("A-COR-10 credit on sets Producer, off leaves the original", async () => {
    expect((await readInfo((await addPageNumbers(corpus("plain-3p"), {}, opts(), engines)).bytes)).Producer).toBe(CREDIT);
    expect((await readInfo((await addPageNumbers(corpus("plain-3p"), {}, opts({ producerCredit: false }), engines)).bytes)).Producer).toBe("pdf-lib (test default)");
  });
  it("A-COR-6 1000 pages stay fast", async () => {
    const t = Date.now();
    const r = await addPageNumbers(corpus("text-1000p"), {}, opts(), engines);
    expect(Date.now() - t).toBeLessThan(15_000);
    expect((await readPdf(r.bytes)).length).toBe(1000);
  });
  it("A-COR-6 format placeholders always render (property)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5000 }), fc.constantFrom("{n}", "p.{n}/{total}", "- {n} -"), async (start, format) => {
        const r = await addPageNumbers(corpus("plain-3p"), { startAt: start, format, pages: [1] }, opts({ producerCredit: false }), engines);
        expect(noMarker((await readPdf(r.bytes))[1].text)).toBe(format.replace("{n}", String(start)).replace("{total}", String(start)));
      }),
      { numRuns: 8 },
    );
  });
});

describe("A-COR-6 watermark", () => {
  it("A-COR-6 text extractable on selected pages only, over and under, valid file", async () => {
    for (const layer of ["over", "under"] as const) {
      const r = await watermark(corpus("plain-3p"), { text: "DRAFT", pages: [0, 2], layer, opacity: 0.4 }, opts(), engines);
      qpdfCheck(r.bytes);
      const pages = await readPdf(r.bytes);
      expect(pages[0].text).toContain("DRAFT");
      expect(pages[1].text).not.toContain("DRAFT");
      expect(pages[2].text).toContain("DRAFT");
      expect(pages.map((p) => p.text).join(" ")).toContain("PAGE-MARKER p2");
    }
  });
  it("A-COR-6 stays upright relative to rotation and centred (angle 0)", async () => {
    for (const f of ["rotated", "rotated-crop"]) {
      const r = await watermark(corpus(f), { text: "CONFIDENTIAL", angle: 0, fontSize: 20 }, opts(), engines);
      for (let i = 0; i < 4; i++) {
        const t = (await findText(r.bytes, i, "CONFIDENTIAL"))!;
        expect(Math.abs(t.angle)).toBeLessThan(0.5);
        expect(Math.abs(t.x + 6 * 20 * 0.6 - t.w / 2)).toBeLessThan(25);
        expect(Math.abs(t.y - t.h / 2)).toBeLessThan(10);
      }
    }
  });
  it("A-COR-6 default diagonal is 45 degrees on screen, also on rotated pages", async () => {
    const r = await watermark(corpus("rotated"), { text: "COPY" }, opts(), engines);
    for (let i = 0; i < 4; i++) expect(Math.abs((await findText(r.bytes, i, "COPY"))!.angle - 45)).toBeLessThan(0.5);
  });
  it("A-COR-6 non-WinAnsi text is refused with the characters named", async () => {
    const err = await watermark(corpus("plain-3p"), { text: "Hello 世界" }, opts(), engines).catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported" });
    expect(err.message).toContain("世");
    await expect(watermark(corpus("plain-3p"), { text: "  " }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(watermark(corpus("plain-3p"), { text: "x", color: "red" }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(watermark(corpus("plain-3p"), { text: "x", opacity: 3 }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
  });
  it("A-COR-6 accepts WinAnsi extras (accents, euro)", async () => {
    const r = await watermark(corpus("plain-3p"), { text: "Café €5" }, opts(), engines);
    expect((await readPdf(r.bytes))[0].text).toContain("Café");
  });
  it("A-COR-10 credit on/off", async () => {
    expect((await readInfo((await watermark(corpus("plain-3p"), { text: "x" }, opts(), engines)).bytes)).Producer).toBe(CREDIT);
    expect((await readInfo((await watermark(corpus("plain-3p"), { text: "x" }, opts({ producerCredit: false }), engines)).bytes)).Producer).toBe("pdf-lib (test default)");
  });
  it("A-COR-6 cancellation", async () => {
    const c = new AbortController();
    c.abort();
    await expect(watermark(corpus("plain-3p"), { text: "x" }, opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
});
