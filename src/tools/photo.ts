import type { ToolDef } from "./types";

/** Planned: add `run` (and `options`) to make it live. The registry and the home tile need no change. */
export const photo: ToolDef = {
  id: "photo", title: "Photo clean", group: "Privacy",
  blurb: "Strip location and details.",
  lede: "Remove location and camera details from photos, and blur parts.",
  accepts: "images",
};
