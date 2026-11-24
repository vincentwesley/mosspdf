// PDF text items to a table grid (rows by baseline, columns by whitespace gaps), then to .xlsx / CSV. Pure.
import { strToU8, zipSync } from "fflate";
import { esc } from "./docx";

/** The part of a pdf.js TextItem that is used here. */
export interface XItem { str: string; width?: number; height?: number; transform?: number[] }
export type Cell = string | { n: number; pct?: boolean; text: string };

interface Seg { x0: number; x1: number }
interface It extends Seg { s: string; size: number; y: number }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 10; };

/** Items to a grid of strings. Rows: baseline within 0.5x text size. Columns: x ranges that at most 20% of the multi-cell rows cover. */
export function detectGrid(items: readonly XItem[]): string[][] {
  const its: It[] = [];
  for (const i of items) {
    if (!i.str.trim()) continue;
    const t = i.transform ?? [];
    const size = i.height || Math.abs(t[3] ?? 0) || 10;
    const x0 = t[4] ?? 0;
    its.push({ s: i.str, size, y: t[5] ?? 0, x0, x1: x0 + (i.width ?? i.str.length * size * 0.5) });
  }
  its.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const rows: { y: number; size: number; its: It[] }[] = [];
  for (const it of its) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.y - r.y) <= 0.5 * Math.max(it.size, r.size)) { r.its.push(it); r.size = Math.max(r.size, it.size); } else rows.push({ y: it.y, size: it.size, its: [it] });
  }
  const segs = rows.map((r) => {
    r.its.sort((a, b) => a.x0 - b.x0);
    const out: Seg[] = [];
    for (const it of r.its) {
      const l = out[out.length - 1];
      if (l && it.x0 - l.x1 <= 0.6 * it.size) l.x1 = Math.max(l.x1, it.x1); else out.push({ x0: it.x0, x1: it.x1 });
    }
    return out;
  });
  // Whitespace columns over the rows that have 2+ cells (single-cell rows are titles or notes).
  const multi = segs.filter((s) => s.length > 1);
  const bounds: number[] = [];
  if (multi.length) {
    const xs = [...new Set(multi.flat().flatMap((s) => [s.x0, s.x1]))].sort((a, b) => a - b);
    const minW = 0.5 * median(its.map((i) => i.size));
    const allow = Math.floor(0.2 * multi.length);
    let seen = false, start = -1;
    for (let i = 0; i + 1 < xs.length; i++) {
      const mid = (xs[i] + xs[i + 1]) / 2;
      const cover = multi.reduce((n, s) => n + (s.some((g) => g.x0 <= mid && mid <= g.x1) ? 1 : 0), 0);
      if (cover > allow) {
        if (start >= 0 && seen && xs[i] - start >= minW) bounds.push((start + xs[i]) / 2);
        seen = true; start = -1;
      } else if (start < 0) start = xs[i];
    }
  }
  const ncol = bounds.length + 1;
  return rows.map((r) => {
    const cells: string[] = Array(ncol).fill("");
    const last: (It | undefined)[] = Array(ncol);
    for (const it of r.its) {
      const c = bounds.filter((b) => b <= it.x0).length;
      const p = last[c];
      cells[c] += (p && it.x0 - p.x1 > 0.15 * it.size && !/\s$/.test(cells[c]) && !/^\s/.test(it.s) ? " " : "") + it.s;
      last[c] = it;
    }
    return cells.map((c) => c.replace(/\s+/g, " ").trim());
  });
}

const NUM = /^(\(?)([-+]?)\$?((?:[1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.\d+)?)(%?)(\)?)$/;
/** "1,234.56", "-12", "(12)", "45%" become numbers; text and leading-zero strings like "007" stay text. */
export function parseCell(raw: string): Cell {
  const m = NUM.exec(raw.trim());
  if (!m || !!m[1] !== !!m[5] || (m[1] && m[2]) || /^0\d/.test(m[3])) return raw;
  let n = Number(m[3].replace(/,/g, ""));
  if (m[1] || m[2] === "-") n = -n;
  if (m[4]) n = Number((n / 100).toPrecision(12));
  return { n, pct: !!m[4] || undefined, text: raw.trim() };
}

const col = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const sheetXml = (grid: readonly (readonly string[])[]) => {
  const rows = grid.map((r, y) => {
    const cs = r.map((raw, x) => {
      if (!raw) return "";
      const c = parseCell(raw), ref = col(x) + (y + 1);
      if (typeof c === "string") return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
      return `<c r="${ref}"${c.pct ? ` s="${/\./.test(c.text) ? 2 : 1}"` : ""}><v>${c.n}</v></c>`;
    }).join("");
    return cs ? `<row r="${y + 1}">${cs}</row>` : "";
  }).join("");
  return `${HEAD}<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
};

/** One sheet per page ("Page 1"...). Numbers become numeric cells, the rest inline strings. */
export function buildXlsx(pages: readonly (readonly (readonly string[])[])[]): Uint8Array {
  const f = (s: string) => strToU8(HEAD + s);
  const list = pages.length ? pages : [[]];
  const n = list.length;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": f(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": f(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": f(`<workbook ${NS} xmlns:r="${R}"><sheets>${list.map((_, i) => `<sheet name="Page ${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": f(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": f(`<styleSheet ${NS}><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`),
  };
  list.forEach((g, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(g)); });
  return zipSync(files);
}

const GUARD = /^[=+\-@\t\r]/;
const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** RFC 4180 CSV (CRLF, UTF-8 BOM for Excel). Text starting with = + - @ tab or CR gets a leading ' so spreadsheets do not run it; numbers are written plainly. */
export function buildCsv(grid: readonly (readonly string[])[]): string {
  return "﻿" + grid.map((r) => r.map((raw) => {
    const c = parseCell(raw);
    return typeof c !== "string" ? q(c.pct ? c.text : String(c.n)) : q(GUARD.test(c) ? `'${c}` : c);
  }).join(",") + "\r\n").join("");
}
