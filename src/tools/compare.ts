// Compare (M7, D18): two PDFs, Original and Changed. Words are read with pdf.js on the main thread, diffed here (core/diff.ts), shown as
// a change list, side by side and as a pixel overlay (ui/compareview.ts). The report PDF is built in the ops worker.
import type { PDFDocumentProxy } from "pdfjs-dist/build/pdf.mjs";
import { compare as compareDocs, notes, plural, reportData, reportText, summaryLine } from "../core/compare";
import { wordsFromItems, type TextItemLike, type Word } from "../core/pagewords";
import { pixelDiff } from "../core/pixeldiff";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { compareView } from "../ui/compareview";
import { h } from "../ui/dom";
import { checkField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
/** Page pairs checked for "the text is the same but the pages look different" (each is two renders). */
const PIXEL_PAIRS = 60;

const ui = (ctx: Ctx) => ctx.local(() => ({
  ignoreCase: checkField({ id: "cmp-case", label: "Ignore case", testid: "cmp-ignore-case", onChange: () => ctx.refresh() }),
  ignorePunct: checkField({ id: "cmp-punct", label: "Ignore punctuation", testid: "cmp-ignore-punct", onChange: () => ctx.refresh() }),
  txt: checkField({ id: "cmp-txt", label: "Also save the changes as a text file (.txt)", testid: "cmp-out-txt", onChange: () => ctx.refresh() }),
  view: compareView(),
  key: "",
  summary: "",
}));

async function readWords(doc: PDFDocumentProxy, ctx: Ctx, label: string, done: { n: number; total: number }): Promise<Word[][]> {
  const pages: Word[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
    ctx.note(`Reading the ${label}, page ${i} of ${doc.numPages}`);
    ctx.o.onProgress?.(done.n++, done.total);
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(wordsFromItems(tc.items.filter((it) => "str" in it) as unknown as TextItemLike[]));
  }
  return pages;
}

export const compare: ToolDef = {
  id: "compare", title: "Compare", group: "Compare",
  blurb: "Spot what changed.",
  lede: "Put two versions of a PDF side by side and see what changed. Both stay on this device.",
  how: "Add the original and the changed PDF, then see the differences page by page.",
  accepts: "pdf-pair",
  next: [],
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "cmp-opts" }, h("div", { class: "cmp-opts__row" }, u.ignoreCase.el, u.ignorePunct.el, u.txt.el), u.view.el);
  },
  sync(ctx) {
    const u = ui(ctx);
    const key = [...ctx.files.map((f) => f.id), u.ignoreCase.input.checked, u.ignorePunct.input.checked].join("|");
    if (key !== u.key) { u.key = key; u.view.reset(); }
  },
  summary: (ctx) => ui(ctx).summary,
  destroy(ctx) { ui(ctx).view.destroy(); },
  primaryLabel: () => "Compare PDFs",
  async run(ctx): Promise<OpResult[]> {
    const u = ui(ctx);
    const files = [ctx.files[0], ctx.files[1]] as const;
    u.view.reset();
    const docs = [await store.doc(files[0]), await store.doc(files[1])] as const;
    const done = { n: 0, total: docs[0].numPages + docs[1].numPages };
    const wa = await readWords(docs[0], ctx, "Original", done);
    const wb = await readWords(docs[1], ctx, "Changed", done);
    ctx.note("Comparing…");
    const cmp = compareDocs(wa, wb, { ignoreCase: u.ignoreCase.input.checked, ignorePunct: u.ignorePunct.input.checked });
    let pixelPages = 0;
    const extra: string[] = [];
    if (!cmp.changes.length) {
      const pairs = cmp.align.slice(0, PIXEL_PAIRS);
      if (cmp.align.length > PIXEL_PAIRS) extra.push(`Only the first ${PIXEL_PAIRS} page pairs were checked for visual differences.`);
      for (const [i, p] of pairs.entries()) {
        if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
        ctx.note(`Comparing how the pages look, ${i + 1} of ${pairs.length}`);
        if ((await pixelDiff(docs[0], p.a === null ? null : p.a + 1, docs[1], p.b === null ? null : p.b + 1, 240)) > 8) pixelPages++;
      }
    }
    const summary = summaryLine(cmp, pixelPages);
    u.summary = summary;
    const scans = (!cmp.wordsA && cmp.pagesA > 0) || (!cmp.wordsB && cmp.pagesB > 0);
    u.view.show({ cmp, files: [files[0], files[1]], docs: [docs[0], docs[1]], words: [wa, wb], summary, notes: [...notes(cmp), ...extra], scans });
    const report = reportData(cmp, files[0].name, files[1].name, new Date().toISOString().slice(0, 10), pixelPages, [...(scans ? ["One or both files have no text (they look like scans). Run OCR first to compare words."] : []), ...extra]);
    const pdf = await ctx.call<OpResult>("compareReport", { report, o: { producerCredit: ctx.producerCredit } });
    const out = [pdf];
    if (u.txt.input.checked) out.push({ bytes: new TextEncoder().encode(reportText(report)), name: `${stem(files[1].name)}-comparison.txt`, warnings: [] });
    ctx.note(plural(cmp.changes.length, "change"));
    return out;
  },
};
