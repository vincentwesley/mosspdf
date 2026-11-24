import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createOcr } from "../../src/engines/ocr";
import { crop, enhance, estimateSkew, findPage, fixPage, type Px } from "../../src/ops/scanfix";
import { grayPng, scanGray, skewScan, SCAN_LINES } from "../../scripts/scan-image.mjs";

const rgba = ({ w, h, gray }: { w: number; h: number; gray: Uint8Array }): Px => {
  const data = new Uint8ClampedArray(w * h * 4);
  gray.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { data, width: w, height: h };
};
const toGray = (p: Px) => ({ w: p.width, h: p.height, gray: Uint8Array.from({ length: p.width * p.height }, (_, i) => p.data[i * 4]) });
/** Ruled lines (ink 20 on paper 240), `deg` clockwise. */
const lines = (deg: number, k = 1) => {
  const [w, h] = [800 * k, 1000 * k];
  const g = new Uint8Array(w * h).fill(240);
  const t = Math.tan((deg * Math.PI) / 180);
  for (let y = 60; y < h - 60; y += 28) for (let x = 40; x < w - 40; x++) for (let k = 0; k < 4; k++) { const yy = Math.round(y + k + (x - w / 2) * t); if (yy >= 0 && yy < h) g[yy * w + x] = 20; }
  return rgba({ w, h, gray: g });
};

describe("scan clean-up", () => {
  it.each([-7, -2.5, 0, 1, 4.3, 12])("finds a skew of %d degrees within half a degree", (deg) => {
    expect(Math.abs(estimateSkew(lines(deg)) - deg)).toBeLessThan(0.5);
  });
  it("finds the skew on a full-size scan too (downscaled grey values are whole numbers)", () => {
    expect(Math.abs(estimateSkew(lines(3, 3)) - 3)).toBeLessThan(0.5);
  });

  it("returns 0 for a blank page", () => {
    expect(estimateSkew(rgba({ w: 400, h: 500, gray: new Uint8Array(200000).fill(240) }))).toBe(0);
  });

  it("trims a dark scanner border and keeps the page", () => {
    const [w, h] = [300, 400];
    const g = new Uint8Array(w * h).fill(20);
    for (let y = 30; y < 370; y++) for (let x = 50; x < 260; x++) g[y * w + x] = 240;
    const r = findPage(rgba({ w, h, gray: g }));
    expect(r).toEqual({ x: 50, y: 30, w: 210, h: 340 });
    expect(crop(rgba({ w, h, gray: g }), r).width).toBe(210);
    expect(findPage(lines(0))).toEqual({ x: 0, y: 0, w: 800, h: 1000 }); // nothing to trim
  });

  it("evens out a shadow and stretches the contrast", () => {
    const [w, h] = [200, 200];
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round(250 - x * 0.45 - (x % 20 < 3 ? 200 : 0)); // 250 -> 160 gradient, ink strokes
    const img = rgba({ w, h, gray: g });
    enhance(img);
    expect(img.data[(100 * w + 195) * 4]).toBeGreaterThan(200); // far-right paper is back to white
    expect(img.data[(100 * w + 1) * 4]).toBeLessThan(120); // the ink stays dark
  });

  it("straightens, crops and still reads a skewed scan on a dark bed", async () => {
    const req = createRequire(import.meta.url);
    const bytes = (p: string) => new Uint8Array(readFileSync(req.resolve(p)));
    const ocr = await createOcr(bytes("tesseract.js-core/tesseract-core-simd-lstm.wasm"), [{ code: "eng", gz: bytes("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz") }]);
    const fixed = fixPage(rgba(skewScan(scanGray(SCAN_LINES), 4)), { crop: true, straighten: true });
    expect(fixed.img.width).toBeLessThan(1240 + 120);
    const flat = toGray(fixed.img);
    expect(Math.abs(estimateSkew(fixed.img))).toBeLessThan(0.5);
    const words = ocr.recognize(new Uint8Array(grayPng({ ...flat, gray: flat.gray })));
    const text = words.map((w) => w.text).join(" ");
    for (const want of ["OCR", "FIXTURE", "TOTAL", "SCANNED"]) expect(text).toContain(want);
    // a word's box maps back near the same word on the skewed original
    const w = words.find((x) => x.text === "FIXTURE")!;
    const [ox, oy] = fixed.toOriginal(w.x0, w.y0);
    const skewed = rgba(skewScan(scanGray(SCAN_LINES), 4));
    const ink = (x: number, y: number) => { let n = 0; for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) if (skewed.data[((Math.round(y) + j) * skewed.width + Math.round(x) + i) * 4] < 120) n++; return n; };
    expect(ink(ox + 6, oy + 14)).toBeGreaterThan(5);
  }, 120_000);
});
