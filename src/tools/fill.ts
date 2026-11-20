import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const fill: ToolDef = {
  id: "fill", title: "Fill forms", group: "Fill and sign",
  blurb: "Fill in a PDF form.",
  lede: "Fill in the fields of a PDF form.",
  accepts: "pdf",
};
