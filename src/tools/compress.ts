import type { CompressLevel, CompressResult } from "../ops/compress";
import { announce, h } from "../ui/dom";
import { radioGroup } from "../ui/fields";
import { pdfLossWarnings } from "./pages";
import type { Ctx, ToolDef } from "./types";

const LEVELS: Record<CompressLevel, [label: string, about: string]> = {
  light: ["Light", "Tidies the file's structure. Pictures stay exactly as they are. Safest, smallest saving."],
  balanced: ["Balanced", "Also shrinks large pictures a little. Text stays sharp. Good for email."],
  strong: ["Strong", "Shrinks pictures a lot. Smallest file, but photos look softer."],
};

const ui = (ctx: Ctx) => ctx.local(() => ({
  level: radioGroup({ name: "level", legend: "How much to shrink it", value: "balanced", testid: (v) => `level-${v}`, onChange: () => ctx.refresh(), options: (Object.keys(LEVELS) as CompressLevel[]).map((k) => [k, LEVELS[k][0]]) }),
  about: h("p", { class: "field__hint", attrs: { "data-testid": "level-about" } }),
}));

export const compress: ToolDef = {
  id: "compress", title: "Compress", heading: "Compress a PDF", group: "Convert",
  blurb: "Make a PDF smaller.",
  lede: "Make a PDF smaller so it is easier to email or upload. Pictures are the part that shrinks.",
  accepts: "pdf", batch: true,
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "compress" }, u.level.el, u.about);
  },
  sync(ctx) {
    const u = ui(ctx);
    u.about.textContent = LEVELS[u.level.value() as CompressLevel][1];
  },
  warnings: pdfLossWarnings,
  primaryLabel: () => "Compress PDF",
  async run(ctx) {
    const u = ui(ctx);
    const f = ctx.file!;
    const r = await ctx.call<CompressResult>("compress", { file: ctx.input(f), level: u.level.value(), o: { producerCredit: ctx.producerCredit } });
    const notSmaller = r.warnings.some((w) => w.code === "not-smaller");
    const { before, after, ...out } = r;
    void before; void after;
    out.warnings = out.warnings.map((w) => (w.code === "not-smaller" ? { ...w, message: "This file is already compact, so it cannot be made smaller. Here is your original, unchanged." } : w));
    if (!notSmaller) announce(`Smaller by ${Math.round(((r.before - r.after) / r.before) * 100)} percent.`);
    return [out];
  },
};
