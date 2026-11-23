import { renderThumb } from "../core/render";
import { store } from "../core/store";
import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { numberField } from "../ui/fields";
import { base, pdfLossWarnings } from "./pages";
import { pageChoice } from "./pagesel";
import type { Ctx, ToolDef } from "./types";

const PT = 72 / 25.4;
const MIN_SIDE = 18; // pt left of a page, as ops/crop.ts (not imported: it pulls pdf-lib into the main thread)
const SIDES = ["top", "right", "bottom", "left"] as const;
const LABEL = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };

const ui = (ctx: Ctx) => ctx.local(() => ({
  m: Object.fromEntries(SIDES.map((s) => [s, numberField({ id: `crop-${s}`, label: `${LABEL[s]} (mm)`, value: 0, min: 0, step: 1, decimal: true, testid: `crop-${s}`, reserve: true, onInput: () => ctx.refresh() })])) as Record<(typeof SIDES)[number], ReturnType<typeof numberField>>,
  pages: pageChoice(ctx, "crop"),
  canvas: h("canvas", { class: "crop__canvas", attrs: { "aria-hidden": "true" } }),
  keep: h("div", { class: "crop__keep", attrs: { "data-testid": "crop-keep" } }),
  box: h("div", { class: "crop__page", attrs: { "data-testid": "crop-preview" } }),
  cap: h("p", { class: "field__hint", attrs: { "data-testid": "crop-caption" } }),
  key: "",
  cancel: undefined as (() => void) | undefined,
}));

const plan = (ctx: Ctx) => {
  const u = ui(ctx);
  const mm = SIDES.map((s) => Number(u.m[s].input.value));
  const sel = u.pages.read(ctx.file?.info?.pageCount);
  const bad = mm.some((n, i) => u.m[SIDES[i]].input.value === "" || !Number.isFinite(n) || n < 0);
  const [top, right, bottom, left] = mm.map((n) => n * PT);
  const first = sel?.pages[0];
  const sz = first === undefined ? undefined : ctx.file?.info?.pageSizes[first];
  const turned = !!sz && (sz.rotate / 90) % 2 === 1;
  const w = sz ? (turned ? sz.h : sz.w) : 0;
  const ht = sz ? (turned ? sz.w : sz.h) : 0;
  return { sel, bad, top, right, bottom, left, none: mm.every((n) => n === 0), first, w, h: ht, tooBig: !!sz && (w - left - right < MIN_SIDE || ht - top - bottom < MIN_SIDE) };
};

export const crop: ToolDef = {
  id: "crop", title: "Crop PDF", group: "Edit",
  blurb: "Trim the edges of pages.",
  lede: "Cut a margin off each edge. The shaded border in the preview is what gets hidden.",
  accepts: "pdf",
  next: ["compress", "redact", "page-numbers", "watermark", "protect"],
  options(ctx) {
    const u = ui(ctx);
    u.box.append(u.canvas, u.keep);
    return h("div", { class: "crop" },
      h("div", { class: "crop__fields" }, ...SIDES.map((s) => u.m[s].el)),
      u.pages.el, u.box, u.cap,
      h("p", { class: "hs-banner hs-banner--info", attrs: { role: "note", "data-testid": "crop-note" } },
        "Cropping hides the edges but does not delete them: the cut-off content is still in the file. To remove content for good, use ",
        h("a", { href: "#/redact", text: "Redact" }), "."));
  },
  sync(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    for (const s of SIDES) u.m[s].setError(u.m[s].input.value === "" || Number(u.m[s].input.value) < 0 ? "Use 0 or more." : null);
    u.box.hidden = !ctx.file || p.first === undefined;
    if (u.box.hidden) { u.cap.textContent = ""; return; }
    u.cap.textContent = p.tooBig ? "These margins leave almost nothing of the page. Use smaller margins." : `Preview of page ${p.first! + 1}.`;
    u.box.style.setProperty("--ar", `${p.w} / ${p.h}`);
    const pct = (n: number, of: number) => `${Math.min(Math.max((n / of) * 100, 0), 100)}%`;
    u.keep.style.inset = `${pct(p.top, p.h)} ${pct(p.right, p.w)} ${pct(p.bottom, p.h)} ${pct(p.left, p.w)}`;
    const f = ctx.file!;
    const key = `${f.id}:${p.first}`;
    if (key === u.key) return;
    u.key = key;
    u.cancel?.();
    void store.doc(f).then((doc) => {
      const r = renderThumb(doc, p.first! + 1, 0, u.canvas, 240);
      u.cancel = r.cancel;
      return r.done;
    }).catch(() => undefined);
  },
  destroy(ctx) { ui(ctx).cancel?.(); },
  warnings: pdfLossWarnings,
  ready(ctx) { const p = plan(ctx); return !!ctx.file && !!p.sel && !p.bad && !p.none && !p.tooBig; },
  whyDisabled: (ctx) => (!ctx.file ? "Add a PDF first." : plan(ctx).none ? "Set at least one margin." : "Check the margins and pages above."),
  primaryLabel: () => "Crop PDF",
  async run(ctx) {
    const p = plan(ctx);
    const f = ctx.file!;
    const options = { top: p.top, right: p.right, bottom: p.bottom, left: p.left, pages: p.sel!.all ? undefined : p.sel!.pages };
    const r = await ctx.call<OpResult>("cropPages", { file: ctx.input(f), options, o: { producerCredit: ctx.producerCredit } });
    return [{ ...r, name: `${base(f.name)}-cropped.pdf` }];
  },
};
