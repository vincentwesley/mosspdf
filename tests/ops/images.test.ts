import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";
import { unzlibSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bookmarkParts, split, titleName } from "../../src/ops/assemble";
import { extractImages } from "../../src/ops/extractimages";
import { setOutline } from "../../src/ops/outline";
import { engines, opts } from "../helpers/env";

type Img = { w: number; h: number; filter: "Flate" | "DCT"; data: Uint8Array; cs?: string; smask?: Uint8Array };
const build = async (pages: Img[][]) => {
  const d = await PDFDocument.create();
  const ctx = d.context;
  const stream = (i: Img, extra: Record<string, unknown> = {}) =>
    ctx.register(PDFRawStream.of(ctx.obj({ Type: "XObject", Subtype: "Image", Width: i.w, Height: i.h, BitsPerComponent: 8, ColorSpace: i.cs ?? "DeviceRGB", Filter: i.filter === "DCT" ? "DCTDecode" : "FlateDecode", Length: i.data.length, ...extra }), i.data));
  for (const imgs of pages) {
    const page = d.addPage([200, 200]);
    const xo = ctx.obj({});
    imgs.forEach((i, k) => {
      const sm = i.smask ? ctx.register(PDFRawStream.of(ctx.obj({ Type: "XObject", Subtype: "Image", Width: i.w, Height: i.h, BitsPerComponent: 8, ColorSpace: "DeviceGray", Filter: "FlateDecode" }), zlibSync(i.smask))) : undefined;
      (xo as unknown as { set(k: PDFName, v: unknown): void }).set(PDFName.of(`I${k}`), stream(i, sm ? { SMask: sm } : {}));
    });
    page.node.Resources()!.set(PDFName.of("XObject"), xo);
  }
  return { name: "t.pdf", bytes: await d.save() };
};
const rgb = (w: number, h: number) => Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 7) & 255);
const pngPixels = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset);
  const w = v.getUint32(16), h = v.getUint32(20), type = png[25];
  const idat: Uint8Array[] = [];
  for (let o = 8; o < png.length; ) {
    const n = v.getUint32(o), t = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (t === "IDAT") idat.push(png.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  return { w, h, type, raw: unzlibSync(idat[0]) };
};

describe("extract images", () => {
  it("passes JPEG through byte for byte", async () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
    const r = await extractImages(await build([[{ w: 70, h: 70, filter: "DCT", data: jpg }]]), {}, opts(), engines);
    expect(r.map((x) => x.name)).toEqual(["page-1-1.jpg"]);
    expect(Array.from(r[0].bytes)).toEqual(Array.from(jpg));
  });
  it("turns Flate RGB into a PNG that decodes to the same pixels", async () => {
    const px = rgb(4, 3);
    const r = await extractImages(await build([[{ w: 4, h: 3, filter: "Flate", data: zlibSync(px) }]]), {}, opts(), engines);
    const p = pngPixels(r[0].bytes);
    expect([p.w, p.h, p.type]).toEqual([4, 3, 2]);
    for (let y = 0; y < 3; y++) expect(Array.from(p.raw.subarray(y * 13 + 1, y * 13 + 13))).toEqual(Array.from(px.subarray(y * 12, y * 12 + 12)));
  });
  it("uses an SMask of the same size as alpha", async () => {
    const r = await extractImages(await build([[{ w: 2, h: 2, filter: "Flate", data: zlibSync(rgb(2, 2)), smask: Uint8Array.from([0, 85, 170, 255]) }]]), {}, opts(), engines);
    const p = pngPixels(r[0].bytes);
    expect(p.type).toBe(6);
    expect([p.raw[4], p.raw[8], p.raw[13], p.raw[17]]).toEqual([0, 85, 170, 255]);
  });
  it("dedupes shared images, counts skipped ones and honours the tiny filter", async () => {
    const f = await build([[{ w: 4, h: 4, filter: "Flate", data: zlibSync(rgb(4, 4)) }, { w: 4, h: 4, filter: "Flate", data: zlibSync(rgb(4, 4)), cs: "DeviceCMYK" }, { w: 80, h: 80, filter: "DCT", data: Uint8Array.of(1) }], []]);
    const r = await extractImages(f, {}, opts(), engines);
    expect(r.map((x) => x.name)).toEqual(["page-1-1.png", "page-1-2.jpg"]);
    expect(r[0].warnings[0].message).toMatch(/^1 picture was skipped/);
    expect((await extractImages(f, { skipTiny: true }, opts(), engines)).map((x) => x.name)).toEqual(["page-1-1.jpg"]);
    await expect(extractImages(await build([[]]), {}, opts(), engines)).rejects.toThrow(/no pictures/);
  });
});

describe("split by bookmarks", () => {
  it("names are sanitized and unique, ranges run to the next bookmark", () => {
    const items = [
      { title: 'A/B:C*?"<>|', page: 1, level: 0 }, { title: "child", page: 2, level: 1 },
      { title: "a b c", page: 3, level: 0 }, { title: "A b C", page: 5, level: 0 }, { title: "x".repeat(100), page: 5, level: 0 },
    ];
    const parts = bookmarkParts(items, 6);
    expect(parts.map((p) => p.name)).toEqual(["A B C", "a b c 2", "x".repeat(80)]);
    expect(parts.map((p) => p.pages)).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(titleName("  \u0001 ")).toBe("Untitled");
  });
  it("op makes one file per top-level bookmark and refuses a file without any", async () => {
    const d = await PDFDocument.create();
    for (let i = 0; i < 5; i++) d.addPage([200, 200]);
    const plain = { name: "t.pdf", bytes: await d.save() };
    const withBm = await setOutline(plain, { items: [{ title: "One", page: 1, level: 0 }, { title: "Two", page: 3, level: 0 }, { title: "sub", page: 4, level: 1 }] }, opts(), engines);
    const r = await split({ name: "t.pdf", bytes: withBm.bytes }, { kind: "bookmarks" }, opts(), engines);
    expect(r.map((x) => x.name)).toEqual(["One.pdf", "Two.pdf"]);
    expect((await PDFDocument.load(r[0].bytes)).getPageCount()).toBe(2);
    expect((await PDFDocument.load(r[1].bytes)).getPageCount()).toBe(3);
    await expect(split(plain, { kind: "bookmarks" }, opts(), engines)).rejects.toThrow(/no top-level bookmarks/);
  });
});
