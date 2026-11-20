import type { CompressResult } from "../ops/compress";
import type { OpResult } from "../ops/types";
import { runChain } from "../core/workflows";
import { fmtSize, h } from "../ui/dom";
import { checkField } from "../ui/fields";
import { stepList } from "../ui/steplist";
import { pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  small: checkField({ id: "wf-small", label: "Also make the pack smaller (balanced)", testid: "wf-compress", onChange: () => ctx.refresh() }),
  steps: stepList(["Join the PDFs in the order listed", "Number the pages", "Make it smaller"]),
}));

export const wfApply: ToolDef = {
  id: "wf-apply", title: "Job application pack", group: "Workflows",
  blurb: "Join your documents into one numbered PDF.",
  lede: "Joins your PDFs in the order listed, numbers every page along the bottom, and can shrink the result.",
  accepts: "pdfs",
  dropTitle: "Drop your PDFs here",
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "wf" },
      h("p", { class: "field__hint", attrs: { "data-testid": "wf-photos-note" } }, "Have photos or scans as pictures? Turn them into a PDF first with ", h("a", { href: "#/images-to-pdf", text: "Images to PDF" }), ", then add that PDF here."),
      u.small.el, u.steps.el);
  },
  warnings: pdfLossWarnings,
  primaryLabel: () => "Make the pack",
  async run(ctx) {
    const u = ui(ctx);
    const shrink = u.small.input.checked;
    const o = { producerCredit: ctx.producerCredit };
    u.steps.reset();
    const out = await runChain([
      { label: "merge", async run() {
        const r = await ctx.call<OpResult>("merge", { files: ctx.files.map(ctx.input), o });
        return { file: r, detail: `${ctx.files.length} ${ctx.files.length === 1 ? "file" : "files"} joined.` };
      } },
      { label: "numbers", async run(cur) {
        const r = await ctx.call<OpResult>("addPageNumbers", { file: cur, options: { position: "bottom-center", format: "Page {n} of {total}", startAt: 1, fontSize: 11 }, o });
        return { file: r, detail: "Numbered along the bottom, like Page 1 of 7." };
      } },
      { label: "compress", async run(cur) {
        if (!shrink) return { file: cur, detail: "Skipped: you did not ask for it." };
        const r = await ctx.call<CompressResult>("compress", { file: cur, level: "balanced", o });
        return { file: r, detail: r.warnings.some((w) => w.code === "not-smaller") ? "Already compact." : `${fmtSize(r.before)} to ${fmtSize(r.after)}` };
      } },
    ], { name: "", bytes: new Uint8Array(0) }, u.steps.on, ctx.o.signal);
    return [{ bytes: out.bytes, name: "application-pack.pdf", warnings: [] }];
  },
};
