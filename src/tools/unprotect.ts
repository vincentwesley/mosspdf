import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const unprotect: ToolDef = {
  id: "unprotect", title: "Remove password", group: "Protect",
  blurb: "Unlock a PDF you have the password for.",
  lede: "Remove the password from a PDF you can already open.",
  accepts: "pdf",
};
