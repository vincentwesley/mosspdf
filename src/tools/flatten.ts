import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { base, pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  what: radioGroup({
    name: "flat", legend: "What to lock in", value: "forms", testid: (v) => `flat-${v}`, onChange: () => ctx.refresh(),
    options: [
      ["forms", "Forms", "Fill-in fields become plain text on the page."],
      ["all", "Forms and annotations", "Also notes, highlights, stamps and drawings."],
    ],
  }),
}));

export const flatten: ToolDef = {
  id: "flatten", title: "Flatten PDF", group: "Edit",
  blurb: "Lock form fields and notes into the page.",
  lede: "Make form answers and notes part of the page so they can no longer be changed. Your original is never changed.",
  how: "Add a PDF, then save a copy where form answers and notes are fixed in place.",
  accepts: "pdf", batch: true,
  next: ["compress", "protect", "sign", "page-numbers", "watermark"],
  options: (ctx) => h("div", {}, ui(ctx).what.el),
  warnings: pdfLossWarnings,
  primaryLabel: () => "Flatten PDF",
  async run(ctx) {
    const f = ctx.file!;
    const all = ui(ctx).what.value() === "all";
    const r = await ctx.call<OpResult>("flatten", { file: ctx.input(f), options: { forms: true, annotations: all }, o: { producerCredit: ctx.producerCredit } });
    return [{ ...r, name: `${base(f.name)}-flattened.pdf` }];
  },
};
