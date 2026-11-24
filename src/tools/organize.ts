import { assemble, base, pdfLossWarnings } from "./pages";
import type { ToolDef } from "./types";

export const organize: ToolDef = {
  id: "organize", title: "Organize pages", group: "Organize",
  blurb: "Reorder, rotate, delete.",
  lede: "Reorder, rotate or delete pages, then save a new PDF.",
  how: "Add a PDF, then drag, rotate or delete pages and save the new file.",
  next: ["compress", "protect", "page-numbers", "watermark", "sign"],
  accepts: "pdf", grid: true,
  warnings: pdfLossWarnings,
  ready: (ctx) => ctx.items.length > 0,
  primaryLabel: () => "Save organized PDF",
  run: (ctx) => assemble(ctx, ctx.items, `${base(ctx.file!.name)}-organized.pdf`),
};
