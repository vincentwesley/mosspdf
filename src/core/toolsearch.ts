// Home "Find a tool" matching: every word typed must appear in the title, blurb or group name.
import type { ToolDef } from "../tools/types";

export const matchTool = (t: Pick<ToolDef, "title" | "blurb" | "group">, q: string): boolean => {
  const hay = `${t.title} ${t.blurb} ${t.group}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};
