import type { CompressResult } from "../ops/compress";
import type { OpResult } from "../ops/types";
import { runChain, withSuffix } from "../core/workflows";
import { fmtSize, h } from "../ui/dom";
import { selectField } from "../ui/fields";
import { stepList } from "../ui/steplist";
import type { Ctx, ToolDef } from "./types";

const LIMITS = [5, 10, 20, 25];

const ui = (ctx: Ctx) => ctx.local(() => ({
  limit: selectField({ id: "wf-limit", label: "Largest size your email takes", testid: "wf-limit", value: "10", options: LIMITS.map((n) => [String(n), `${n} MB`]), onInput: () => ctx.refresh() }),
  steps: stepList(["Shrink the pictures (strong)", "Check the size against your limit"]),
  sum: "",
}));

export const wfEmail: ToolDef = {
  id: "wf-email", title: "Small enough to email", group: "Workflows",
  blurb: "Shrink a PDF to fit an email.",
  lede: "Shrinks the pictures as far as it takes, then tells you plainly whether the file fits your limit.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "wf" }, u.limit.el, u.steps.el);
  },
  summary: (ctx) => ui(ctx).sum,
  primaryLabel: () => "Make it small",
  async run(ctx) {
    const u = ui(ctx);
    const f = ctx.file!;
    const limit = Number(u.limit.input.value);
    const warnings: OpResult["warnings"] = [];
    u.steps.reset();
    const out = await runChain([
      { label: "compress", async run(cur) {
        const r = await ctx.call<CompressResult>("compress", { file: cur, level: "strong", o: { producerCredit: ctx.producerCredit } });
        return { file: r, detail: r.warnings.some((w) => w.code === "not-smaller") ? "Already as small as it gets." : `${fmtSize(r.before)} to ${fmtSize(r.after)}` };
      } },
      { label: "check", async run(cur) {
        const over = cur.bytes.length > limit * 1024 * 1024;
        if (over) warnings.push({ code: "oversize", message: `This file is still ${fmtSize(cur.bytes.length)}, over your ${limit} MB limit. Strong compression is the most MossPDF does. Try Split (by size) to send it in parts, or share a link instead.` });
        return { file: cur, detail: over ? `${fmtSize(cur.bytes.length)}: still over ${limit} MB.` : `${fmtSize(cur.bytes.length)}: fits under ${limit} MB.` };
      } },
    ], ctx.input(f), u.steps.on, ctx.o.signal);
    u.sum = warnings.length ? `${fmtSize(f.size)} to ${fmtSize(out.bytes.length)}. Still over ${limit} MB.` : `${fmtSize(f.size)} to ${fmtSize(out.bytes.length)}. Fits under ${limit} MB.`;
    return [{ bytes: out.bytes, name: withSuffix(f.name, "-email"), warnings }];
  },
};
