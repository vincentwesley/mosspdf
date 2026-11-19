// Compress: qpdf object streams + recompressed Flate for every level; balanced/strong also downsample and re-encode embedded images as JPEG (D12).
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFArray, PDFRawStream, PDFBool, type PDFContext } from "@cantoo/pdf-lib";
import type { Jpeg } from "../engines/jpeg";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort, classify } from "./open";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export type CompressLevel = "light" | "balanced" | "strong";
export interface CompressResult extends OpResult {
  before: number; // bytes in
  after: number; // bytes out (== before when the original is returned)
}
// ponytail: caps are pixel limits per image, not target DPI (placement size would need content-stream parsing). Add if users want "150 dpi".
const IMAGE = { balanced: { max: 1600, quality: 75 }, strong: { max: 1000, quality: 55 } } as const;
const MIN_PIXELS = 10_000; // tiny images (icons, rules) aren't worth touching

const N = (s: string) => PDFName.of(s);
const nameOf = (d: PDFDict, k: string) => (d.lookup(N(k)) as PDFName | undefined)?.decodeText?.();
const numOf = (d: PDFDict | undefined, k: string) => (d?.lookup(N(k)) as PDFNumber | undefined)?.asNumber?.();
const asDict = (x: unknown): PDFDict | undefined => (x instanceof PDFDict ? x : undefined);

function filters(d: PDFDict): string[] {
  const f = d.lookup(N("Filter"));
  if (!f) return [];
  const a = f instanceof PDFArray ? f.asArray().map((x) => d.context.lookup(x)) : [f];
  return a.map((x) => (x as PDFName).decodeText?.() ?? "?");
}
/** Components for the colour spaces whose JPEG we can write without changing the colours (declared space is kept as is). */
function channels(ctx: PDFContext, cs: unknown): 1 | 3 | undefined {
  if (cs instanceof PDFName) return cs.decodeText() === "DeviceRGB" ? 3 : cs.decodeText() === "DeviceGray" ? 1 : undefined;
  if (cs instanceof PDFArray && (ctx.lookup(cs.get(0)) as PDFName)?.decodeText?.() === "ICCBased") {
    const n = numOf((ctx.lookup(cs.get(1)) as PDFRawStream | undefined)?.dict, "N");
    return n === 1 ? 1 : n === 3 ? 3 : undefined;
  }
  return undefined;
}

// Not Blob.stream(): WebKit loads that through a blob: URL, which the post-seal request check (rightly) treats as a request.
const inflate = async (b: Uint8Array) => {
  const ds = new DecompressionStream("deflate");
  const w = ds.writable.getWriter();
  void w.write(b as BufferSource).then(() => w.close(), () => undefined); // a bad stream rejects the read below
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
};

/** PNG row predictors (PDF Predictor 10-15). */
export function unpredict(d: Uint8Array, bpp: number, rowBytes: number, rows: number): Uint8Array | undefined {
  if (d.length < (rowBytes + 1) * rows) return undefined;
  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const ft = d[y * (rowBytes + 1)];
    const s = y * (rowBytes + 1) + 1;
    const o = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0;
      const b = y ? out[o - rowBytes + x] : 0;
      const c = x >= bpp && y ? out[o - rowBytes + x - bpp] : 0;
      let p = 0;
      if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft === 1) p = a;
      else if (ft === 2) p = b;
      else if (ft === 3) p = (a + b) >> 1;
      else if (ft !== 0) return undefined;
      out[o + x] = (d[s + x] + p) & 255;
    }
  }
  return out;
}

/** Box-average downsample of interleaved pixels. */
export function resize(src: Uint8Array, w: number, h: number, ch: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh * ch);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src[(yy * w + xx) * ch + c];
        out[(y * nw + x) * ch + c] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      }
    }
  }
  return out;
}

