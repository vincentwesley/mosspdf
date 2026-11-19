import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const repair: ToolDef = {
  id: "repair", title: "Repair", group: "Protect",
  blurb: "Fix a damaged PDF.",
  lede: "Try to rescue a PDF that will not open properly.",
  accepts: "pdf",
};
