// Home "Find a tool" matching: every word typed must appear in the title, blurb or group name.
import type { ToolDef } from "../tools/types";

export const matchTool = (t: Pick<ToolDef, "title" | "blurb" | "group">, q: string): boolean => {
  const hay = `${t.title} ${t.blurb} ${t.group}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

const subseq = (s: string, w: string) => { let i = 0; for (const c of s) if (c === w[i] && ++i === w.length) return true; return false; };

/** Palette ranking: 0 = no match, higher is better. Every word must match somewhere: a title word start scores most, then the title,
 *  then blurb or group, then (words of 3+ letters) the letters in order inside the title ("cmpr" finds Compress). */
export const scoreTool = (t: Pick<ToolDef, "title" | "blurb" | "group">, q: string): number => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const title = t.title.toLowerCase();
  const rest = `${t.blurb} ${t.group}`.toLowerCase();
  let total = 1;
  for (const w of words) {
    const s = title.split(/\W+/).some((x) => x.startsWith(w)) ? 8 : title.includes(w) ? 5 : rest.includes(w) ? 2 : w.length >= 3 && subseq(title, w) ? 1 : 0;
    if (!s) return 0;
    total += s;
  }
  return total;
};
