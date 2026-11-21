// Every tool, in home order. Home, palette and routing use only this light list (D25); the code of each tool loads in `tools/all.ts`
// (one chunk), which main.ts preloads before the seal. Adding a tool: create src/tools/<id>.ts exporting a ToolDef, import it in all.ts,
// and add its row here (tests/tools-meta.test.ts checks the rows match).
import { GROUPS, type GroupName, type ToolDef } from "./types";

export type ToolMeta = Pick<ToolDef, "id" | "title" | "blurb" | "group" | "next">;

export const TOOLS: ToolMeta[] = [
  { id: "wf-email", title: "Small enough to email", blurb: "Shrink a PDF to fit an email.", group: "Workflows" },
  { id: "wf-share", title: "Clean copy to share", blurb: "Clean a PDF before you send it.", group: "Workflows" },
  { id: "wf-apply", title: "Job application pack", blurb: "Join your documents into one numbered PDF.", group: "Workflows" },
  { id: "merge", title: "Merge", blurb: "Combine PDFs into one.", group: "Organize", next: ["sign", "compress", "protect", "page-numbers", "watermark"] },
  { id: "split", title: "Split", blurb: "Cut a PDF into parts.", group: "Organize" },
  { id: "organize", title: "Organize pages", blurb: "Reorder, rotate, delete.", group: "Organize" },
  { id: "extract", title: "Extract pages", blurb: "Keep only the pages you pick.", group: "Organize" },
  { id: "images-to-pdf", title: "Images to PDF", blurb: "Turn JPG, PNG or WebP pictures into one PDF.", group: "Convert" },
  { id: "pdf-to-images", title: "PDF to images", blurb: "Save each page as a picture.", group: "Convert" },
  { id: "compress", title: "Compress", blurb: "Make a PDF smaller.", group: "Convert" },
  { id: "page-numbers", title: "Page numbers", blurb: "Number the pages.", group: "Edit" },
  { id: "watermark", title: "Watermark", blurb: "Stamp text on every page.", group: "Edit" },
  { id: "metadata", title: "Metadata", blurb: "Edit title, author and details.", group: "Edit" },
  { id: "protect", title: "Add password", blurb: "Lock a PDF with a password.", group: "Protect" },
  { id: "unprotect", title: "Remove password", blurb: "Unlock a PDF you have the password for.", group: "Protect" },
  { id: "safety-scan", title: "Safety scan", blurb: "Check a PDF for risky parts.", group: "Protect" },
  { id: "repair", title: "Repair", blurb: "Fix a damaged PDF.", group: "Protect" },
  { id: "fill", title: "Fill forms", blurb: "Fill in a PDF form.", group: "Fill and sign" },
  { id: "sign", title: "Sign", blurb: "Add your signature.", group: "Fill and sign" },
  { id: "ocr", title: "OCR", blurb: "Make scans searchable.", group: "OCR" },
  { id: "redact", title: "Redact", blurb: "Remove text, not just cover it.", group: "Privacy" },
  { id: "photo", title: "Photo clean", blurb: "Strip location and details.", group: "Privacy" },
  { id: "compare", title: "Compare", blurb: "Spot what changed.", group: "Compare", next: [] },
  { id: "a11y-check", title: "Accessibility check", blurb: "Basic check of screen-reader signals in a PDF.", group: "Edit" },
];

export const toolById = (id: string): ToolMeta | undefined => TOOLS.find((t) => t.id === id);
/** Home map: every group that has a tool, in GROUPS order. */
export const CATALOG: { name: GroupName; tools: ToolMeta[] }[] = GROUPS.map((name) => ({ name, tools: TOOLS.filter((t) => t.group === name) })).filter((g) => g.tools.length);

const DEFAULT_NEXT = ["compress", "protect", "page-numbers", "watermark", "organize"];
/** Tools to suggest after `tool` produced a PDF (its `next` list, else the default), never the tool itself. */
export const nextTools = (tool: ToolMeta): ToolMeta[] =>
  (tool.next ?? DEFAULT_NEXT).filter((id) => id !== tool.id).map(toolById).filter((t): t is ToolMeta => !!t).slice(0, 5);
