// Text font choice (D20): Helvetica when every character is WinAnsi (the common case, no size change), otherwise a subset of Noto Sans
// (Latin, Latin Extended, Vietnamese, Greek, Cyrillic) embedded with fontkit. The font bytes arrive from the host before the seal.
import fontkit from "@cantoo/fontkit";
import { StandardFonts, type PDFDocument, type PDFFont } from "@cantoo/pdf-lib";
import { UNICODE_OK, WIN_ANSI, ZH_HINT, ZH_OK } from "../core/winansi";
import { PdfError } from "./types";

let bytes: Uint8Array | undefined, zhBytes: Uint8Array | undefined;
export const setUnicodeFont = (b: Uint8Array | undefined, zh?: Uint8Array) => { bytes = b; zhBytes = zh; };

export async function pickFont(doc: PDFDocument, texts: Iterable<string>): Promise<PDFFont> {
  const all = [...texts];
  const needUnicode = all.some((t) => [...t].some((c) => c !== "\n" && c !== "\r" && !WIN_ANSI.test(c)));
  if (!needUnicode || !bytes) return doc.embedFont(StandardFonts.Helvetica);
  doc.registerFontkit(fontkit);
  // Chinese font (D24; only loaded when turned on) once a character is beyond the Noto Sans subset but inside the Chinese one.
  if (zhBytes && all.some((t) => [...t].some((c) => c !== "\n" && c !== "\r" && !UNICODE_OK.test(c) && ZH_OK.test(c)))) return doc.embedFont(zhBytes, { subset: true, features: { ccmp: false } });
  // ccmp off: it splits "ị" into base + mark glyphs with no code point, which leaves empty entries in the ToUnicode map (pdf.js then extracts garbage).
  return doc.embedFont(bytes, { subset: true, features: { ccmp: false } });
}

/** Throws a plain error naming the characters `font` cannot draw. */
export function checkCovered(font: PDFFont, text: string, what: string) {
  const ok = new Set(font.getCharacterSet());
  const bad = [...new Set([...text])].filter((c) => c !== "\n" && c !== "\r" && !ok.has(c.codePointAt(0)!));
  if (bad.length)
    throw new PdfError("unsupported", `${what} has characters that can't be used yet: ${bad.slice(0, 5).map((c) => `"${c}"`).join(" ")}. Use Latin, Greek or Cyrillic letters, digits and basic punctuation.${!zhBytes && bad.some((c) => ZH_OK.test(c)) ? ZH_HINT : ""}`);
}
