import { parseRanges } from "../ops/ranges";
import { plural } from "../ui/dom";
import { textField } from "../ui/fields";
import { assemble, base, compress, pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const field = (ctx: Ctx) => ctx.local(() => textField({
  id: "ranges", label: "Pages to extract, for example 1-3, 5", placeholder: "1-3, 5, 8-", testid: "range-input", msgTestId: "range-msg", reserve: true, onInput: () => ctx.refresh(),
}));

/** The 1-based pages named in the text box, or null when it is empty or invalid (the field then says why). */
function typedPages(ctx: Ctx): number[] | null {
  const f = field(ctx);
  if (!ctx.file) return null;
  try {
    const nums = [...new Set(parseRanges(f.input.value, ctx.file.info!.pageCount).flat().map((p) => p + 1))].sort((a, b) => a - b);
    f.setMessage(`${plural(nums.length, "page")} selected.`);
    return nums;
  } catch (e) {
    const text = f.input.value.trim();
    f.setMessage(text ? (e as Error).message : "", !!text);
    return null;
  }
}

export const extract: ToolDef = {
  id: "extract", title: "Extract pages", group: "Organize",
  blurb: "Keep only the pages you pick.",
  lede: "Pick the pages you want to keep. Your original is never changed.",
  accepts: "pdf", grid: { selectable: true },
  options: (ctx) => field(ctx).el,
  sync(ctx) {
    const f = field(ctx);
    f.el.hidden = !ctx.file;
    const nums = typedPages(ctx);
    if (nums && document.activeElement === f.input) { ctx.items.forEach((p, i) => (p.selected = nums.includes(i + 1))); ctx.syncGrid(); }
  },
  onItems(ctx) { field(ctx).input.value = compress(ctx.items.map((p, i) => (p.selected ? i + 1 : 0)).filter(Boolean)); },
  warnings: pdfLossWarnings,
  ready: (ctx) => ctx.items.some((p) => p.selected),
  whyDisabled: (ctx) => (ctx.file ? "Pick at least one page." : "Add a PDF first."),
  primaryLabel(ctx) { const n = ctx.items.filter((p) => p.selected).length; return n ? `Extract ${plural(n, "page")}` : "Extract pages"; },
  run: (ctx) => assemble(ctx, ctx.items.filter((p) => p.selected), `${base(ctx.file!.name)}-extract.pdf`),
};
