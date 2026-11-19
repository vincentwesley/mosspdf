import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const safetyScan: ToolDef = {
  id: "safety-scan", title: "Safety scan", group: "Protect",
  blurb: "Check a PDF for risky parts.",
  lede: "Look for scripts, links and hidden parts, then save a cleaned copy.",
  accepts: "pdf",
};
