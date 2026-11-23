import { renderThumb } from "../core/render";
import { store, ops } from "../core/store";
import { inkRatio, isBlank, type Sensitivity } from "../ops/blank";
import { PdfError, type PageSpec } from "../ops/types";
import { h, plural } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { base, compress, pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const LEVELS: [Sensitivity, string, string][] = [
  ["strict", "Strict", "Only truly empty pages."],
  ["normal", "Normal", "Pages with at most a few stray marks."],
  ["loose", "Loose", "Also pages with scanner specks or faint edges."],
];
const SHOWN = 8;
const SCAN_WIDTH = 160;

const ui = (ctx: Ctx) => ctx.local(() => ({
  level: radioGroup({ name: "blank", legend: "How empty counts as blank", value: "normal", testid: (v) => `blank-${v}`, onChange: () => ctx.refresh(), options: LEVELS }),
  status: h("p", { class: "field__hint", attrs: { "data-testid": "blank-status", "aria-live": "polite" } }),
  strip: h("div", { class: "rot__strip", attrs: { "data-testid": "blank-strip" } }),
  /** Ink share per page of the file being scanned (undefined while scanning). */
  ratios: undefined as number[] | undefined,
  fileId: undefined as number | undefined,
  cancel: undefined as (() => void) | undefined,
  thumbs: "",
  cells: [] as { cancel: () => void }[],
}));

const blanks = (ctx: Ctx): number[] => {
  const u = ui(ctx);
  const s = u.level.value() as Sensitivity;
  return (u.ratios ?? []).flatMap((r, i) => (isBlank(r, s) ? [i] : []));
};

async function scan(ctx: Ctx) {
  const u = ui(ctx);
  const f = ctx.file!;
  let stop = false;
  u.cancel = () => { stop = true; };
  const doc = await store.doc(f);
  const canvas = h("canvas", { attrs: { "aria-hidden": "true" } });
  const ratios: number[] = [];
  for (let i = 1; i <= f.info!.pageCount; i++) {
    if (stop) return;
    u.status.textContent = `Checking page ${i} of ${f.info!.pageCount}`;
    await renderThumb(doc, i, 0, canvas, SCAN_WIDTH).done;
    const c = canvas.getContext("2d", { willReadFrequently: true })!;
    ratios.push(inkRatio(c.getImageData(0, 0, canvas.width, canvas.height).data));
  }
  if (stop) return;
  u.ratios = ratios;
  ctx.refresh();
}

function show(ctx: Ctx) {
  const u = ui(ctx);
  const f = ctx.file;
  u.cells.forEach((c) => c.cancel());
  u.cells = [];
  if (!f || !u.ratios) { u.strip.replaceChildren(); u.thumbs = ""; return; }
  const b = blanks(ctx);
  const n = f.info!.pageCount;
  u.status.textContent = !b.length ? "No blank pages found. Try a looser setting." : b.length === n ? "Every page looks blank, so nothing would be left. Try a stricter setting."
    : `${plural(b.length, "blank page")} will be removed: ${compress(b.map((i) => i + 1))}.`;
  const shown = b.slice(0, SHOWN);
  const cells = shown.map((i) => ({ i, canvas: h("canvas", { class: "rot__page", attrs: { "aria-hidden": "true" } }) }));
  u.strip.replaceChildren(...cells.map((c) => h("figure", { class: "rot__cell" }, c.canvas, h("figcaption", { text: String(c.i + 1) }))));
  void store.doc(f).then((doc) => cells.forEach((c) => {
    const r = renderThumb(doc, c.i + 1, 0, c.canvas, 96);
    u.cells.push(r);
    r.done.catch(() => undefined);
  }));
}

export const removeBlank: ToolDef = {
  id: "remove-blank", title: "Remove blank pages", group: "Organize",
  blurb: "Drop empty pages from a scan or export.",
  lede: "Find pages with nothing on them and drop them. You see which pages go before you confirm. Your original is never changed.",
  accepts: "pdf",
  next: ["organize", "compress", "ocr", "page-numbers", "protect"],
  options: (ctx) => h("div", { class: "rot" }, ui(ctx).level.el, ui(ctx).status, ui(ctx).strip),
  sync(ctx) {
    const u = ui(ctx);
    const f = ctx.file;
    if (u.fileId !== f?.id) {
      u.cancel?.();
      u.fileId = f?.id;
      u.ratios = undefined;
      if (f) scan(ctx).catch(() => { u.status.textContent = "This PDF could not be checked."; });
      else u.status.textContent = "";
    }
    const key = `${f?.id}:${u.level.value()}:${u.ratios ? 1 : 0}`;
    if (key !== u.thumbs) { u.thumbs = key; show(ctx); }
  },
  destroy(ctx) { ui(ctx).cancel?.(); ui(ctx).cells.forEach((c) => c.cancel()); },
  warnings: pdfLossWarnings,
  ready(ctx) { const n = blanks(ctx).length; return !!ctx.file && n > 0 && n < ctx.file.info!.pageCount; },
  whyDisabled: (ctx) => (!ctx.file ? "Add a PDF first." : ui(ctx).ratios ? "No blank pages to remove." : "Checking the pages."),
  primaryLabel(ctx) { const n = blanks(ctx).length; return n ? `Remove ${plural(n, "page")}` : "Remove blank pages"; },
  async run(ctx) {
    const f = ctx.file!;
    const drop = new Set(blanks(ctx));
    if (drop.size >= f.info!.pageCount) throw new PdfError("unsupported", "Every page looks blank, so nothing would be left.", f.name);
    const pages: PageSpec[] = Array.from({ length: f.info!.pageCount }, (_, i) => i).filter((i) => !drop.has(i)).map((page) => ({ source: 0, page, rotate: 0 }));
    return [await ops.assemble([f], pages, `${base(f.name)}-no-blanks.pdf`, ctx.o)];
  },
};
