import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const pdfToImages: ToolDef = {
  id: "pdf-to-images", title: "PDF to images", group: "Convert",
  blurb: "Save each page as a picture.",
  lede: "Turn the pages of a PDF into PNG or JPG pictures.",
  accepts: "pdf",
};
