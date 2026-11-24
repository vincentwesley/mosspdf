// Every tool, in home order. Home, palette and routing use only this light list (D25); the code of each tool loads in `tools/all.ts`
// (one chunk), which main.ts preloads before the seal. Adding a tool: create src/tools/<id>.ts exporting a ToolDef, import it in all.ts,
// and add its row here (tests/tools-meta.test.ts checks the rows match).
import { GROUPS, type GroupName, type ToolDef } from "./types";

export type ToolMeta = Pick<ToolDef, "id" | "title" | "blurb" | "group" | "next">;

export const TOOLS: ToolMeta[] = [
  { id: "wf-email", title: "Small enough to email", blurb: "Shrink a PDF to fit an email.", group: "Workflows", next: ["protect", "sign"] },
  { id: "wf-share", title: "Clean copy to share", blurb: "Clean a PDF before you send it.", group: "Workflows", next: ["compress", "protect"] },
  { id: "wf-custom", title: "My workflows", blurb: "Chain your own steps and reuse them.", group: "Workflows" },
  { id: "wf-apply", title: "Job application pack", blurb: "Join your documents into one numbered PDF.", group: "Workflows", next: ["compress", "protect", "sign"] },
  { id: "merge", title: "Merge", blurb: "Combine PDFs into one.", group: "Organize", next: ["sign", "compress", "protect", "page-numbers", "watermark"] },
  { id: "split", title: "Split", blurb: "Cut a PDF into parts.", group: "Organize" },
  { id: "organize", title: "Organize pages", blurb: "Reorder, rotate, delete.", group: "Organize", next: ["compress", "protect", "page-numbers", "watermark", "sign"] },
  { id: "extract", title: "Extract pages", blurb: "Keep only the pages you pick.", group: "Organize", next: ["organize", "compress", "protect", "merge"] },
  { id: "images-to-pdf", title: "Images to PDF", blurb: "Turn JPG, PNG or WebP pictures into one PDF.", group: "Convert", next: ["sign", "compress", "protect", "page-numbers", "watermark"] },
  { id: "pdf-to-images", title: "PDF to images", blurb: "Save each page as a picture.", group: "Convert" },
  { id: "compress", title: "Compress", blurb: "Make a PDF smaller.", group: "Convert", next: ["protect", "sign", "watermark", "page-numbers", "organize"] },
  { id: "page-numbers", title: "Page numbers and headers", blurb: "Number pages, add a header or footer.", group: "Edit", next: ["compress", "protect", "watermark", "sign"] },
  { id: "watermark", title: "Watermark", blurb: "Stamp text on every page.", group: "Edit", next: ["compress", "protect", "sign"] },
  { id: "metadata", title: "Metadata", blurb: "Edit title, author and details.", group: "Edit", next: ["compress", "protect"] },
  { id: "protect", title: "Add password", blurb: "Lock a PDF with a password.", group: "Protect", next: [] },
  { id: "unprotect", title: "Remove password", blurb: "Unlock a PDF you have the password for.", group: "Protect", next: ["compress", "organize", "sign", "page-numbers", "watermark"] },
  { id: "safety-scan", title: "Safety scan", blurb: "Check a PDF for risky parts.", group: "Protect", next: ["compress", "protect", "sign"] },
  { id: "repair", title: "Repair", blurb: "Fix a damaged PDF.", group: "Protect", next: ["compress", "organize", "ocr", "protect", "page-numbers"] },
  { id: "fill", title: "Fill forms", blurb: "Fill in a PDF form.", group: "Fill and sign", next: ["sign", "flatten", "compress", "protect"] },
  { id: "sign", title: "Sign", blurb: "Add your signature.", group: "Fill and sign", next: ["flatten", "compress", "protect"] },
  { id: "ocr", title: "OCR", blurb: "Make scans searchable.", group: "OCR", next: ["compress", "redact", "protect"] },
  { id: "redact", title: "Redact", blurb: "Remove text, not just cover it.", group: "Privacy", next: ["compress", "protect", "watermark"] },
  { id: "photo", title: "Photo clean", blurb: "Strip location and details.", group: "Privacy" },
  { id: "compare", title: "Compare", blurb: "Spot what changed.", group: "Compare", next: [] },
  { id: "a11y-check", title: "Accessibility check", blurb: "Basic check of screen-reader signals in a PDF.", group: "Edit" },
  { id: "edit", title: "Edit PDF", blurb: "Add text, highlights and shapes.", group: "Edit", next: ["sign", "compress", "protect"] },
  { id: "rotate", title: "Rotate PDF", blurb: "Turn pages the right way up.", group: "Organize", next: ["organize", "compress", "page-numbers", "watermark", "protect"] },
  { id: "crop", title: "Crop PDF", blurb: "Trim the edges of pages.", group: "Edit", next: ["compress", "redact", "page-numbers", "watermark", "protect"] },
  { id: "flatten", title: "Flatten PDF", blurb: "Lock form fields and notes into the page.", group: "Edit", next: ["compress", "protect", "sign", "page-numbers", "watermark"] },
  { id: "remove-blank", title: "Remove blank pages", blurb: "Drop empty pages from a scan or export.", group: "Organize", next: ["organize", "compress", "ocr", "page-numbers", "protect"] },
  { id: "nup", title: "Pages per sheet", blurb: "Put 2 or 4 pages on each sheet, or make a booklet.", group: "Organize", next: ["compress", "protect"] },
  { id: "add-pages", title: "Add blank pages", blurb: "Insert empty pages where you need them.", group: "Organize", next: ["organize", "page-numbers", "compress", "protect"] },
  { id: "bookmarks", title: "Bookmarks", blurb: "Add, rename or remove the bookmarks list.", group: "Edit", next: ["compress", "protect", "page-numbers", "organize", "watermark"] },
  { id: "extract-images", title: "Extract images", blurb: "Save the pictures inside a PDF.", group: "Convert", next: [] },
  { id: "pdf-to-text", title: "PDF to text", blurb: "Copy out all the text.", group: "Convert", next: [] },
  { id: "pdf-to-word", title: "PDF to Word", blurb: "Turn the text into an editable .docx.", group: "Convert", next: [] },
  { id: "pdf-to-ppt", title: "PDF to PowerPoint", blurb: "Each page becomes a slide.", group: "Convert", next: [] },
  { id: "pdf-to-markdown", title: "PDF to Markdown", blurb: "Text, headings and lists as Markdown.", group: "Convert", next: [] },
  { id: "pdf-to-excel", title: "PDF to Excel", blurb: "Pull tables out into a spreadsheet.", group: "Convert", next: [] },
];

export const toolById = (id: string): ToolMeta | undefined => TOOLS.find((t) => t.id === id);
/** Home map: every group that has a tool, in GROUPS order. */
export const CATALOG: { name: GroupName; tools: ToolMeta[] }[] = GROUPS.map((name) => ({ name, tools: TOOLS.filter((t) => t.group === name) })).filter((g) => g.tools.length);

const DEFAULT_NEXT = ["compress", "protect", "page-numbers", "watermark", "organize"];
/** Tools to suggest after `tool` produced a PDF (its `next` list, else the default), never the tool itself. */
export const nextTools = (tool: ToolMeta): ToolMeta[] =>
  (tool.next ?? DEFAULT_NEXT).filter((id) => id !== tool.id).map(toolById).filter((t): t is ToolMeta => !!t).slice(0, 5);
