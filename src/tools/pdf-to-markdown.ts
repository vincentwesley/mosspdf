// PDF to Markdown: pdf.js reads the text on the main thread (as PDF to Word does); headings, paragraphs and lists are rebuilt as .md.
import { toLines, type DocxItem } from "../core/docx";
import { pageMarkdown } from "../core/markdown";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { h, plural } from "../ui/dom";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => {
  const scan = h("p", { class: "hs-banner hs-banner--warn", hidden: true, attrs: { role: "note", "data-testid": "ptm-scan" } });
  return { scan, root: h("div", { class: "ptm" }, h("p", { class: "field__hint", text: "Keeps text, headings and lists. Layout, tables and pictures are not kept." }), scan) };
});

export const pdfToMarkdown: ToolDef = {
  id: "pdf-to-markdown", title: "PDF to Markdown", heading: "Turn a PDF into Markdown", group: "Convert",
  blurb: "Text, headings and lists as Markdown.",
  lede: "Get the text of a PDF as a Markdown .md file, with headings, paragraphs and lists.",
  how: "Add a PDF, then save its text as a Markdown file.",
  accepts: "pdf", batch: true,
  next: [],
  options: (ctx) => ui(ctx).root,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Make Markdown file",
  async run(ctx): Promise<OpResult[]> {
    const u = ui(ctx);
    const f = ctx.file!;
    const doc = await store.doc(f);
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
      ctx.note(`Reading page ${i} of ${doc.numPages}`);
      ctx.o.onProgress?.(i - 1, doc.numPages);
      const page = await doc.getPage(i);
      pages.push(pageMarkdown(toLines((await page.getTextContent()).items.filter((it) => "str" in it) as unknown as DocxItem[])));
      page.cleanup();
    }
    const empty = pages.filter((p) => !p).length;
    u.scan.replaceChildren();
    u.scan.hidden = !empty;
    if (empty) u.scan.append(
      empty === pages.length ? "No text found. This PDF may be a scan. " : `${plural(empty, "page")} had no text; they may be scans. `,
      h("a", { href: "#/ocr", text: "Run OCR" }), " first to make the text readable.");
    ctx.note(`${plural(pages.length - empty, "page")} with text.`);
    return [{ bytes: new TextEncoder().encode(pages.filter(Boolean).join("\n\n") + "\n"), name: `${base(f.name)}.md`, warnings: [] }];
  },
};
