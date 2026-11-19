import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const metadata: ToolDef = {
  id: "metadata", title: "Metadata", group: "Edit",
  blurb: "Edit title, author and details.",
  lede: "See and change the details stored inside a PDF.",
  accepts: "pdf",
};
