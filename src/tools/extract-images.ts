import type { OpResult } from "../ops/types";
import { radioGroup } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => ({
  size: radioGroup({ name: "size", legend: "Which pictures", value: "all", testid: (v) => `size-${v}`, onChange: () => ctx.refresh(), options: [["all", "All pictures", "Every picture in the file."], ["big", "Skip tiny ones (under 64 px)", "Leaves out icons, bullets and lines."]] }),
}));

export const extractImagesTool: ToolDef = {
  id: "extract-images", title: "Extract images", heading: "Save the pictures inside a PDF", group: "Convert",
  blurb: "Save the pictures inside a PDF.",
  lede: "Save the pictures inside a PDF as they are. Several pictures come as one .zip. To save whole pages as pictures, use PDF to images.",
  accepts: "pdf",
  zipSuffix: "images",
  next: [],
  options: (ctx) => ui(ctx).size.el,
  whyDisabled: () => "Add a PDF first.",
  primaryLabel: () => "Save pictures",
  run: (ctx): Promise<OpResult[]> => ctx.call<OpResult[]>("extractImages", { file: ctx.input(ctx.file!), options: { skipTiny: ui(ctx).size.value() === "big" }, o: { producerCredit: ctx.producerCredit } }),
};
