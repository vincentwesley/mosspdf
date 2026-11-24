import type { LoadedFile } from "../core/store";
import type { ImageInput, ImagesToPdfOptions } from "../ops/images";
import { PdfError, type OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { radioGroup, selectField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

/** EXIF orientation (1-8) of a JPEG, or 1 when absent. Only reads the first APP1 segment. */
function jpegOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let p = 2; p + 4 < b.length; ) {
    if (b[p] !== 0xff) return 1;
    const marker = b[p + 1];
    const len = v.getUint16(p + 2);
    if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
      const t = p + 10; // TIFF header
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) return 1;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1; // start of scan: no EXIF before it
    p += 2 + len;
  }
  return 1;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not prepare a picture. Try a smaller picture, or close other tabs."))), type, q));

/** The ImageInput contract: JPEG or PNG bytes that are already upright, with their pixel size. PNG stays PNG; JPEG is re-encoded only when its rotation flag had to be applied. */
async function prepared(f: LoadedFile): Promise<ImageInput> {
  const blob = f.blob!;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (isPng || (isJpeg && jpegOrientation(bytes) === 1)) return { name: f.name, format: isPng ? "png" : "jpeg", bytes, width: f.width!, height: f.height! };
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d", { willReadFrequently: !isJpeg })!;
    g.drawImage(bmp, 0, 0);
    // a WebP with see-through pixels goes to PNG; everything else to JPEG
    const opaque = isJpeg || !g.getImageData(0, 0, c.width, c.height).data.some((_, i) => i % 4 === 3 && _ < 255);
    const out = await toBlob(c, opaque ? "image/jpeg" : "image/png", 0.92);
    c.width = c.height = 0;
    return { name: f.name, format: opaque ? "jpeg" : "png", bytes: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

const MARGINS: [string, string][] = [["0", "None"], ["18", "Small"], ["36", "Medium"], ["54", "Large"]];

const ui = (ctx: Ctx) => ctx.local(() => ({
  size: radioGroup({ name: "pagesize", legend: "Page size", value: "fit", testid: (v) => `size-${v}`, onChange: () => ctx.refresh(), options: [["fit", "Same as the picture"], ["a4", "A4"], ["letter", "US Letter"]] }),
  orient: selectField({ id: "orient", label: "Page direction", testid: "orient-select", options: [["auto", "Follow each picture"], ["portrait", "Always upright (portrait)"], ["landscape", "Always sideways (landscape)"]], value: "auto" }),
  margin: selectField({ id: "margin", label: "Space around the picture", testid: "margin-select", options: MARGINS, value: "36" }),
  box: h("div", { class: "stampopts" }),
}));

export const imagesToPdf: ToolDef = {
  id: "images-to-pdf", title: "Images to PDF", heading: "Turn pictures into a PDF", group: "Convert",
  blurb: "Turn JPG, PNG or WebP pictures into one PDF.",
  lede: "Put your pictures in order, then save them as one PDF. Each picture gets its own page.",
  how: "Add pictures, put them in order, then save one PDF with a page for each.",
  next: ["sign", "compress", "protect", "page-numbers", "watermark"],
  accepts: "images",
  options(ctx) {
    const u = ui(ctx);
    u.box.append(u.size.el, u.orient.el, u.margin.el);
    return u.box;
  },
  sync(ctx) {
    const u = ui(ctx);
    u.box.hidden = !ctx.files.length;
    const fit = u.size.value() === "fit";
    u.orient.el.hidden = fit;
    u.margin.el.hidden = fit;
  },
  primaryLabel(ctx) { const n = ctx.files.length; return n > 1 ? `Create PDF from ${n} pictures` : "Create PDF"; },
  async run(ctx) {
    const u = ui(ctx);
    const images: ImageInput[] = [];
    for (const f of ctx.files) images.push(await prepared(f));
    const options: ImagesToPdfOptions = { size: u.size.value() as ImagesToPdfOptions["size"], orientation: u.orient.input.value as ImagesToPdfOptions["orientation"], margin: Number(u.margin.input.value) };
    return [await ctx.call<OpResult>("imagesToPdf", { images, options, o: { producerCredit: ctx.producerCredit } })];
  },
};
