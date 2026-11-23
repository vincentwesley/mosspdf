// PDF to text: pdf.js reads the text of every page on the main thread (as Compare does); the result is a .txt download plus a read-only preview.
import { joinPages, pageText, type StrItem } from "../core/pagetext";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { announce, h, plural } from "../ui/dom";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

/** The preview shows this much; Copy and the download have everything. */
const PREVIEW_CHARS = 100_000;

const ui = (ctx: Ctx) => ctx.local(() => {
  const area = h("textarea", { class: "hs-input ptt__area", attrs: { readonly: true, rows: 12, "aria-label": "Text from the PDF", "data-testid": "ptt-text" } });
  const copy = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Copy text", attrs: { "data-testid": "ptt-copy" } });
  const scan = h("p", { class: "hs-banner hs-banner--warn", hidden: true, attrs: { role: "note", "data-testid": "ptt-scan" } });
  const more = h("p", { class: "field__hint", attrs: { "data-testid": "ptt-more" } });
  const s = { full: "", area, copy, scan, more, key: "", root: h("div", { class: "ptt", hidden: true, attrs: { "data-testid": "ptt" } }, scan, area, more, h("div", { class: "ptt__row" }, copy)) };
  copy.addEventListener("click", () => {
    const done = () => { copy.textContent = "Copied"; announce("Text copied."); setTimeout(() => (copy.textContent = "Copy text"), 1500); };
    navigator.clipboard.writeText(s.full).then(done, () => { const t = h("textarea", { class: "sr-only", attrs: { readonly: true, "aria-hidden": "true" } }); t.value = s.full; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); done(); });
  });
  return s;
});

export const pdfToText: ToolDef = {
  id: "pdf-to-text", title: "PDF to text", heading: "Copy the text out of a PDF", group: "Convert",
  blurb: "Copy out all the text.",
  lede: "Get all the text of a PDF as a .txt file, or copy it. Pages are separated by a line.",
  accepts: "pdf",
  next: [],
  options: (ctx) => ui(ctx).root,
  sync(ctx) {
    const u = ui(ctx);
    const key = ctx.file ? String(ctx.file.id) : "";
    if (key !== u.key) { u.key = key; u.root.hidden = true; u.full = ""; u.area.value = ""; }
  },
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Get text",
  async run(ctx): Promise<OpResult[]> {
    const u = ui(ctx);
    const f = ctx.file!;
    u.root.hidden = true;
    const doc = await store.doc(f);
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
      ctx.note(`Reading page ${i} of ${doc.numPages}`);
      ctx.o.onProgress?.(i - 1, doc.numPages);
      const page = await doc.getPage(i);
      pages.push(pageText((await page.getTextContent()).items.filter((it) => "str" in it) as unknown as StrItem[]));
      page.cleanup();
    }
    const empty = pages.filter((t) => !t).length;
    u.full = joinPages(pages);
    u.area.value = u.full.slice(0, PREVIEW_CHARS);
    u.more.textContent = u.full.length > PREVIEW_CHARS ? `The preview shows the first ${PREVIEW_CHARS.toLocaleString("en")} characters. Copy text and the download have all of it.` : "";
    u.scan.replaceChildren();
    u.scan.hidden = !empty;
    if (empty) u.scan.append(
      empty === pages.length ? "No text found. This PDF may be a scan. " : `${plural(empty, "page")} had no text; they may be scans. `,
      h("a", { href: "#/ocr", text: "Run OCR" }), " to make the text readable.");
    u.root.hidden = false;
    ctx.note(`${plural(pages.length - empty, "page")} with text.`);
    return [{ bytes: new TextEncoder().encode(u.full), name: `${base(f.name)}.txt`, warnings: [] }];
  },
};
