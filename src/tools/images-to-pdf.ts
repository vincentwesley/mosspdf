import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const imagesToPdf: ToolDef = {
  id: "images-to-pdf", title: "Images to PDF", group: "Convert",
  blurb: "Turn JPG, PNG or WebP pictures into one PDF.",
  lede: "Put your pictures in order, then save them as one PDF.",
  accepts: "images",
};
