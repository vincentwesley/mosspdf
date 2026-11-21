import type { RepairResult } from "../ops/types-m3";
import { h, plural } from "../ui/dom";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({ box: h("div", { class: "repair", attrs: { "data-testid": "repair-report" } }), last: undefined as RepairResult | undefined, fileId: 0 }));

function show(ctx: Ctx) {
  const u = ui(ctx);
  const f = ctx.file;
  u.box.hidden = !f;
  const r = f && u.fileId === f.id ? u.last : undefined;
  if (!r) return void u.box.replaceChildren(h("p", { class: "field__hint", text: "Repair rebuilds the file's structure and keeps what can still be read. It cannot bring back content that is gone." }));
  u.box.replaceChildren(
    h("h3", { text: r.repaired ? "What MossPDF did" : "Result" }),
    h("ul", { class: "scan__list", attrs: { role: "list", "data-testid": "repair-actions" } }, ...r.actions.map((a) => h("li", { text: a }))),
    h("p", { text: `Pages in the repaired file: ${r.pagesAfter}.${r.pagesBefore ? ` The damaged original seems to have had about ${r.pagesBefore}.` : ""}`, attrs: { "data-testid": "repair-pages" } }),
    h("p", r.complete
      ? { class: "hs-banner hs-banner--ok", text: r.repaired ? `${plural(r.pagesAfter, "page")} recovered. Look through them before you rely on the file.` : "No damage found.", attrs: { role: "status" } }
      : { class: "hs-banner hs-banner--danger", text: "Some pages may be missing. Keep the original file and check every page of the repaired copy.", attrs: { role: "alert", "data-testid": "repair-incomplete" } }));
}

export const repair: ToolDef = {
  id: "repair", title: "Repair", heading: "Repair a PDF", group: "Protect",
  blurb: "Fix a damaged PDF.",
  lede: "Try to rescue a PDF that will not open properly.",
  accepts: "pdf", batch: true,
  options(ctx) { show(ctx); return ui(ctx).box; },
  sync: show,
  primaryLabel: () => "Repair",
  async run(ctx) {
    const u = ui(ctx);
    const r = await ctx.call<RepairResult>("repair", { file: ctx.input(ctx.file!), o: { producerCredit: ctx.producerCredit } });
    u.last = r;
    u.fileId = ctx.file!.id;
    return [r];
  },
};
