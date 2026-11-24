// PDF text items to paragraphs, and paragraphs to a minimal .docx (zip of XML written by hand with fflate). Pure.
import { strToU8, zipSync } from "fflate";

/** The part of a pdf.js TextItem that is used here. */
export interface DocxItem { str: string; hasEOL?: boolean; fontName?: string; height?: number; transform?: number[] }
export interface Run { text: string; bold: boolean; italic: boolean }
/** A picture for the docx: png/jpg bytes and its size in EMU. */
export interface DocImage { bytes: Uint8Array; ext: "png" | "jpg"; cx: number; cy: number }
/** `y` is the top baseline of a text paragraph (PDF units, up is larger); `image` makes it a picture paragraph. */
export interface Para { runs: Run[]; heading: 0 | 1 | 2; y?: number; image?: DocImage }
export interface Line { runs: Run[]; x: number; y: number; size: number }
/** Font style lookup by pdf.js font id, when the real font is known. */
export type FontStyle = (fontName: string) => { bold: boolean; italic: boolean } | undefined;

const add = (runs: Run[], r: Run) => {
  const l = runs[runs.length - 1];
  if (l && l.bold === r.bold && l.italic === r.italic) l.text += r.text; else runs.push({ ...r });
};

/** Items to lines: a line ends at `hasEOL` or when the baseline moves by more than half the text size. */
export function toLines(items: readonly DocxItem[], fontStyle?: FontStyle): Line[] {
  const out: Line[] = [];
  let cur: Line | null = null;
  const flush = () => { if (cur && cur.runs.some((r) => r.text.trim())) out.push(cur); cur = null; };
  for (const it of items) {
    const t = it.transform ?? [];
    const y = t[5] ?? 0;
    const size = it.height || Math.abs(t[3] ?? 0) || 10;
    if (cur && Math.abs(y - cur.y) > 0.5 * Math.max(size, cur.size)) flush();
    if (!cur) cur = { runs: [], x: t[4] ?? 0, y, size };
    if (it.str) {
      const f = it.fontName ?? "";
      const st = fontStyle?.(f);
      add(cur.runs, { text: it.str, bold: st?.bold ?? /bold/i.test(f), italic: st?.italic ?? /italic|oblique/i.test(f) });
      cur.size = Math.max(cur.size, size);
    }
    if (it.hasEOL) flush();
  }
  flush();
  return out;
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 0; };

/** Lines to paragraphs. `flow` merges lines of one paragraph (a gap over 1.5 line sizes, a deeper indent or a heading change starts a new one); otherwise every line is a paragraph. Headings: size at least 1.7x (H1) or 1.3x (H2) the page's median. */
export function toParas(lines: readonly Line[], flow: boolean): Para[] {
  const med = median(lines.map((l) => l.size));
  const out: Para[] = [];
  let prev: Line | null = null;
  for (const l of lines) {
    const heading = med && l.size >= 1.7 * med ? 1 : med && l.size >= 1.3 * med ? 2 : 0;
    const last = out[out.length - 1];
    const gap = prev ? prev.y - l.y : 0;
    const joins = flow && prev && last && last.heading === heading && gap > 0 && gap <= 1.5 * Math.max(prev.size, l.size) && l.x - prev.x <= l.size;
    if (joins) {
      last.runs[last.runs.length - 1].text += " ";
      l.runs.forEach((r) => add(last.runs, r));
    } else out.push({ runs: l.runs.map((r) => ({ ...r })), heading, y: l.y });
    prev = l;
  }
  return out;
}

/** A picture of the page at PDF position (`top` = its upper edge, `wPt` x `hPt` points) on a page `pageW` points wide. */
export interface PagePic { bytes: Uint8Array; ext: "png" | "jpg"; top: number; wPt: number; hPt: number }
const TEXT_W = 5731510, A4_W = 7560310; // EMU: A4 text column (1 inch margins) and A4 width

