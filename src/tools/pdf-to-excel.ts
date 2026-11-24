// PDF to Excel: pdf.js text on the main thread (as PDF to Word), tables found from item positions, written as .xlsx or CSV.
import { strToU8, zipSync } from "fflate";
import { buildCsv, buildXlsx, detectGrid, type XItem } from "../core/xlsx";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { h, plural } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => {
  const scan = h("p", { class: "hs-banner hs-banner--warn", hidden: true, attrs: { role: "note", "data-testid": "pte-scan" } });
  const mode = radioGroup({
    name: "pte-mode", legend: "File type", value: "xlsx", testid: (v) => `pte-${v}`,
    options: [["xlsx", "Excel (.xlsx)", "One sheet per page, numbers as numbers."], ["csv", "CSV", "One .csv per page, zipped when there is more than one."]],
  });
  return { scan, mode, root: h("div", { class: "pte" }, mode.el, h("p", { class: "field__hint", text: "Works best on PDFs made from spreadsheets or reports. Scanned pages need OCR first. Merged cells and borders are not kept." }), scan) };
});

export const pdfToExcel: ToolDef = {
  id: "pdf-to-excel", title: "PDF to Excel", heading: "Pull tables out of a PDF", group: "Convert",
  blurb: "Pull tables out into a spreadsheet.",
  lede: "Find the rows and columns on each page and save them as an Excel file or CSV.",
  accepts: "pdf",
  next: [],
  options: (ctx) => ui(ctx).root,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Make spreadsheet",
  async run(ctx): Promise<OpResult[]> {
    const u = ui(ctx);
    const f = ctx.file!;
    const csv = u.mode.value() === "csv";
    const doc = await store.doc(f);
    const grids: string[][][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
      ctx.note(`Reading page ${i} of ${doc.numPages}`);
      const page = await doc.getPage(i);
      grids.push(detectGrid((await page.getTextContent()).items.filter((it) => "str" in it) as unknown as XItem[]));
      page.cleanup();
      ctx.o.onProgress?.(i, doc.numPages);
    }
    const empty = grids.filter((g) => !g.length).length;
    u.scan.replaceChildren();
    u.scan.hidden = !empty;
    if (empty) u.scan.append(
      empty === grids.length ? "No text found. This PDF may be a scan. " : `${plural(empty, "page")} had no text; they may be scans. `,
      h("a", { href: "#/ocr", text: "Run OCR" }), " first to make the text readable.");
    ctx.note(`${plural(grids.length - empty, "page")} with text.`);
    const stem = base(f.name);
    if (!csv) return [{ bytes: buildXlsx(grids), name: `${stem}.xlsx`, warnings: [] }];
    if (grids.length === 1) return [{ bytes: strToU8(buildCsv(grids[0])), name: `${stem}.csv`, warnings: [] }];
    const files: Record<string, Uint8Array> = {};
    grids.forEach((g, i) => { files[`${stem}-page-${i + 1}.csv`] = strToU8(buildCsv(g)); });
    return [{ bytes: zipSync(files), name: `${stem}-csv.zip`, warnings: [] }];
  },
};
