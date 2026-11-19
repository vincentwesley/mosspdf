import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const compress: ToolDef = {
  id: "compress", title: "Compress", group: "Convert",
  blurb: "Make a PDF smaller.",
  lede: "Shrink a PDF so it is easier to send.",
  accepts: "pdf",
};
