// PDF to Word: pdf.js reads the text on the main thread (as PDF to text does); paragraphs and headings are rebuilt and written as a minimal .docx.
import type { PDFPageProxy } from "pdfjs-dist/build/pdf.mjs";
import { buildDocx, placeImages, toLines, toParas, type DocxItem, type FontStyle, type PagePic, type Para } from "../core/docx";
import { store } from "../core/store";
import { PdfError, type OpResult } from "../ops/types";
import { h, plural } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

// pdf.js operator codes (OPS in pdf.mjs; it is lazy-loaded so the values are copied here).
const SAVE = 10, RESTORE = 11, TRANSFORM = 12, IMG = 85, IMG_INLINE = 86, IMG_REPEAT = 88;
const MIN_PX = 32;
type Mat = number[];
const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
interface RawImg { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: ImageBitmap }

/** pdf.js image data to a PNG (canvas). RGB/RGBA/gray; null when the format is not one of those. */
async function toPng(img: RawImg): Promise<Uint8Array | null> {
  const { width: w, height: hh } = img;
  const c = document.createElement("canvas");
  c.width = w; c.height = hh;
  const g = c.getContext("2d");
  if (!g) return null;
  if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const rgba = new Uint8ClampedArray(w * hh * 4);
    const d = img.data;
    if (d.length === w * hh * 4) rgba.set(d);
    else if (d.length === w * hh * 3) for (let i = 0; i < w * hh; i++) { rgba[i * 4] = d[i * 3]; rgba[i * 4 + 1] = d[i * 3 + 1]; rgba[i * 4 + 2] = d[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    else if (d.length === w * hh) for (let i = 0; i < w * hh; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = d[i]; rgba[i * 4 + 3] = 255; }
    else return null;
    g.putImageData(new ImageData(rgba, w, hh), 0, 0);
  } else return null;
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** The pictures of a page with their upper edge and size in points, from the operator list. Duplicates of one object are kept once. */
async function pagePics(page: PDFPageProxy, ops: { fnArray: number[]; argsArray: unknown[][] }): Promise<PagePic[]> {
  const out: PagePic[] = [];
  const seen = new Set<string>();
  const stack: Mat[] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i] as unknown[];
    if (fn === SAVE) stack.push(ctm);
    else if (fn === RESTORE) ctm = stack.pop() ?? ctm;
    else if (fn === TRANSFORM) ctm = mul(a as Mat, ctm);
    else if (fn === IMG || fn === IMG_REPEAT || fn === IMG_INLINE) {
      const raw = fn === IMG_INLINE ? a[0] as RawImg : (typeof a[0] === "string" && page.objs.has(a[0]) ? page.objs.get(a[0]) as RawImg : null);
      if (!raw || raw.width < MIN_PX || raw.height < MIN_PX) continue;
      const key = typeof a[0] === "string" ? `${a[0]}@${ctm.join(",")}` : "";
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const [m0, m1, m2, m3, , f] = ctm;
      const wPt = Math.hypot(m0, m1), hPt = Math.hypot(m2, m3);
      if (wPt < 8 || hPt < 8) continue;
      const bytes = await toPng(raw);
      if (bytes) out.push({ bytes, ext: "png", top: f + Math.max(0, m3) + Math.max(0, m1), wPt, hPt });
    }
  }
  return out;
}

const ui = (ctx: Ctx) => ctx.local(() => {
  const scan = h("p", { class: "hs-banner hs-banner--warn", hidden: true, attrs: { role: "note", "data-testid": "ptw-scan" } });
  const mode = radioGroup({
    name: "ptw-mode", legend: "How to build the paragraphs", value: "flow", testid: (v) => `ptw-${v}`,
    options: [["flow", "Flowing text", "Lines of one paragraph are merged, so the text reflows in Word."], ["lines", "Line by line", "One paragraph per line, as the lines sit on the page."]],
  });
  const pics = radioGroup({
    name: "ptw-pics", legend: "Pictures", value: "pics", testid: (v) => `ptw-${v}`,
    options: [["pics", "Text and pictures", "Pictures are placed where they sit in the reading order."], ["text", "Text only", "Skip the pictures for a smaller file."]],
  });
  return { scan, mode, pics, root: h("div", { class: "ptw" }, mode.el, pics.el, h("p", { class: "field__hint", text: "Keeps text, headings, bold and italic, and pictures. Exact layout, columns and tables are not kept." }), scan) };
});

export const pdfToWord: ToolDef = {
  id: "pdf-to-word", title: "PDF to Word", heading: "Turn a PDF into a Word file", group: "Convert",
  blurb: "Turn the text into an editable .docx.",
  lede: "Get a PDF as an editable .docx with paragraphs, headings, bold and italic, and pictures. Each page starts on a new page.",
  how: "Add a PDF, then save its text as an editable Word file.",
  accepts: "pdf", batch: true,
  next: [],
  options: (ctx) => ui(ctx).root,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Make Word file",
  async run(ctx): Promise<OpResult[]> {
    const u = ui(ctx);
    const f = ctx.file!;
    const flow = u.mode.value() === "flow";
    const pics = u.pics.value() === "pics";
    const doc = await store.doc(f);
    const pages: Para[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
      ctx.note(`Reading page ${i} of ${doc.numPages}`);
      ctx.o.onProgress?.(i - 1, doc.numPages);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const ops = await page.getOperatorList(); // resolves the fonts and images
      const style: FontStyle = (id) => {
        try {
          if (!page.commonObjs.has(id)) return undefined;
          const f = page.commonObjs.get(id) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean };
          const n = f.name ?? "";
          return { bold: !!(f.bold || f.black) || /bold|black|heavy/i.test(n), italic: !!f.italic || /italic|oblique/i.test(n) };
        } catch { return undefined; }
      };
      let paras = toParas(toLines(tc.items.filter((it) => "str" in it) as unknown as DocxItem[], style), flow);
      if (pics) paras = placeImages(paras, await pagePics(page, ops as never), page.view[2] - page.view[0]);
      pages.push(paras);
      page.cleanup();
    }
    const empty = pages.filter((p) => !p.some((x) => x.runs.length)).length;
    u.scan.replaceChildren();
    u.scan.hidden = !empty;
    if (empty) u.scan.append(
      empty === pages.length ? "No text found. This PDF may be a scan. " : `${plural(empty, "page")} had no text; they may be scans. `,
      h("a", { href: "#/ocr", text: "Run OCR" }), " first to make the text readable.");
    ctx.note(`${plural(pages.length - empty, "page")} with text.`);
    return [{ bytes: buildDocx(pages), name: `${base(f.name)}.docx`, warnings: [] }];
  },
};
