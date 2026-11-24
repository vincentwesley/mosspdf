import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { checkField, radioGroup, selectField } from "../ui/fields";
import { base, pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  layout: radioGroup({
    name: "nup-layout", legend: "Layout", value: "2", testid: (v) => `nup-${v}`, onChange: () => ctx.refresh(),
    options: [
      ["2", "2 per sheet", "Two pages side by side on a landscape sheet."],
      ["4", "4 per sheet", "Four pages in a grid, reading left to right, top to bottom."],
      ["booklet", "Booklet", "Print on both sides (flip on short edge), then fold the stack in half."],
    ],
  }),
  sheet: selectField({ id: "nup-sheet", label: "Sheet size", testid: "nup-sheet", onInput: () => ctx.refresh(), options: [["same", "Same as pages"], ["a4", "A4"], ["letter", "Letter"]] }),
  border: checkField({ id: "nup-border", label: "Thin border around each page", testid: "nup-border" }),
}));

export const nup: ToolDef = {
  id: "nup", title: "Pages per sheet", group: "Organize",
  blurb: "Put 2 or 4 pages on each sheet, or make a booklet.",
  lede: "Shrink pages so several fit on one sheet, or put them in booklet order for folding. Your original is never changed.",
  how: "Add a PDF, choose how many pages per sheet, then save the new layout.",
  accepts: "pdf", batch: true,
  next: ["compress", "protect"],
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "nup" }, u.layout.el, u.sheet.el, u.border.el);
  },
  warnings: pdfLossWarnings,
  ready: (ctx) => !!ctx.file,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Lay out pages",
  async run(ctx) {
    const u = ui(ctx);
    const f = ctx.file!;
    const layout = u.layout.value();
    const options = { layout, sheet: u.sheet.input.value, border: u.border.input.checked };
    const r = await ctx.call<OpResult>("nupPages", { file: ctx.input(f), options, o: { producerCredit: ctx.producerCredit } });
    return [{ ...r, name: `${base(f.name)}-${layout === "booklet" ? "booklet" : `${layout}-up`}.pdf` }];
  },
};
