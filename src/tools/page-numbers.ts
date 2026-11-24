import type { NumberPosition, PageNumberOptions } from "../ops/stamp";
import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { badChars, ZH_HINT, zhWouldHelp } from "../core/winansi";
import { checkField, numberField, selectField, textField } from "../ui/fields";
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
  format: selectField({ id: "pn-format", label: "Preset", testid: "format-select", options: FORMATS.map(([v, f]) => [v, f(0)]), value: "{n}", onInput: () => { ui(ctx).text.input.value = ui(ctx).format.input.value; ctx.refresh(); } }),
  text: textField({ id: "pn-text", label: "Custom text", value: "{n}", placeholder: "Page {n} of {total}", testid: "text-input", msgTestId: "text-msg", reserve: true, onInput: () => ctx.refresh() }),
  margin: numberField({ id: "pn-margin", label: "Margin (mm)", value: 12.7, min: 0, max: 100, step: 0.1, decimal: true, testid: "margin-input", onInput: () => ctx.refresh() }),
  mirror: checkField({ id: "pn-mirror", label: "Mirror on even pages", testid: "mirror-check", onChange: () => ctx.refresh() }),
  start: numberField({ id: "pn-start", label: "Start counting at", value: 1, min: 0, step: 1, testid: "start-input", onInput: () => ctx.refresh() }),
  size: numberField({ id: "pn-size", label: "Text size (pt)", value: 12, min: 6, max: 48, step: 1, testid: "size-input", onInput: () => ctx.refresh() }),
  pages: pageChoice(ctx, "pn", true),
}));

function plan(ctx: Ctx) {
  const u = ui(ctx);
  const sel = u.pages.read(ctx.file?.info?.pageCount);
  const start = Number(u.start.input.value);
  const size = Number(u.size.input.value);
  const startOk = Number.isInteger(start) && start >= 0 && u.start.input.value !== "";
  const sizeOk = size >= 6 && size <= 48;
  const text = u.text.input.value;
  const bad = badChars(text);
  const margin = Number(u.margin.input.value);
  const marginOk = u.margin.input.value !== "" && margin >= 0 && margin <= 100;
  return { sel, start, size, startOk, sizeOk, text, bad, margin, marginOk };
}

export const pageNumbers: ToolDef = {
  id: "page-numbers", title: "Page numbers and headers", heading: "Add page numbers or a header", group: "Edit",
  blurb: "Number pages, add a header or footer.",
  lede: "Print a number or a line of text on each page. Use {n} for the page, {total} for the page count, {date} for today and {file} for the file name.",
  how: "Add a PDF, choose where the number goes, then save the numbered copy.",
  next: ["compress", "protect", "watermark", "sign"],
  accepts: "pdf", batch: true,
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "stampopts" }, u.position.el, u.format.el, u.text.el, u.start.el, u.size.el, u.margin.el, u.mirror.el, u.pages.el);
  },
  sync(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    const total = p.sel ? p.start + p.sel.pages.length - 1 : 0;
    FORMATS.forEach(([, f], i) => { u.format.input.options[i].textContent = f(total || 1); });
    u.text.setMessage(
      p.bad.length ? `These characters cannot be used yet: ${p.bad.map((c) => `"${c}"`).join(" ")}. Use Latin, Greek or Cyrillic letters, digits and basic punctuation.${zhWouldHelp(p.bad) ? ZH_HINT : ""}` : p.text.trim() ? "" : "Type the text to print on each page.",
      p.bad.length > 0,
    );
    u.margin.setError(p.marginOk ? null : "Use 0 to 100 mm.");
    u.start.setError(p.startOk ? null : "Use a whole number, 0 or more.");
    u.size.setError(p.sizeOk ? null : "Use a size from 6 to 48.");
  },
  warnings: pdfLossWarnings,
  ready(ctx) { const p = plan(ctx); return !!ctx.file && !!p.sel && p.startOk && p.sizeOk && p.marginOk && !!p.text.trim() && !p.bad.length; },
  primaryLabel: () => "Add page numbers",
  async run(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    const options: PageNumberOptions = { position: u.position.value(), format: p.text, allowPlain: true, margin: (p.margin * 72) / 25.4, mirror: u.mirror.input.checked, startAt: p.start, fontSize: p.size, pages: p.sel!.all ? undefined : p.sel!.pages };
    return [await ctx.call<OpResult>("addPageNumbers", { file: ctx.input(ctx.file!), options, o: { producerCredit: ctx.producerCredit } })];
  },
};
