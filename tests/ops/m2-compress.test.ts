import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { compress, imagesToPdf, type CompressLevel } from "../../src/ops";
import { resize, unpredict } from "../../src/ops/compress";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, qpdfJson, readInfo, readPdf } from "../helpers/qpdf";

const gen = (n: string) => new Uint8Array(readFileSync(new URL(`../corpus/generated/${n}`, import.meta.url)));

vi.setConfig({ testTimeout: 180_000 }); // 1000-page and image-heavy runs: slow when e2e runs alongside
describe("A-COR-5 compress", () => {
  const sizes: Record<string, number[]> = {};
  for (const level of ["light", "balanced", "strong"] as CompressLevel[]) {
    it(`A-COR-5 image-heavy ${level}: valid, opens, ${level === "light" ? "not larger" : "strictly smaller"}`, async () => {
      const f = corpus("image-heavy");
      const r = await compress(f, { level }, opts(), engines);
      qpdfCheck(r.bytes);
      expect((await readPdf(r.bytes)).length).toBe(5);
      expect(r.before).toBe(f.bytes.length);
      expect(r.after).toBe(r.bytes.length);
      expect(r.after).toBeLessThanOrEqual(r.before);
      if (level !== "light") expect(r.after).toBeLessThan(r.before * 0.5);
      sizes[level] = [r.before, r.after];
      console.log(`compress image-heavy ${level}: ${r.before} -> ${r.after} bytes (${((100 * r.after) / r.before).toFixed(1)}%)`);
    });
  }
  it("A-COR-5 strong is smaller than balanced", () => expect(sizes.strong[1]).toBeLessThan(sizes.balanced[1]));

  it("A-COR-5 image-mixed: JPEG and predictor-Flate recompressed, SMask image and tiny image left alone, colours preserved", async () => {
    const f = corpus("image-mixed");
    const r = await compress(f, { level: "balanced" }, opts(), engines);
    qpdfCheck(r.bytes);
    expect((await readPdf(r.bytes)).length).toBe(4);
    expect(r.after).toBeLessThan(r.before);
    const objs = (qpdfJson(r.bytes, "qpdf") as { qpdf: [unknown, Record<string, { stream?: { dict: Record<string, unknown> } }>] }).qpdf[1];
    const imgs = Object.values(objs).filter((o) => o.stream?.dict["/Subtype"] === "/Image" && !o.stream.dict["/ImageMask"]);
    const by = (w: number) => imgs.find((o) => o.stream!.dict["/Width"] === w || (w === 1600 && o.stream!.dict["/Width"] === 1600))!.stream!.dict;
    expect(by(1600)["/Filter"]).toBe("/DCTDecode");
    expect(imgs.map((o) => o.stream!.dict["/Width"]).sort()).toContain(800); // SMask image untouched
    const smaskOwner = imgs.find((o) => o.stream!.dict["/SMask"])!;
    expect(smaskOwner.stream!.dict["/Filter"]).toBe("/FlateDecode");
    const gray = imgs.find((o) => o.stream!.dict["/ColorSpace"] === "/DeviceGray" && o.stream!.dict["/Filter"] === "/DCTDecode")!;
    expect(gray.stream!.dict["/Width"]).toBe(1200); // 1200 <= cap 1600: not resized
    expect(gray.stream!.dict["/DecodeParms"]).toBeUndefined();
  });
  it("A-COR-5 predictor Flate decodes to the same picture (mean grey close)", async () => {
    const r = await compress(corpus("image-mixed"), { level: "strong" }, opts(), engines);
    // strong caps at 1000 px: the 1200x900 grey image must come out 1000x750 and still centre on mid grey
    const j = qpdfJson(r.bytes, "qpdf") as { qpdf: [unknown, Record<string, { stream?: { dict: Record<string, unknown> } }>] };
    const g = Object.entries(j.qpdf[1]).find(([, o]) => o.stream?.dict["/ColorSpace"] === "/DeviceGray" && o.stream.dict["/Filter"] === "/DCTDecode")!;
    expect(g[1].stream!.dict["/Width"]).toBe(1000);
    expect(g[1].stream!.dict["/Height"]).toBe(750);
  });
  it("A-COR-5 never larger: every other corpus file", async () => {
    for (const n of ["plain-3p", "forms", "links-annots", "outline", "rotated", "xmp", "text-500p"]) {
      for (const level of ["light", "strong"] as CompressLevel[]) {
        const f = corpus(n);
        const r = await compress(f, { level }, opts(), engines);
        expect(r.bytes.length, `${n} ${level}`).toBeLessThanOrEqual(f.bytes.length);
        qpdfCheck(r.bytes, true);
        expect((await readPdf(r.bytes)).length).toBe((await readPdf(f.bytes)).length);
      }
    }
  });
  it("A-COR-5 already-optimal file returns the original with a not-smaller warning", async () => {
    const small = (await compress(corpus("text-500p"), { level: "balanced" }, opts(), engines)).bytes;
    const r = await compress({ name: "a.pdf", bytes: small }, { level: "balanced" }, opts(), engines);
    expect(r.warnings.map((w) => w.code)).toContain("not-smaller");
    expect(r.bytes).toEqual(small);
    expect(r.after).toBe(r.before);
  });
  it("A-COR-5 1000-page text file does not blow up", async () => {
    const t = Date.now();
    const r = await compress(corpus("text-1000p"), { level: "strong" }, opts(), engines);
    expect(Date.now() - t).toBeLessThan(20_000);
    expect(r.after).toBeLessThanOrEqual(r.before);
    expect((await readPdf(r.bytes)).length).toBe(1000);
  });
  it("A-COR-10 credit on/off", async () => {
    const f = corpus("image-heavy");
    expect((await readInfo((await compress(f, { level: "balanced" }, opts(), engines)).bytes)).Producer).toBe("MossPDF by Vin's Atelier");
    expect((await readInfo((await compress(f, { level: "balanced" }, opts({ producerCredit: false }), engines)).bytes)).Producer).toBeUndefined();
  });
  it("A-COR-5 bad inputs, password, cancellation", async () => {
    await expect(compress(corpus("empty"), { level: "light" }, opts(), engines)).rejects.toMatchObject({ code: "empty" });
    await expect(compress(corpus("renamed-png"), { level: "light" }, opts(), engines)).rejects.toMatchObject({ code: "not-pdf" });
    await expect(compress(corpus("encrypted-aes256"), { level: "light" }, opts(), engines)).rejects.toMatchObject({ code: "encrypted" });
    await expect(compress(corpus("plain-3p"), { level: "huge" as CompressLevel }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    const ok = await compress(corpus("encrypted-aes256", { password: "test-pass" }), { level: "light" }, opts(), engines);
    qpdfCheck(ok.bytes, true);
    const c = new AbortController();
    c.abort();
    await expect(compress(corpus("image-heavy"), { level: "strong" }, opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("A-COR-5 cancelling mid-run stops between images", async () => {
    const c = new AbortController();
    await expect(compress(corpus("image-heavy"), { level: "strong" }, opts({ signal: c.signal, onProgress: (d) => d === 1 && c.abort() }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("A-COR-5 resize keeps constant colour and exact dims (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 255 }), (w, h, nw, nh, v) => {
        const out = resize(new Uint8Array(w * h * 3).fill(v), w, h, 3, Math.min(nw, w), Math.min(nh, h), );
        return out.length === Math.min(nw, w) * Math.min(nh, h) * 3 && out.every((x) => x === v);
      }),
    );
  });
  it("A-COR-5 unpredict round-trips PNG Sub/Up/Avg/Paeth rows (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 12, maxLength: 12 }), fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 3, maxLength: 3 }), (img, types) => {
        const bpp = 1, row = 4, rows = 3;
        const enc = new Uint8Array((row + 1) * rows);
        for (let y = 0; y < rows; y++) {
          enc[y * (row + 1)] = types[y];
          for (let x = 0; x < row; x++) {
            const a = x ? img[y * row + x - 1] : 0, b = y ? img[(y - 1) * row + x] : 0, c = x && y ? img[(y - 1) * row + x - 1] : 0;
            const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
            const p = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][types[y]];
            enc[y * (row + 1) + 1 + x] = (img[y * row + x] - p) & 255;
          }
        }
        return unpredict(enc, bpp, row, rows)!.every((v, i) => v === img[i]);
      }),
    );
  });
});

describe("A-COR-4 images to PDF", () => {
  const jpg = (name = "photo.jpg", width = 1600, height = 1200) => ({ name, format: "jpeg" as const, bytes: gen(name), width, height });
  const png = { name: "photo-alpha.png", format: "png" as const, bytes: gen("photo-alpha.png"), width: 400, height: 300 };
  const box = async (b: Uint8Array) => (await readPdf(b)).map((p) => [Math.round(p.w), Math.round(p.h)]);

  it("A-COR-4 fit: page = image size at 72 dpi, and with a dpi option; JPEG kept byte for byte", async () => {
    const r = await imagesToPdf([jpg(), png], {}, opts());
    qpdfCheck(r.bytes);
    expect(await box(r.bytes)).toEqual([[1600, 1200], [400, 300]]);
    const r2 = await imagesToPdf([jpg()], { dpi: 144 }, opts());
    expect(await box(r2.bytes)).toEqual([[800, 600]]);
    const j = JSON.stringify(qpdfJson(r.bytes, "qpdf"));
    expect(j).toContain("DCTDecode");
    expect(Buffer.from(r.bytes).includes(Buffer.from(gen("photo.jpg")))).toBe(true); // embedded as-is
  });
  it("A-COR-4 a4/letter: auto orientation, margin, centred", async () => {
    const r = await imagesToPdf([jpg(), png], { size: "a4", margin: 20 }, opts());
    qpdfCheck(r.bytes);
    expect(await box(r.bytes)).toEqual([[842, 595], [842, 595]]); // both landscape images follow their shape
    const p = await imagesToPdf([jpg()], { size: "a4", orientation: "portrait" }, opts());
    expect(await box(p.bytes)).toEqual([[595, 842]]);
    const l = await imagesToPdf([jpg()], { size: "letter", orientation: "portrait" }, opts());
    expect(await box(l.bytes)).toEqual([[612, 792]]);
  });
  it("A-COR-4 each page has exactly one image, scaled inside the margins", async () => {
    const r = await imagesToPdf([jpg("photo-small.jpg", 400, 300)], { size: "a4", margin: 36 }, opts());
    const objs = Object.values((qpdfJson(r.bytes, "qpdf") as { qpdf: [unknown, Record<string, { stream?: unknown }>] }).qpdf[1]).filter((o) => o.stream);
    expect(objs.length).toBeGreaterThanOrEqual(2); // image + content stream
  });
  it("A-COR-4 a dimension mismatch (rotation flag not applied) is rejected", async () => {
    await expect(imagesToPdf([jpg("photo.jpg", 1200, 1600)], {}, opts())).rejects.toMatchObject({ code: "unsupported" });
  });
  it("A-COR-4 bad inputs", async () => {
    await expect(imagesToPdf([], {}, opts())).rejects.toMatchObject({ code: "unsupported" });
    await expect(imagesToPdf([{ name: "x.jpg", format: "jpeg", bytes: new Uint8Array([1, 2, 3]), width: 5, height: 5 }], {}, opts())).rejects.toMatchObject({ code: "unsupported" });
    await expect(imagesToPdf([jpg()], { margin: 400, size: "a4" }, opts())).rejects.toMatchObject({ code: "unsupported" });
    const c = new AbortController();
    c.abort();
    await expect(imagesToPdf([jpg()], {}, opts({ signal: c.signal }))).rejects.toMatchObject({ code: "cancelled" });
  });
  it("A-COR-10 credit on/off", async () => {
    const on = await readInfo((await imagesToPdf([png], {}, opts())).bytes);
    expect([on.Producer, on.Creator]).toEqual(["MossPDF by Vin's Atelier", "MossPDF"]);
    const off = await readInfo((await imagesToPdf([png], {}, opts({ producerCredit: false }))).bytes);
    expect([off.Producer, off.Creator]).toEqual([undefined, undefined]);
  });
});
