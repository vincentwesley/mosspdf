import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const compare: ToolDef = {
  id: "compare", title: "Compare", group: "Compare",
  blurb: "Spot what changed.",
  lede: "Put two versions of a PDF side by side and see what changed.",
  accepts: "pdf-pair",
};