/** Returns the replacement stream, or undefined to leave the image alone. */
async function shrink(ctx: PDFContext, s: PDFRawStream, cfg: { max: number; quality: number }, jpeg: Jpeg): Promise<PDFRawStream | undefined> {
  const d = s.dict;
  const w = numOf(d, "Width"), h = numOf(d, "Height");
  if (!w || !h || w * h < MIN_PIXELS) return;
  if (d.has(N("SMask")) || d.has(N("Mask")) || d.has(N("Decode")) || d.has(N("Matte"))) return;
  if ((d.lookup(N("ImageMask")) as PDFBool | undefined)?.asBoolean?.()) return;
  if ((numOf(d, "BitsPerComponent") ?? 8) !== 8) return;
  const ch = channels(ctx, d.lookup(N("ColorSpace")));
  if (!ch) return;
  const old = s.getContents();
  const f = filters(d);
  let px: Uint8Array; // interleaved, ch per pixel
  if (f.length === 1 && f[0] === "DCTDecode") {
    const r = await jpeg.decode(old);
    if (r.width !== w || r.height !== h) return;
    px = new Uint8Array(w * h * ch);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < ch; c++) px[i * ch + c] = r.data[i * 4 + (ch === 1 ? 0 : c)];
  } else if (f.length === 0 || (f.length === 1 && f[0] === "FlateDecode")) {
    let raw = f.length ? await inflate(old) : old;
    const parms = asDict(d.lookup(N("DecodeParms")));
    const pred = numOf(parms, "Predictor") ?? 1;
    if (pred >= 10) {
      if ((numOf(parms, "Colors") ?? 1) !== ch || (numOf(parms, "Columns") ?? 1) !== w || (numOf(parms, "BitsPerComponent") ?? 8) !== 8) return;
      const un = unpredict(raw, ch, w * ch, h);
      if (!un) return;
      raw = un;
    } else if (pred !== 1 || (f.length === 0 && d.has(N("DecodeParms")))) return;
    if (raw.length < w * h * ch) return;
    px = raw.length === w * h * ch ? raw : raw.subarray(0, w * h * ch);
  } else return;

  const k = Math.min(1, cfg.max / Math.max(w, h));
  const [nw, nh] = [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  if (k < 1) px = resize(px, w, h, ch, nw, nh);
  const rgba = new Uint8Array(nw * nh * 4);
  for (let i = 0; i < nw * nh; i++) {
    rgba[i * 4] = px[i * ch];
    rgba[i * 4 + 1] = px[i * ch + (ch === 3 ? 1 : 0)];
    rgba[i * 4 + 2] = px[i * ch + (ch === 3 ? 2 : 0)];
    rgba[i * 4 + 3] = 255;
  }
  const out = await jpeg.encode(rgba, nw, nh, cfg.quality, ch === 1);
  if (out.length >= old.length) return;
  const nd = d.clone(ctx);
  nd.set(N("Width"), PDFNumber.of(nw));
  nd.set(N("Height"), PDFNumber.of(nh));
  nd.set(N("Filter"), N("DCTDecode"));
  nd.delete(N("DecodeParms"));
  return PDFRawStream.of(nd, out);
}

async function recompressImages(doc: PDFDocument, level: "balanced" | "strong", o: OpOptions, jpeg: Jpeg) {
  const ctx = doc.context;
  const images = ctx.enumerateIndirectObjects().filter(([, x]) => x instanceof PDFRawStream && nameOf(x.dict, "Subtype") === "Image") as [import("@cantoo/pdf-lib").PDFRef, PDFRawStream][];
  for (const [i, [ref, s]] of images.entries()) {
    checkAbort(o.signal);
    try {
      const r = await shrink(ctx, s, IMAGE[level], jpeg);
      if (r) ctx.assign(ref, r);
    } catch {
      /* an image we can't decode (CMYK JPEG, damaged data) stays as it was */
    }
    o.onProgress?.(i + 1, images.length + 1);
  }
}

export async function compress(file: InFile, opts: { level: CompressLevel }, o: OpOptions, e: Engines): Promise<CompressResult> {
  if (!["light", "balanced", "strong"].includes(opts.level)) throw new PdfError("unsupported", "Pick a compression level: light, balanced or strong.");
  const p = await prepare(file, o, e);
  let bytes = p.bytes;
  // pdf-lib pass only when there is something to do in it (images, or the credit); a plain text file at "light" with the credit off skips the parse.
  if (opts.level !== "light" || o.producerCredit) {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (opts.level !== "light") await recompressImages(doc, opts.level, o, e.jpeg);
    if (o.producerCredit) applyCredit(doc);
    checkAbort(o.signal);
    bytes = await doc.save({ useObjectStreams: false });
  }
  const r = await e.qpdf(["--object-streams=generate", "--stream-data=compress", "--recompress-flate", "--compression-level=9", "/in.pdf", "/out.pdf"], { "/in.pdf": bytes }, ["/out.pdf"]);
  const out = r.files["/out.pdf"];
  if (!out || r.code === 2) throw classify(r.stderr, file);
  o.onProgress?.(1, 1);
  const name = safeName(file.name, "document").replace(/\.pdf$/, "") + "-compressed.pdf";
  const before = file.bytes.length;
  if (out.length >= before) {
    const warnings = [...p.warnings, { code: "not-smaller", message: `"${file.name}" can't be made any smaller, so you get the original back unchanged.` }].filter((w) => w.code !== "decrypted");
    return { bytes: file.bytes.slice(), name: safeName(file.name, "document"), warnings, before, after: before };
  }
  return { bytes: out, name, warnings: p.warnings, before, after: out.length };
}
