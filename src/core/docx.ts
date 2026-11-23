// PDF text items to paragraphs, and paragraphs to a minimal .docx (zip of XML written by hand with fflate). Pure.
import { strToU8, zipSync } from "fflate";

/** The part of a pdf.js TextItem that is used here. */
export interface DocxItem { str: string; hasEOL?: boolean; fontName?: string; height?: number; transform?: number[] }
export interface Run { text: string; bold: boolean; italic: boolean }
export interface Para { runs: Run[]; heading: 0 | 1 | 2 }
export interface Line { runs: Run[]; x: number; y: number; size: number }

const add = (runs: Run[], r: Run) => {
  const l = runs[runs.length - 1];
  if (l && l.bold === r.bold && l.italic === r.italic) l.text += r.text; else runs.push({ ...r });
};

/** Items to lines: a line ends at `hasEOL` or when the baseline moves by more than half the text size. */
export function toLines(items: readonly DocxItem[]): Line[] {
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
      add(cur.runs, { text: it.str, bold: /bold/i.test(f), italic: /italic|oblique/i.test(f) });
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
    } else out.push({ runs: l.runs.map((r) => ({ ...r })), heading });
    prev = l;
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
/** XML-safe text: invalid control characters dropped, the five specials escaped. */
export const esc = (s: string) => s.replace(BAD, "").replace(/[&<>"']/g, (c) => ESC[c]);

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const paraXml = (p: Para, pageBreak: boolean) => {
  const pr = (p.heading ? `<w:pStyle w:val="Heading${p.heading}"/>` : "") + (pageBreak ? "<w:pageBreakBefore/>" : "");
  const runs = p.runs.map((r) => `<w:r>${r.bold || r.italic ? `<w:rPr>${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`).join("");
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${runs}</w:p>`;
};

const style = (id: string, name: string, rpr: string, ppr = "", extra = "") =>
  `<w:style w:type="paragraph" w:styleId="${id}"${id === "Normal" ? ' w:default="1"' : ""}><w:name w:val="${name}"/>${extra}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}<w:rPr>${rpr}</w:rPr></w:style>`;

/** A .docx from pages of paragraphs. Page n > 1 starts with a page break; an empty page keeps its break. */
export function buildDocx(pages: readonly (readonly Para[])[]): Uint8Array {
  const blank: Para = { runs: [], heading: 0 };
  const body = pages.map((ps, i) => (ps.length ? ps : [blank]).map((p, j) => paraXml(p, i > 0 && j === 0)).join("")).join("");
  const file = (s: string) => strToU8(HEAD + s);
  const H = (n: number, sz: number, ppr: string) => style(`Heading${n}`, `heading ${n}`, `<w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`, `<w:keepNext/>${ppr}<w:outlineLvl w:val="${n - 1}"/>`, '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>');
  return zipSync({
    "[Content_Types].xml": file('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    "_rels/.rels": file('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/_rels/document.xml.rels": file('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "word/document.xml": file(`<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    "word/styles.xml": file(`<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${style("Normal", "Normal", "")}${H(1, 40, '<w:spacing w:before="360" w:after="120"/>')}${H(2, 32, '<w:spacing w:before="280" w:after="100"/>')}</w:styles>`),
  });
}
