import type { BookmarkItem, OpResult, OutlineInfo } from "../ops";
import { h } from "../ui/dom";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

const MAX_LEVEL = 2; // three levels, as in src/ops/outline.ts
type Row = BookmarkItem & { key: number };

const ui = (ctx: Ctx) => ctx.local(() => ({
  list: h("ul", { class: "bm__list", attrs: { "data-testid": "bm-list" } }),
  note: h("p", { class: "field__hint", attrs: { role: "status", "data-testid": "bm-note" } }),
  rows: [] as Row[],
  next: 1,
  loaded: false,
  fileId: undefined as number | undefined,
  pageCount: 0,
}));

const pageOk = (r: Row, n: number) => r.page === null || (Number.isInteger(r.page) && r.page >= 1 && r.page <= n);
const bad = (ctx: Ctx) => ui(ctx).rows.some((r) => !pageOk(r, ui(ctx).pageCount));

/** Keeps each level at most one deeper than the row before it. */
function fix(rows: Row[]) {
  rows.forEach((r, i) => { r.level = i === 0 ? 0 : Math.max(0, Math.min(r.level, MAX_LEVEL, rows[i - 1].level + 1)); });
}

function render(ctx: Ctx, focus?: string) {
  const u = ui(ctx);
  fix(u.rows);
  const act = (label: string, glyph: string, id: string, on: () => void, disabled = false) =>
    h("button", { class: "hs-btn hs-btn--secondary bm__btn", type: "button", text: glyph, disabled, attrs: { "aria-label": label, title: label, "data-focus": `${id}`, "data-testid": `bm-${id.split(":")[1]}` }, on: { click: () => { on(); render(ctx, id); ctx.refresh(); } } });
  u.list.replaceChildren(...u.rows.map((r, i) => {
    const title = h("input", { class: "hs-input bm__title", type: "text", attrs: { "aria-label": `Bookmark ${i + 1} title`, "data-testid": "bm-title", autocomplete: "off", maxlength: 500, value: r.title } });
    title.addEventListener("input", () => { r.title = title.value; ctx.refresh(); });
    const page = h("input", { class: "hs-input bm__page", type: "number", attrs: { "aria-label": `Bookmark ${i + 1} page`, "data-testid": "bm-page", min: 1, max: u.pageCount, inputmode: "numeric", placeholder: "no page", value: r.page ?? "" } });
    page.addEventListener("input", () => { r.page = page.value === "" ? null : Number(page.value); page.setAttribute("aria-invalid", String(!pageOk(r, u.pageCount))); ctx.refresh(); });
    const move = (d: number) => () => { u.rows.splice(i + d, 0, ...u.rows.splice(i, 1)); };
    return h("li", { class: "bm__row", vars: { "--lvl": String(r.level) }, attrs: { "data-testid": "bm-row", "data-level": r.level } },
      title, page,
      act("Outdent", "←", `${r.key}:out`, () => { r.level--; }, r.level === 0),
      act("Indent", "→", `${r.key}:in`, () => { r.level++; }, i === 0 || r.level >= Math.min(MAX_LEVEL, u.rows[i - 1].level + 1)),
      act("Move up", "↑", `${r.key}:up`, move(-1), i === 0),
      act("Move down", "↓", `${r.key}:down`, move(1), i === u.rows.length - 1),
      act("Delete", "✕", `${r.key}:del`, () => { u.rows.splice(i, 1); }));
  }));
  u.note.textContent = !u.loaded ? "" : u.rows.length ? "" : "No bookmarks yet.";
  if (focus) (u.list.querySelector<HTMLElement>(`[data-focus="${focus}"]:not([disabled])`) ?? u.list.querySelector<HTMLElement>(".bm__title"))?.focus();
}

async function load(ctx: Ctx) {
  const u = ui(ctx);
  const f = ctx.file;
  u.fileId = f?.id;
  u.loaded = false;
  u.rows = [];
  u.pageCount = f?.info?.pageCount ?? 0;
  render(ctx);
  if (!f) return;
  try {
    const r = await ctx.call<OutlineInfo>("readOutline", { file: ctx.input(f) });
    if (u.fileId !== f.id) return;
    u.pageCount = r.pageCount;
    u.rows = r.items.map((it) => ({ ...it, key: u.next++ }));
    u.loaded = true;
  } catch (e) {
    if (u.fileId === f.id) u.note.textContent = e instanceof Error ? e.message : "Couldn't read the bookmarks.";
    return;
  }
  render(ctx);
  ctx.refresh();
}

export const bookmarks: ToolDef = {
  id: "bookmarks", title: "Bookmarks", group: "Edit",
  blurb: "Add, rename or remove the bookmarks list.",
  lede: "Bookmarks are the clickable list of sections beside a PDF. Edit them here. Your original is never changed.",
  how: "Add a PDF, edit its bookmark list, then save.",
  accepts: "pdf",
  next: ["compress", "protect", "page-numbers", "organize", "watermark"],
  options(ctx) {
    const u = ui(ctx);
    const add = () => { u.rows.push({ title: `Bookmark ${u.rows.length + 1}`, page: 1, level: 0, key: u.next++ }); render(ctx); ctx.refresh(); u.list.querySelector<HTMLElement>("li:last-child .bm__title")?.focus(); };
    const quick = (label: string, id: string, on: () => void) => h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: label, attrs: { "data-testid": id }, on: { click: () => { on(); render(ctx); ctx.refresh(); } } });
    return h("div", { class: "bm" },
      u.note, u.list,
      h("div", { class: "bm__tools" },
        quick("Add bookmark", "bm-add", add),
        quick("One per page", "bm-each", () => { u.rows = Array.from({ length: u.pageCount }, (_, i) => ({ title: `Page ${i + 1}`, page: i + 1, level: 0, key: u.next++ })); }),
        quick("Clear all", "bm-clear", () => { u.rows = []; })));
  },
  sync(ctx) { if (ui(ctx).fileId !== ctx.file?.id) load(ctx).catch(() => undefined); },
  ready: (ctx) => !!ctx.file && ui(ctx).loaded && !bad(ctx),
  whyDisabled: (ctx) => (!ctx.file ? "Add a PDF first." : bad(ctx) ? `Page numbers must be between 1 and ${ui(ctx).pageCount}.` : "Reading the bookmarks."),
  primaryLabel: () => "Save bookmarks",
  async run(ctx) {
    const f = ctx.file!;
    const items = ui(ctx).rows.map(({ title, page, level }) => ({ title, page, level }));
    const r = await ctx.call<OpResult>("setOutline", { file: ctx.input(f), items, o: { producerCredit: ctx.producerCredit } });
    return [{ ...r, name: `${base(f.name)}-bookmarks.pdf` }];
  },
};
