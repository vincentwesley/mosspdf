import type { OpResult } from "../ops/types";
import { store } from "../core/store";
import { radioGroup } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  size: radioGroup({ name: "size", legend: "Which pictures", value: "all", testid: (v) => `size-${v}`, onChange: () => ctx.refresh(), options: [["all", "All pictures", "Every picture in the file."], ["big", "Skip tiny ones (under 64 px)", "Leaves out icons, bullets and lines."]] }),
}));

export const extractImagesTool: ToolDef = {
  id: "extract-images", title: "Extract images", heading: "Save the pictures inside a PDF", group: "Convert",
  blurb: "Save the pictures inside a PDF.",
  lede: "Save the pictures inside a PDF as they are. Several pictures come as one .zip. To save whole pages as pictures, use PDF to images.",
  how: "Add a PDF, then save the pictures inside it.",
  accepts: "pdf", batch: true,
  zipSuffix: "images",
  next: [],
  options: (ctx) => ui(ctx).size.el,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Save pictures",
  async run(ctx): Promise<OpResult[]> {
    const f = ctx.file!;
    const r = await ctx.call<OpResult[]>("extractImages", { file: ctx.input(f), options: { skipTiny: ui(ctx).size.value() === "big" }, o: { producerCredit: ctx.producerCredit } });
    // Several files in one zip: picture names start with their file's name so they never clash.
    return store.files.filter((x) => x.kind === "pdf").length > 1 ? r.map((x) => ({ ...x, name: `${f.name.replace(/\.pdf$/i, "")}-${x.name}` })) : r;
  },
};
