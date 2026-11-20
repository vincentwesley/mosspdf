import type { Metadata } from "../ops/metadata";
import type { OpResult } from "../ops/types";
import type { CleanResult } from "../ops/types-m3";
import { runChain, withSuffix } from "../core/workflows";
import { isSafeLink } from "../core/links";
import { h } from "../ui/dom";
import { checkField } from "../ui/fields";
import { stepList } from "../ui/steplist";
import { pdfLossWarnings } from "./pages";
import { TITLE } from "./safety-scan";
import type { Ctx, ToolDef } from "./types";

const DETAILS: [keyof Metadata, string][] = [["title", "title"], ["author", "author"], ["subject", "subject"], ["keywords", "keywords"], ["creator", "program that made it"], ["producer", "program that saved it"], ["created", "creation date"], ["modified", "change date"]];

const ui = (ctx: Ctx) => ctx.local(() => ({
  links: checkField({ id: "wf-links", label: "Keep web and email links", checked: true, testid: "wf-keep-links", onChange: () => ctx.refresh() }),
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
    let flagged = 0;
    const warnings: OpResult["warnings"] = [];
    u.steps.reset();
    const out = await runChain([
      { label: "clean", async run(cur) {
        const r = await ctx.call<CleanResult>("cleanCopy", { file: cur, c: { keepLinks, scrubPersonal: true }, o: { producerCredit: false } });
        const n = new Map<string, number>();
        for (const i of r.removed) n.set(TITLE[i.kind], (n.get(TITLE[i.kind]) ?? 0) + 1);
        removed += r.removed.length;
        warnings.push(...r.warnings);
        flagged = r.warnings.some((w) => w.code === "residual-risk") ? r.remaining.filter((i) => i.severity !== "info" && !(keepLinks && i.kind === "uri" && isSafeLink(i.detail))).length : 0;
        const list = [...n].map(([k, c]) => `${c} × ${k}`);
        const gone = list.length ? `Removed: ${list.join(", ")}.` : "Nothing risky was found.";
        return { file: r, detail: flagged ? `${gone} Still contains ${flagged} flagged ${flagged === 1 ? "item" : "items"}: do not treat it as clean.` : gone };
      } },
      { label: "details", async run(cur) {
        const m = await ctx.call<Metadata>("readMetadata", { file: cur });
        const had = DETAILS.filter(([k]) => m[k]).map(([, l]) => l);
        const r = await ctx.call<OpResult>("writeMetadata", { file: cur, edit: { removeAll: true }, o: { producerCredit: false } });
        removed += had.length;
        return { file: r, detail: had.length ? `Removed: ${had.join(", ")}.` : "No details were stored." };
      } },
    ], ctx.input(f), u.steps.on, ctx.o.signal);
    u.sum = flagged ? "Still contains flagged items. Do not treat this file as clean." : removed ? "Removed what is listed in the steps above." : "Nothing needed removing.";
    return [{ bytes: out.bytes, name: withSuffix(f.name, "-safe"), warnings }];
  },
};
