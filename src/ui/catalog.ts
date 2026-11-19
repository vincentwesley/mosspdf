export interface ToolInfo { id: string; title: string; blurb: string; live: boolean }
export interface Group { name: string; tools: ToolInfo[] }

export const GROUPS: Group[] = [
  { name: "Organize", tools: [
    { id: "merge", title: "Merge", blurb: "Combine PDFs into one.", live: true },
    { id: "split", title: "Split", blurb: "Cut a PDF into parts.", live: true },
    { id: "organize", title: "Organize pages", blurb: "Reorder, rotate, delete.", live: true },
    { id: "extract", title: "Extract pages", blurb: "Keep only the pages you pick.", live: true },
  ] },
  { name: "Convert", tools: [{ id: "convert", title: "Convert", blurb: "Images and PDFs, both ways.", live: false }] },
  { name: "Edit", tools: [{ id: "edit", title: "Edit", blurb: "Page numbers, watermarks, details.", live: false }] },
  { name: "Fill and sign", tools: [{ id: "sign", title: "Fill and sign", blurb: "Forms and signatures.", live: false }] },
  { name: "Protect", tools: [{ id: "protect", title: "Protect", blurb: "Add or remove a password.", live: false }] },
  { name: "Privacy", tools: [
    { id: "redact", title: "Redact", blurb: "Remove text for good.", live: false },
    { id: "photo", title: "Photo clean", blurb: "Strip location and details.", live: false },
  ] },
  { name: "Compare", tools: [{ id: "compare", title: "Compare", blurb: "Spot what changed.", live: false }] },
  { name: "OCR", tools: [{ id: "ocr", title: "OCR", blurb: "Make scans searchable.", live: false }] },
];

export const LIVE = GROUPS.flatMap((g) => g.tools).filter((t) => t.live);
export const toolById = (id: string) => LIVE.find((t) => t.id === id);
