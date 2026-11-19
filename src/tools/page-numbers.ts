import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const pageNumbers: ToolDef = {
  id: "page-numbers", title: "Page numbers", group: "Edit",
  blurb: "Number the pages.",
  lede: "Add page numbers to a PDF.",
  accepts: "pdf",
};
