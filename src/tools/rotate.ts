import { renderThumb } from "../core/render";
import { store } from "../core/store";
import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { base, pdfLossWarnings } from "./pages";
import { pageChoice } from "./pagesel";
import type { Ctx, ToolDef } from "./types";

const TURNS: Record<string, [label: string, about: string, angle: 90 | 180 | 270]> = {
  right: ["Right", "90 degrees clockwise.", 90],
  left: ["Left", "90 degrees anticlockwise.", 270],
  flip: ["Upside down", "Turn 180 degrees.", 180],
};
const PREVIEW = 8;

const ui = (ctx: Ctx) => ctx.local(() => ({
  turn: radioGroup({ name: "turn", legend: "Which way", value: "right", testid: (v) => `turn-${v}`, onChange: () => ctx.refresh(), options: Object.entries(TURNS).map(([k, [l, a]]) => [k, l, a]) }),
  pages: pageChoice(ctx, "rot"),
  strip: h("div", { class: "rot__strip", attrs: { "data-testid": "rot-strip" } }),
  note: h("p", { class: "field__hint", attrs: { "data-testid": "rot-note" } }),
  cells: [] as { canvas: HTMLCanvasElement; key: string; cancel?: () => void }[],
  fileId: undefined as number | undefined,
}));

const plan = (ctx: Ctx) => {
  const u = ui(ctx);
  return { sel: u.pages.read(ctx.file?.info?.pageCount), angle: TURNS[u.turn.value()][2] };
};

/** First pages of the file, drawn with the turn applied to the chosen ones. */
async function preview(ctx: Ctx) {
  const u = ui(ctx);
  const f = ctx.file;
  const p = plan(ctx);
  if (!f || !p.sel) { u.strip.replaceChildren(); u.cells = []; u.note.textContent = ""; return; }
  const n = Math.min(PREVIEW, f.info!.pageCount);
  if (u.fileId !== f.id || u.cells.length !== n) {
    u.cells.forEach((c) => c.cancel?.());
    u.fileId = f.id;
    u.cells = Array.from({ length: n }, () => ({ canvas: h("canvas", { class: "rot__page", attrs: { "aria-hidden": "true" } }), key: "" }));
    u.strip.replaceChildren(...u.cells.map((c, i) => h("figure", { class: "rot__cell" }, c.canvas, h("figcaption", { text: String(i + 1) }))));
  }
  u.note.textContent = f.info!.pageCount > n ? `Showing the first ${n} pages.` : "";
  const doc = await store.doc(f);
  u.cells.forEach((c, i) => {
    const turn = p.sel!.pages.includes(i) ? p.angle : 0;
    const key = `${f.id}:${turn}`;
    if (c.key === key) return;
    c.key = key;
    c.cancel?.();
    const r = renderThumb(doc, i + 1, turn, c.canvas, 96);
    c.cancel = r.cancel;
    r.done.catch(() => undefined);
  });
}

export const rotate: ToolDef = {
  id: "rotate", title: "Rotate PDF", group: "Organize",
  blurb: "Turn pages the right way up.",
  lede: "Turn every page, or only some, so they read the right way up. Your original is never changed.",
  accepts: "pdf", batch: true,
  next: ["organize", "compress", "page-numbers", "watermark", "protect"],
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "rot" }, u.turn.el, u.pages.el, u.strip, u.note);
  },
  sync(ctx) { preview(ctx).catch(() => undefined); },
  destroy(ctx) { ui(ctx).cells.forEach((c) => c.cancel?.()); },
  warnings: pdfLossWarnings,
  ready: (ctx) => !!ctx.file && !!plan(ctx).sel,
  whyDisabled: (ctx) => (ctx.file ? "Type which pages to turn." : "Add a PDF first."),
  primaryLabel: () => "Rotate PDF",
  async run(ctx) {
    const p = plan(ctx);
    const f = ctx.file!;
    const r = await ctx.call<OpResult>("rotatePages", { file: ctx.input(f), options: { angle: p.angle, pages: p.sel!.all ? undefined : p.sel!.pages }, o: { producerCredit: ctx.producerCredit } });
    return [{ ...r, name: `${base(f.name)}-rotated.pdf` }];
  },
};
