import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const ocr: ToolDef = {
  id: "ocr", title: "OCR", group: "OCR",
  blurb: "Make scans searchable.",
  lede: "Turn a scanned PDF into one you can search and copy from.",
  accepts: "pdf",
};
