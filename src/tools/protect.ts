import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const protect: ToolDef = {
  id: "protect", title: "Add password", group: "Protect",
  blurb: "Lock a PDF with a password.",
  lede: "Lock a PDF so it needs a password to open.",
  accepts: "pdf",
};