/** Picture paragraphs merged into `paras`: each goes before the first paragraph that sits lower on the page; the rest go last. Width scales with the page, never past the text column. */
export function placeImages(paras: readonly Para[], pics: readonly PagePic[], pageW: number): Para[] {
  const k = A4_W / (pageW || 1); // EMU per PDF point: the page maps onto an A4 page
  const mk = (p: PagePic): Para => {
    const f = Math.min(k, TEXT_W / Math.max(1, p.wPt));
    return { runs: [], heading: 0, y: p.top, image: { bytes: p.bytes, ext: p.ext, cx: Math.max(1, Math.round(p.wPt * f)), cy: Math.max(1, Math.round(p.hPt * f)) } };
  };
  const rest = [...pics].sort((a, b) => b.top - a.top);
  const out: Para[] = [];
  for (const p of paras) {
    while (rest.length && p.y !== undefined && rest[0].top > p.y) out.push(mk(rest.shift()!));
    out.push(p);
  }
  return out.concat(rest.map(mk));
}

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
/** XML-safe text: invalid control characters dropped, the five specials escaped. */
export const esc = (s: string) => s.replace(BAD, "").replace(/[&<>"']/g, (c) => ESC[c]);

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const drawing = (rid: string, n: number, im: DocImage) =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${im.cx}" cy="${im.cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${im.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${im.cx}" cy="${im.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const paraXml = (p: Para, pageBreak: boolean, pic = "") => {
  const pr = (p.heading ? `<w:pStyle w:val="Heading${p.heading}"/>` : "") + (pageBreak ? "<w:pageBreakBefore/>" : "");
  const runs = pic || p.runs.map((r) => `<w:r>${r.bold || r.italic ? `<w:rPr>${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`).join("");
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${runs}</w:p>`;
};

const style = (id: string, name: string, rpr: string, ppr = "", extra = "") =>
  `<w:style w:type="paragraph" w:styleId="${id}"${id === "Normal" ? ' w:default="1"' : ""}><w:name w:val="${name}"/>${extra}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}<w:rPr>${rpr}</w:rPr></w:style>`;

/** A .docx from pages of paragraphs. Page n > 1 starts with a page break; an empty page keeps its break. */
export function buildDocx(pages: readonly (readonly Para[])[]): Uint8Array {
  const blank: Para = { runs: [], heading: 0 };
  const media: Record<string, Uint8Array> = {};
  let rels = "";
  const exts = new Set<string>();
  const body = pages.map((ps, i) => (ps.length ? ps : [blank]).map((p, j) => {
    let pic = "";
    if (p.image) {
      const n = Object.keys(media).length + 1;
      media[`word/media/image${n}.${p.image.ext}`] = p.image.bytes;
      rels += `<Relationship Id="rIdImg${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.${p.image.ext}"/>`;
      exts.add(p.image.ext);
      pic = drawing(`rIdImg${n}`, n, p.image);
    }
    return paraXml(p, i > 0 && j === 0, pic);
  }).join("")).join("");
  const defaults = [...exts].map((e) => `<Default Extension="${e}" ContentType="image/${e === "jpg" ? "jpeg" : "png"}"/>`).join("");
  const file = (s: string) => strToU8(HEAD + s);
  const H = (n: number, sz: number, ppr: string) => style(`Heading${n}`, `heading ${n}`, `<w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`, `<w:keepNext/>${ppr}<w:outlineLvl w:val="${n - 1}"/>`, '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>');
  return zipSync({
    ...media,
    "[Content_Types].xml": file('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + defaults + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    "_rels/.rels": file('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/_rels/document.xml.rels": file('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels + '</Relationships>'),
    "word/document.xml": file(`<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    "word/styles.xml": file(`<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${style("Normal", "Normal", "")}${H(1, 40, '<w:spacing w:before="360" w:after="120"/>')}${H(2, 32, '<w:spacing w:before="280" w:after="100"/>')}</w:styles>`),
  });
}
