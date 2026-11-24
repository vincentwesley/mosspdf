import { ops } from "../core/store";
import { parseRanges } from "../ops/ranges";
import type { SplitMode } from "../ops/types";
import { h, plural } from "../ui/dom";
import { numberField, radioGroup, textField } from "../ui/fields";
import { compress, pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

type Mode = "ranges" | "every" | "size" | "bookmarks";

const ui = (ctx: Ctx) => ctx.local(() => ({
  mode: radioGroup({
    name: "mode", legend: "How to split", value: "ranges", testid: (v) => `mode-${v}`, onChange: () => ctx.refresh(),
    options: [["ranges", "By page ranges", "You choose the pages for each file."], ["every", "Every N pages", "Equal parts, for example every 2 pages."], ["size", "By file size", "Keeps each file under a size limit."], ["bookmarks", "By bookmarks", "One file for each top-level bookmark."]],
  }),
  ranges: textField({ id: "ranges", label: "Page ranges. Each range becomes its own file.", placeholder: "1-3, 5, 8-", testid: "range-input", msgTestId: "range-msg", reserve: true, onInput: () => ctx.refresh() }),
  every: numberField({ id: "every", label: "Pages per file", value: 2, min: 1, testid: "every-input", onInput: () => ctx.refresh() }),
  size: numberField({ id: "size", label: "Largest file size (MB)", value: 5, min: 0.1, step: 0.1, decimal: true, testid: "size-input", onInput: () => ctx.refresh() }),
  hint: h("p", { class: "field__hint", attrs: { "data-testid": "bookmarks-hint" } }),
  preview: h("ol", { class: "parts", attrs: { "data-testid": "split-preview", "aria-label": "Files you will get" } }),
  box: h("div", { class: "split" }),
}));

/** The chosen split and, where it is known up front, the 1-based pages of each part. Null when the settings are not usable yet. */
function plan(ctx: Ctx): { mode: SplitMode; parts: number[][] | null } | null {
  const u = ui(ctx);
  const n = ctx.file?.info?.pageCount;
  if (!n) return null;
  const mode = u.mode.value() as Mode;
  if (mode === "ranges") {
    try {
      const parts = parseRanges(u.ranges.input.value, n).map((g) => g.map((p) => p + 1));
      u.ranges.setError(null);
      return { mode: { kind: "ranges", ranges: u.ranges.input.value }, parts };
    } catch (e) {
      const text = u.ranges.input.value.trim();
      u.ranges.setMessage(text ? (e as Error).message : "Type the pages for each file, for example 1-3, 5.", !!text);
      return null;
    }
  }
  if (mode === "every") {
    const k = Math.floor(Number(u.every.input.value));
    if (!(k >= 1)) return null;
    return { mode: { kind: "every", n: k }, parts: Array.from({ length: Math.ceil(n / k) }, (_, i) => Array.from({ length: Math.min(k, n - i * k) }, (_, j) => i * k + j + 1)) };
  }
  if (mode === "bookmarks") return ctx.file?.info?.hasOutline ? { mode: { kind: "bookmarks" }, parts: null } : null;
  const mb = Number(u.size.input.value);
  return mb > 0 ? { mode: { kind: "size", maxBytes: Math.round(mb * 1024 * 1024) }, parts: null } : null;
}

export const split: ToolDef = {
  id: "split", title: "Split", heading: "Split a PDF", group: "Organize",
  blurb: "Cut a PDF into parts.",
  lede: "Cut one PDF into several smaller files.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    u.box.append(u.mode.el, u.hint, u.ranges.el, u.every.el, u.size.el, u.preview);
    return u.box;
  },
  sync(ctx) {
    const u = ui(ctx);
    const has = !!ctx.file?.info?.hasOutline;
    if (!has && u.mode.value() === "bookmarks") u.mode.set("ranges");
    const mode = u.mode.value() as Mode;
    u.box.hidden = !ctx.file;
    u.ranges.el.hidden = mode !== "ranges";
    u.every.el.hidden = mode !== "every";
    u.size.el.hidden = mode !== "size";
    u.mode.el.querySelector<HTMLInputElement>("#mode-bookmarks")!.disabled = !has;
    u.hint.hidden = has;
    u.hint.textContent = has ? "" : "This file has no bookmarks, so it can't be split by them.";
    const s = plan(ctx);
    u.preview.replaceChildren(...(mode === "size"
      ? [h("li", { text: "MossPDF picks the page breaks so each file stays under this size." })]
      : mode === "bookmarks" ? [h("li", { text: "You get one file for each top-level bookmark, named after it." })]
      : (s?.parts ?? []).map((g) => h("li", { text: `${compress(g)} (${plural(g.length, "page")})`, attrs: { "data-testid": "split-part" } }))));
  },
  warnings: pdfLossWarnings,
  ready: (ctx) => !!plan(ctx),
  whyDisabled: (ctx) => (ctx.file ? "Check the split settings above." : "Add a PDF first."),
  primaryLabel(ctx) { const n = plan(ctx)?.parts?.length; return n ? `Split into ${plural(n, "file")}` : "Split"; },
  run: (ctx) => ops.split(ctx.file!, plan(ctx)!.mode, ctx.o),
};
