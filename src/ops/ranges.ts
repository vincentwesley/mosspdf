import { PdfError } from "./types";

const bad = (m: string) => new PdfError("unsupported", m);

/** "1-3, 5, 8-" -> [[0,1,2],[4],[7,...]] (0-based, one group per comma part). */
export function parseRanges(input: string, pageCount: number): number[][] {
  const parts = input
    .replace(/[–—]/g, "-")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw bad('Type the pages you want, for example "1-3, 5, 8-".');
  const page = (s: string, whole: string) => {
    if (!/^\d+$/.test(s)) throw bad(`"${whole}" isn't a page range. Use numbers like 3 or 2-5, separated by commas.`);
    const n = Number(s);
    if (n < 1) throw bad("Page numbers start at 1. Change the number and try again.");
    if (n > pageCount) throw bad(`Page ${n} doesn't exist. This file has ${pageCount} page${pageCount === 1 ? "" : "s"}. Pick a page that is in the file.`);
    return n;
  };
  return parts.map((p) => {
    const m = /^(\d+)\s*(?:(-)\s*(\d*))?$/.exec(p);
    if (!m) throw bad(`"${p}" isn't a page range. Use numbers like 3 or 2-5, separated by commas.`);
    const from = page(m[1], p);
    const to = m[2] ? (m[3] ? page(m[3], p) : pageCount) : from;
    if (to < from) throw bad(`"${p}" goes backwards. Write it as ${to}-${from} and try again.`);
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  });
}
