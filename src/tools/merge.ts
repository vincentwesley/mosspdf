import { ops } from "../core/store";
import { h } from "../ui/dom";
import { checkField } from "../ui/fields";
import { assemble, pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  bar: h("div", { class: "mergebar" }),
  marks: checkField({ id: "merge-marks", label: "Add a bookmark for each file", checked: true, testid: "merge-bookmarks" }),
  toggle: h("button", { class: "hs-btn hs-btn--secondary", type: "button", attrs: { "aria-expanded": "false", "data-testid": "edit-pages" }, on: { click: () => ctx.setPagesOpen(!ctx.pagesOpen) } }),
}));

export const merge: ToolDef = {
  id: "merge", title: "Merge", heading: "Merge PDFs", group: "Organize",
  blurb: "Combine PDFs into one.",
  lede: "Put your PDFs in the order you want, then combine them into one file.",
  accepts: "pdfs", grid: { showFile: true, open: false }, dropTitle: "Drop PDFs to merge",
  next: ["sign", "compress", "protect", "page-numbers", "watermark"],
  options(ctx) {
    const { bar, toggle, marks } = ui(ctx);
    bar.append(toggle);
    return h("div", { class: "split" }, h("p", { class: "opts__hint", text: "Use the arrows or drag the handle to put the files in order." }), marks.el, bar);
  },
  sync(ctx) {
    const { bar, toggle, marks } = ui(ctx);
    marks.el.hidden = ctx.pagesOpen && ctx.dirty; // an edited page list is built by assemble, which writes no bookmarks
    bar.hidden = ctx.files.length < 2;
    toggle.textContent = ctx.pagesOpen ? "Hide pages" : "Edit pages";
    toggle.setAttribute("aria-expanded", String(ctx.pagesOpen));
  },
  warnings: pdfLossWarnings,
  ready: (ctx) => ctx.files.length >= 2,
  primaryLabel: (ctx) => (ctx.files.length >= 2 ? `Merge ${ctx.files.length} files` : "Merge files"),
  run: (ctx) => (ctx.pagesOpen && ctx.dirty ? assemble(ctx, ctx.items, "merged.pdf") : ops.merge(ctx.files, ctx.o, ui(ctx).marks.input.checked).then((r) => [r])),
};
