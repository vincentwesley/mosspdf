import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const redact: ToolDef = {
  id: "redact", title: "Redact", group: "Privacy",
  blurb: "Remove text for good.",
  lede: "Black out text so it is gone from the file, not just hidden.",
  accepts: "pdf",
};
