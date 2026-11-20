import type { Metadata } from "../ops/metadata";
import type { OpResult } from "../ops/types";
import type { CleanResult } from "../ops/types-m3";
import { runChain, withSuffix } from "../core/workflows";
import { h } from "../ui/dom";
import { checkField } from "../ui/fields";
import { stepList } from "../ui/steplist";
import { pdfLossWarnings } from "./pages";
import { TITLE } from "./safety-scan";
import type { Ctx, ToolDef } from "./types";

const DETAILS: [keyof Metadata, string][] = [["title", "title"], ["author", "author"], ["subject", "subject"], ["keywords", "keywords"], ["creator", "program that made it"], ["producer", "program that saved it"], ["created", "creation date"], ["modified", "change date"]];

const ui = (ctx: Ctx) => ctx.local(() => ({
  links: checkField({ id: "wf-links", label: "Keep web links", checked: true, testid: "wf-keep-links", onChange: () => ctx.refresh() }),
  steps: stepList(["Remove scripts, actions and attachments", "Strip the document details"]),
  sum: "",
}));

export const wfShare: ToolDef = {
  id: "wf-share", title: "Safe to share", group: "Workflows",
  blurb: "Clean a PDF before you send it.",
  lede: "Takes out scripts, actions and hidden attachments, then removes the title, author, dates and program names stored inside.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "wf" }, u.links.el, u.steps.el,
      h("p", { class: "field__hint", attrs: { "data-testid": "wf-redact-note" } }, "This does not hide anything written on the pages. To black out names or numbers, use ", h("a", { href: "#/redact", text: "Redact" }), " first."));
  },
  warnings: pdfLossWarnings,
  summary: (ctx) => ui(ctx).sum,
  primaryLabel: () => "Make it safe to share",
  async run(ctx) {
    const u = ui(ctx);
    const f = ctx.file!;
    const keepLinks = u.links.input.checked;
    let removed = 0;
    u.steps.reset();
    const out = await runChain([
      { label: "clean", async run(cur) {
        const r = await ctx.call<CleanResult>("cleanCopy", { file: cur, c: { keepLinks }, o: { producerCredit: false } });
        const n = new Map<string, number>();
        for (const i of r.removed) n.set(TITLE[i.kind], (n.get(TITLE[i.kind]) ?? 0) + 1);
        removed += r.removed.length;
        const list = [...n].map(([k, c]) => `${c} × ${k}`);
        return { file: r, detail: list.length ? `Removed: ${list.join(", ")}.` : "Nothing risky was found." };
      } },
      { label: "details", async run(cur) {
        const m = await ctx.call<Metadata>("readMetadata", { file: cur });
        const had = DETAILS.filter(([k]) => m[k]).map(([, l]) => l);
        const r = await ctx.call<OpResult>("writeMetadata", { file: cur, edit: { removeAll: true }, o: { producerCredit: false } });
        removed += had.length;
        return { file: r, detail: had.length ? `Removed: ${had.join(", ")}.` : "No details were stored." };
      } },
    ], ctx.input(f), u.steps.on, ctx.o.signal);
    u.sum = removed ? "Removed what is listed in the steps above." : "Nothing needed removing.";
    return [{ bytes: out.bytes, name: withSuffix(f.name, "-safe"), warnings: [] }];
  },
};
