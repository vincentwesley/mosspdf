// Hidden text for OCR and redaction (D21): a "glyphless" font like Tesseract's own PDF renderer. Type0 / Identity-H / CIDFontType2 whose
// embedded TrueType has one empty glyph, so nothing is ever painted and no real font is needed for any script. Each distinct code point gets
// its own CID; a ToUnicode CMap maps CID back to the text (that is what search, copy and pdf.js extraction read). Every glyph is 0.5 em wide.
import { PDFString, type PDFDocument, type PDFRef } from "@cantoo/pdf-lib";

/** Advance of every CID, in 1/1000 em. */
export const GLYPH_WIDTH = 500;

/** The smallest TrueType that parsers accept: one empty glyph (GID 0), no cmap. */
export function emptyTtf(): Uint8Array {
  const u16 = (...n: number[]) => n.flatMap((v) => [v >> 8, v & 255]);
  const u32 = (...n: number[]) => n.flatMap((v) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const tables: [string, number[]][] = [
    ["glyf", []],
    ["head", [...u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5), ...u16(0, 1000), ...u32(0, 0, 0, 0), ...u16(0, 0, 500, 1000, 0, 8, 2, 0, 0)]],
    ["hhea", [...u32(0x00010000), ...u16(1000, 0xfd12 /* -750 */, 0, GLYPH_WIDTH, 0, 0, 500, 1, 0, 0, 0, 0, 0, 0, 0, 1)]], // ascender..xMaxExtent, caretSlopeRise/Run, caretOffset, 4 reserved, metricDataFormat, numberOfHMetrics
    ["hmtx", u16(GLYPH_WIDTH, 0)],
    ["loca", u16(0, 0)],
    ["maxp", [...u32(0x00010000), ...u16(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0)]],
  ];
  const head = [...u32(0x00010000), ...u16(tables.length, 64, 2, 32)];
  let off = 12 + 16 * tables.length;
  const dir: number[] = [];
  const body: number[] = [];
  for (const [tag, d] of tables) {
    const pad = [...d, ...new Array((4 - (d.length % 4)) % 4).fill(0)];
    let sum = 0;
    for (let i = 0; i < pad.length; i += 4) sum = (sum + ((pad[i] << 24) | (pad[i + 1] << 16) | (pad[i + 2] << 8) | pad[i + 3])) >>> 0;
    dir.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(sum, off, d.length));
    body.push(...pad);
    off += pad.length;
  }
  return Uint8Array.from([...head, ...dir, ...body]);
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
/** UTF-16BE hex of one code point. */
const utf16 = (cp: number) => (cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp));

export interface GlyphlessFont {
  ref: PDFRef;
  /** The hex string `<....>` to show `text` with, plus how many CIDs it uses (each is GLYPH_WIDTH wide). */
  encode(text: string): { hex: string; n: number };
}

/** Embeds the font in `doc` for the code points of `texts` (one CID each, 1..65535). */
export function embedGlyphless(doc: PDFDocument, texts: Iterable<string>): GlyphlessFont {
  const cids = new Map<number, number>();
  for (const t of texts) for (const ch of t) { const cp = ch.codePointAt(0)!; if (!cids.has(cp)) cids.set(cp, cids.size + 1); }
  if (cids.size > 0xfffe) throw new Error("Too many different characters for one text layer.");
  const ctx = doc.context;
  const pairs = [...cids];
  const blocks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) blocks.push(`${Math.min(100, pairs.length - i)} beginbfchar\n${pairs.slice(i, i + 100).map(([cp, cid]) => `<${hex4(cid)}> <${utf16(cp)}>`).join("\n")}\nendbfchar`);
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const ttf = emptyTtf();
  const file = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = ctx.register(ctx.obj({ Type: "FontDescriptor", FontName: "GlyphLessFont", Flags: 5, FontBBox: [0, 0, GLYPH_WIDTH, 1000], ItalicAngle: 0, Ascent: 1000, Descent: -250, CapHeight: 800, StemV: 80, FontFile2: file }));
  const cidFont = ctx.register(ctx.obj({
    Type: "Font", Subtype: "CIDFontType2", BaseFont: "GlyphLessFont", CIDToGIDMap: "Identity", DW: GLYPH_WIDTH, FontDescriptor: descriptor,
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
  }));
  const toUnicode = ctx.register(ctx.flateStream(cmap));
  const ref = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type0", BaseFont: "GlyphLessFont", Encoding: "Identity-H", DescendantFonts: [cidFont], ToUnicode: toUnicode }));
  return {
    ref,
    encode(text) {
      const cs = [...text].map((ch) => cids.get(ch.codePointAt(0)!)!);
      return { hex: `<${cs.map(hex4).join("")}>`, n: cs.length };
    },
  };
}
