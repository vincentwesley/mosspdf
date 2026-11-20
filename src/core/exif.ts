// A small, read-only EXIF reader for JPEGs: camera make/model, date taken and whether a GPS block is present. Nothing is written; the
// photo tool strips every tag by re-drawing the picture. Never throws: a damaged or missing block gives `{ hasExif: false }`.
export interface ExifSummary {
  hasExif: boolean;
  camera?: string;
  date?: string;
  /** The photo carries a GPS block (where it was taken). */
  gps: boolean;
}

export function readExif(b: Uint8Array): ExifSummary {
  const none: ExifSummary = { hasExif: false, gps: false };
  try {
    if (b[0] !== 0xff || b[1] !== 0xd8) return none;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let p = 2; p + 4 < b.length; ) {
      if (b[p] !== 0xff) return none;
      const marker = b[p + 1];
      if (marker === 0xda || marker === 0xd9) return none; // image data starts: no EXIF
      const len = v.getUint16(p + 2);
      if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966) return parse(v, p + 10, p + 2 + len);
      p += 2 + len;
    }
  } catch {
    /* damaged: treated as no EXIF */
  }
  return none;
}

function parse(v: DataView, t: number, end: number): ExifSummary {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const ascii = (e: number) => {
    const n = u32(e + 4);
    const at = n <= 4 ? e + 8 : t + u32(e + 8);
    if (at + n > end) return undefined;
    let s = "";
    for (let i = 0; i < n && v.getUint8(at + i); i++) s += String.fromCharCode(v.getUint8(at + i));
    return s.trim() || undefined;
  };
  const out: ExifSummary = { hasExif: true, gps: false };
  let make: string | undefined, model: string | undefined, date: string | undefined;
  const walk = (ifd: number, depth: number) => {
    if (depth > 2 || ifd + 2 > end) return;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) return;
      const tag = u16(e);
      if (tag === 0x010f) make = ascii(e);
      else if (tag === 0x0110) model = ascii(e);
      else if (tag === 0x9003 || (tag === 0x0132 && !date)) date = ascii(e) ?? date;
      else if (tag === 0x8825) out.gps = true;
      else if (tag === 0x8769) walk(t + u32(e + 8), depth + 1);
    }
  };
  walk(t + u32(t + 4), 0);
  const cam = [make, model && make && model.startsWith(make) ? model.slice(make.length).trim() : model].filter(Boolean).join(" ");
  if (cam) out.camera = cam;
  if (date) out.date = date.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  return out;
}
