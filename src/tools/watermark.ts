import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const watermark: ToolDef = {
  id: "watermark", title: "Watermark", group: "Edit",
  blurb: "Stamp text on every page.",
  lede: "Put a text watermark on every page.",
  accepts: "pdf",
};
