// The comparison report as a PDF: title, file names, date, summary, then every change with its page references.
// Helvetica, or Noto Sans (no bold) when the text needs it (D20); characters neither covers print as "?" and the report says so.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { ReportData } from "../core/compare";
import { safeName } from "./assemble";
import { pickFont } from "./ufont";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import type { OpOptions, OpResult } from "./types";

const W = 595.28, H = 841.89, M = 50, BODY = 10.5;

export async function compareReport(r: ReportData, o: OpOptions): Promise<OpResult> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await pickFont(doc, [r.nameA, r.nameB, r.date, r.summary, ...r.notes, ...r.changes.flatMap((c) => [c.label, c.removed ?? "", c.added ?? ""])]);
  const bold = font.name === "Helvetica" ? await doc.embedFont(StandardFonts.HelveticaBold) : font;
  const ok = new Set(font.getCharacterSet());
  let lost = false;
  const safe = (t: string) => [...t.replace(/\s+/g, " ")].map((c) => (ok.has(c.codePointAt(0)!) ? c : ((lost = true), "?"))).join("");
  doc.setTitle("MossPDF comparison report");
  doc.setCreationDate(new Date()); doc.setModificationDate(new Date());

  let page!: PDFPage, y = 0;
  const fresh = () => { page = doc.addPage([W, H]); y = H - M; };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    let cur = "";
    for (const word of safe(text).split(" ")) {
      let w = word;
      while (f.widthOfTextAtSize(w, size) > width) { // a word wider than the line: cut it
        let k = w.length - 1;
        while (k > 1 && f.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (cur && f.widthOfTextAtSize(next, size) > width) { lines.push(cur); cur = w; } else cur = next;
    }
    return [...lines, cur].filter(Boolean);
  };
  /** A block of wrapped text, optionally with a bold label in front; starts a new page when it does not fit. */
  const para = (text: string, o2: { size?: number; bold?: boolean; label?: string; colour?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const size = o2.size ?? BODY, lead = size * 1.35, indent = o2.indent ?? 0;
    const lw = o2.label ? bold.widthOfTextAtSize(safe(o2.label) + " ", size) : 0;
    const lines = wrap(text, o2.bold ? bold : font, size, W - 2 * M - indent - lw);
    lines.forEach((line, i) => {
      if (!page || y - lead < M) fresh();
      y -= lead;
      if (i === 0 && o2.label) page.drawText(safe(o2.label), { x: M + indent, y, size, font: bold, color: rgb(...(o2.colour ?? [0, 0, 0])) });
      page.drawText(line, { x: M + indent + lw, y, size, font: o2.bold ? bold : font, color: rgb(0, 0, 0) });
    });
    y -= o2.gap ?? 4;
  };

  fresh();
  para("MossPDF comparison report", { size: 20, bold: true, gap: 10 });
  para(r.nameA, { label: "Original:" });
  para(r.nameB, { label: "Changed:" });
  para(r.date, { label: "Date:", gap: 12 });
  para(r.summary, { size: 14, bold: true, gap: 8 });
  for (const n of r.notes) para(n, { label: "Note:" });
  r.changes.forEach((c, i) => {
    if (i % 20 === 0) checkAbort(o.signal);
    y -= 8;
    para(c.label, { bold: true, gap: 2 });
    if (c.removed) para(c.removed, { label: "Removed:", colour: [0.62, 0.2, 0.05], indent: 12, gap: 2 });
    if (c.added) para(c.added, { label: "Added:", colour: [0.1, 0.25, 0.6], indent: 12, gap: 2 });
  });
  if (lost) para("Some characters are not available in this report's font and are shown as ?.", { size: 9, gap: 0 });
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: `${safeName(r.nameB, "document").slice(0, -4)}-comparison.pdf`, warnings: [] };
}
