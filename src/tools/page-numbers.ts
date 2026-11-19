import type { NumberPosition, PageNumberOptions } from "../ops/stamp";
import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { numberField, selectField } from "../ui/fields";
import { pdfLossWarnings } from "./pages";
import { pageChoice } from "./pagesel";
import type { Ctx, ToolDef } from "./types";

const POSITIONS: [NumberPosition, string][] = [
  ["top-left", "Top left"], ["top-center", "Top middle"], ["top-right", "Top right"],
  ["bottom-left", "Bottom left"], ["bottom-center", "Bottom middle"], ["bottom-right", "Bottom right"],
];
const FORMATS: [string, (total: number) => string][] = [
  ["{n}", () => "1"], ["Page {n}", () => "Page 1"], ["Page {n} of {total}", (t) => `Page 1 of ${t}`], ["{n} / {total}", (t) => `1 / ${t}`],
];

/** Six-way picker drawn as a little page: one native radio per spot, so arrow keys and screen readers work. */
function positionPicker(onChange: () => void) {
  const el = h("fieldset", { class: "radios pos" }, h("legend", { text: "Where on the page" }));
  const grid = h("div", { class: "pos__page", attrs: { "data-testid": "position" } });
  const radios = POSITIONS.map(([v, label]) => {
    const r = h("input", { type: "radio", class: "pos__radio", attrs: { name: "position", value: v, "data-testid": `pos-${v}` } });
    r.checked = v === "bottom-center";
    r.addEventListener("change", onChange);
    const cell = h("label", { class: `pos__cell pos__cell--${v}` }, r, h("span", { class: "sr-only", text: label }), h("span", { class: "pos__dot", attrs: { "aria-hidden": "true" } }));
    return [r, cell] as const;
  });
  grid.append(...radios.map(([, c]) => c));
  el.append(grid);
  return { el, value: () => (radios.find(([r]) => r.checked)?.[0].value ?? "bottom-center") as NumberPosition };
}

const ui = (ctx: Ctx) => ctx.local(() => ({
  position: positionPicker(() => ctx.refresh()),
  format: selectField({ id: "pn-format", label: "How the number looks", testid: "format-select", options: FORMATS.map(([v, f]) => [v, f(0)]), value: "{n}", onInput: () => ctx.refresh() }),
  start: numberField({ id: "pn-start", label: "Start counting at", value: 1, min: 0, step: 1, testid: "start-input", onInput: () => ctx.refresh() }),
  size: numberField({ id: "pn-size", label: "Text size (pt)", value: 12, min: 6, max: 48, step: 1, testid: "size-input", onInput: () => ctx.refresh() }),
  pages: pageChoice(ctx, "pn"),
}));

function plan(ctx: Ctx) {
  const u = ui(ctx);
  const sel = u.pages.read(ctx.file?.info?.pageCount);
  const start = Number(u.start.input.value);
  const size = Number(u.size.input.value);
  const startOk = Number.isInteger(start) && start >= 0 && u.start.input.value !== "";
  const sizeOk = size >= 6 && size <= 48;
  return { sel, start, size, startOk, sizeOk };
}

export const pageNumbers: ToolDef = {
  id: "page-numbers", title: "Page numbers", heading: "Add page numbers", group: "Edit",
  blurb: "Number the pages.",
  lede: "Print a number on each page. Choose where it goes and how it looks.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "stampopts" }, u.position.el, u.format.el, u.start.el, u.size.el, u.pages.el);
  },
  sync(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    const total = p.sel ? p.start + p.sel.pages.length - 1 : 0;
    FORMATS.forEach(([, f], i) => { u.format.input.options[i].textContent = f(total || 1); });
    u.start.setError(p.startOk ? null : "Use a whole number, 0 or more.");
    u.size.setError(p.sizeOk ? null : "Use a size from 6 to 48.");
  },
  warnings: pdfLossWarnings,
  ready(ctx) { const p = plan(ctx); return !!ctx.file && !!p.sel && p.startOk && p.sizeOk; },
  primaryLabel: () => "Add page numbers",
  async run(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    const options: PageNumberOptions = { position: u.position.value(), format: u.format.input.value, startAt: p.start, fontSize: p.size, pages: p.sel!.all ? undefined : p.sel!.pages };
    return [await ctx.call<OpResult>("addPageNumbers", { file: ctx.input(ctx.file!), options, o: { producerCredit: ctx.producerCredit } })];
  },
};
