// PDF to Word: pdf.js reads the text on the main thread (as PDF to text does); paragraphs and headings are rebuilt and written as a minimal .docx.
import { buildDocx, toLines, toParas, type DocxItem, type Para } from "../core/docx";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { h, plural } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => {
  const scan = h("p", { class: "hs-banner hs-banner--warn", hidden: true, attrs: { role: "note", "data-testid": "ptw-scan" } });
  const mode = radioGroup({
    name: "ptw-mode", legend: "How to build the paragraphs", value: "flow", testid: (v) => `ptw-${v}`,
    options: [["flow", "Flowing text", "Lines of one paragraph are merged, so the text reflows in Word."], ["lines", "Line by line", "One paragraph per line, as the lines sit on the page."]],
  });
  return { scan, mode, root: h("div", { class: "ptw" }, mode.el, h("p", { class: "field__hint", text: "Keeps text, paragraphs and headings. Layout, tables and pictures are not kept." }), scan) };
});

export const pdfToWord: ToolDef = {
  id: "pdf-to-word", title: "PDF to Word", heading: "Turn a PDF into a Word file", group: "Convert",
  blurb: "Turn the text into an editable .docx.",
  lede: "Get the text of a PDF as an editable .docx with paragraphs and headings. Each page starts on a new page.",
  how: "Add a PDF, then save its text as an editable Word file.",
  accepts: "pdf",
  next: [],
  options: (ctx) => ui(ctx).root,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Make Word file",
  async run(ctx): Promise<OpResult[]> {
    const u = ui(ctx);
    const f = ctx.file!;
    const flow = u.mode.value() === "flow";
    const doc = await store.doc(f);
    const pages: Para[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
      ctx.note(`Reading page ${i} of ${doc.numPages}`);
      ctx.o.onProgress?.(i - 1, doc.numPages);
      const page = await doc.getPage(i);
      pages.push(toParas(toLines((await page.getTextContent()).items.filter((it) => "str" in it) as unknown as DocxItem[]), flow));
      page.cleanup();
    }
    const empty = pages.filter((p) => !p.length).length;
    u.scan.replaceChildren();
    u.scan.hidden = !empty;
    if (empty) u.scan.append(
      empty === pages.length ? "No text found. This PDF may be a scan. " : `${plural(empty, "page")} had no text; they may be scans. `,
      h("a", { href: "#/ocr", text: "Run OCR" }), " first to make the text readable.");
    ctx.note(`${plural(pages.length - empty, "page")} with text.`);
    return [{ bytes: buildDocx(pages), name: `${base(f.name)}.docx`, warnings: [] }];
  },
};
