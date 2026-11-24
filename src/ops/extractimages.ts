// Extract images: the pictures inside a PDF as files. JPEG (DCTDecode) streams are saved byte for byte; plain 8-bit Gray/RGB/Indexed images
// (Flate) are decoded and written as PNG, with an /SMask of the same size as alpha. Anything else is skipped and counted.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject } from "@cantoo/pdf-lib";
import { zlibSync } from "fflate";
import { prepare } from "./common";
import { checkAbort } from "./open";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

const N = PDFName.of;
const MAX_DEPTH = 8;
export const TINY = 64;

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/** 8-bit PNG. channels: 1 gray, 3 RGB, 4 RGBA. `pix` is tightly packed rows. */
export function encodePng(w: number, h: number, channels: 1 | 3 | 4, pix: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * channels + 1) * h);
  for (let y = 0; y < h; y++) raw.set(pix.subarray(y * w * channels, (y + 1) * w * channels), y * (w * channels + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const filters = (d: PDFDict): string[] => {
  const f = d.lookup(N("Filter"));
  const list = f instanceof PDFArray ? f.asArray().map((x) => d.context.lookup(x)) : f ? [f] : [];
  return list.map((x) => (x instanceof PDFName ? x.decodeText() : "?"));
};
const num = (d: PDFDict, k: string) => { const x = d.lookup(N(k)); return x instanceof PDFNumber ? x.asNumber() : 0; };
const bytesOf = (s: PDFRawStream) => (decodePDFRawStream(s) as unknown as { getBytes(): Uint8Array }).getBytes();

type Pix = { w: number; h: number; channels: 1 | 3; data: Uint8Array };

/** Decodes an 8-bit Gray/RGB/Indexed image stream, or null when unsupported. */
function decode(s: PDFRawStream): Pix | null {
  const d = s.dict;
  const w = num(d, "Width"), h = num(d, "Height");
  const f = filters(d);
  if (!w || !h || num(d, "BitsPerComponent") !== 8 || f.some((x) => x !== "FlateDecode" && x !== "Fl")) return null;
  if (d.lookup(N("ImageMask")) || d.lookup(N("Mask"))) return null;
  const dec = d.lookup(N("Decode"));
  if (dec instanceof PDFArray && (dec.lookup(0) as PDFNumber | undefined)?.asNumber() === 1) return null; // inverted
  let cs: PDFObject | undefined = d.lookup(N("ColorSpace"));
  let palette: Uint8Array | null = null;
  if (cs instanceof PDFArray) {
    const kind = cs.lookup(0);
    if (kind === N("Indexed") || kind === N("I")) {
      const base = cs.lookup(1);
      const pal = cs.lookup(3);
      if (!(base === N("DeviceRGB") || base === N("RGB")) || !(pal instanceof PDFRawStream)) return null;
      palette = bytesOf(pal);
      cs = N("DeviceRGB");
    } else if (kind === N("ICCBased")) {
      const icc = cs.lookup(1);
      const n = icc instanceof PDFRawStream ? num(icc.dict, "N") : 0;
      cs = n === 1 ? N("DeviceGray") : n === 3 ? N("DeviceRGB") : undefined;
    } else if (kind === N("CalRGB")) cs = N("DeviceRGB");
    else if (kind === N("CalGray")) cs = N("DeviceGray");
    else return null;
  }
  const channels = palette || cs === N("DeviceRGB") || cs === N("RGB") ? 3 : cs === N("DeviceGray") || cs === N("G") ? 1 : 0;
  if (!channels) return null;
  let bytes: Uint8Array;
  try { bytes = bytesOf(s); } catch { return null; }
  if (palette) {
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = palette[(bytes[i] ?? 0) * 3 + c] ?? 0;
    return { w, h, channels: 3, data: rgb };
  }
  if (bytes.length < w * h * channels) return null;
  return { w, h, channels, data: bytes.subarray(0, w * h * channels) };
}

function toPng(s: PDFRawStream): Uint8Array | null {
  const img = decode(s);
  if (!img) return null;
  const sm = s.dict.lookup(N("SMask"));
  const alpha = sm instanceof PDFRawStream ? decode(sm) : null;
  if (!alpha || alpha.channels !== 1 || alpha.w !== img.w || alpha.h !== img.h) return encodePng(img.w, img.h, img.channels, img.data);
  const n = img.w * img.h;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = img.data[img.channels === 3 ? i * 3 + c : i];
    out[i * 4 + 3] = alpha.data[i];
  }
  return encodePng(img.w, img.h, 4, out);
}

export interface ExtractImagesOptions { skipTiny?: boolean }

export async function extractImages(file: InFile, opts: ExtractImagesOptions, o: OpOptions, e: Engines): Promise<OpResult[]> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const seen = new Set<PDFRef>();
  const out: OpResult[] = [];
  let skipped = 0;
  const pages = doc.getPages();
  for (const [pi, page] of pages.entries()) {
    checkAbort(o.signal);
    let k = 0;
    const walk = (res: PDFDict | undefined, depth: number) => {
      const xo = res?.lookupMaybe(N("XObject"), PDFDict);
      if (!xo || depth > MAX_DEPTH) return;
      for (const [, ref] of xo.entries()) {
        if (ref instanceof PDFRef) { if (seen.has(ref)) continue; seen.add(ref); }
        const s = doc.context.lookup(ref);
        if (!(s instanceof PDFRawStream)) continue;
        const sub = s.dict.lookup(N("Subtype"));
        if (sub === N("Form")) { walk(s.dict.lookupMaybe(N("Resources"), PDFDict), depth + 1); continue; }
        if (sub !== N("Image")) continue;
        if (opts.skipTiny && (num(s.dict, "Width") < TINY || num(s.dict, "Height") < TINY)) continue;
        const f = filters(s.dict);
        let bytes: Uint8Array | null;
        let ext = "png";
        if (f.length === 1 && (f[0] === "DCTDecode" || f[0] === "DCT")) { bytes = s.contents; ext = "jpg"; }
        else bytes = toPng(s);
        if (!bytes) { skipped++; continue; }
        out.push({ bytes, name: `page-${pi + 1}-${++k}.${ext}`, warnings: [] });
      }
    };
    walk(page.node.Resources(), 0);
    o.onProgress?.(pi + 1, pages.length);
  }
  if (!out.length) {
    throw new PdfError("unsupported", skipped ? `The ${skipped === 1 ? "picture" : `${skipped} pictures`} in this PDF can't be saved here because of their format. Use PDF to images to save whole pages instead.` : opts.skipTiny ? "No pictures of 64 px or more were found. Choose \"All pictures\" and try again." : "This PDF has no pictures to save. Text and drawings do not count as pictures.", file.name);
  }
  if (skipped) out[0].warnings.push({ code: "skipped-images", message: `${skipped} ${skipped === 1 ? "picture was" : "pictures were"} skipped because ${skipped === 1 ? "its" : "their"} format isn't supported.` });
  return out;
}
