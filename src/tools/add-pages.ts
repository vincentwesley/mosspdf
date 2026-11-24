import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { numberField, radioGroup } from "../ui/fields";
import { base } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  where: radioGroup({
    name: "ap-where", legend: "Where", value: "end", testid: (v) => `ap-${v}`, onChange: () => ctx.refresh(),
    options: [["start", "Before first page"], ["end", "After last page"], ["every", "After every page"], ["after", "After page number"]],
  }),
  page: numberField({ id: "ap-page", label: "Page number", value: 1, min: 1, step: 1, testid: "ap-page", reserve: true, onInput: () => ctx.refresh() }),
  count: numberField({ id: "ap-count", label: "Blank pages at each place (1 to 10)", hint: "Each blank page is the size of the page next to it.", value: 1, min: 1, max: 10, step: 1, testid: "ap-count", reserve: true, onInput: () => ctx.refresh() }),
}));

const plan = (ctx: Ctx) => {
  const u = ui(ctx);
  const where = u.where.value();
  const n = ctx.file?.info?.pageCount ?? 0;
  const count = Number(u.count.input.value);
  const page = Number(u.page.input.value);
  return { where, n, count, page, countOk: Number.isInteger(count) && count >= 1 && count <= 10, pageOk: where !== "after" || (Number.isInteger(page) && page >= 1 && (!n || page <= n)) };
};

export const addPages: ToolDef = {
  id: "add-pages", title: "Add blank pages", group: "Organize",
  blurb: "Insert empty pages where you need them.",
  lede: "Put blank pages at the start, the end, after every page or after one page. Bookmarks and links stay. Your original is never changed.",
  how: "Add a PDF, choose where the blank pages go, then save.",
  accepts: "pdf", batch: true,
  next: ["organize", "page-numbers", "compress", "protect"],
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "addpages" }, u.where.el, u.page.el, u.count.el);
  },
  sync(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    u.page.el.hidden = p.where !== "after";
    u.page.input.max = p.n ? String(p.n) : "";
    u.page.setError(p.pageOk ? null : p.n ? `Type a page from 1 to ${p.n}.` : "Type a page number.");
    u.count.setError(p.countOk ? null : "Use a whole number from 1 to 10.");
  },
  ready: (ctx) => { const p = plan(ctx); return !!ctx.file && p.countOk && p.pageOk; },
  whyDisabled: (ctx) => (ctx.file ? "Check the numbers above." : "Add a PDF first."),
  primaryLabel: () => "Add blank pages",
  async run(ctx) {
    const p = plan(ctx);
    const f = ctx.file!;
    const options = { where: p.where, page: p.where === "after" ? p.page : undefined, count: p.count };
    const r = await ctx.call<OpResult>("addBlankPages", { file: ctx.input(f), options, o: { producerCredit: ctx.producerCredit } });
    return [{ ...r, name: `${base(f.name)}-with-blanks.pdf` }];
  },
};
