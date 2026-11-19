import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const sign: ToolDef = {
  id: "sign", title: "Sign", group: "Fill and sign",
  blurb: "Add your signature.",
  lede: "Draw, type or upload a signature and place it on a page.",
  accepts: "pdf",
};
