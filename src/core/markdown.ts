// PDF text lines to Markdown: headings (grouping from core/docx), paragraphs and bullet or numbered lists. Pure.
import { toParas, type Line } from "./docx";

const ITEM = /^\s*(?:([•●▪◦‣·*–-])|(\d{1,3})[.)])\s+/;
/** Escapes what Markdown would read as formatting. */
export const mdEscape = (s: string) =>
  s.replace(/[\\`*_[\]<>|]/g, "\\$&").replace(/^(#{1,6})(\s)/, "\\$1$2").replace(/^(\d+)([.)])/, "$1\\$2");

/** Markdown for one page's lines. Each list item starts its own group, so flowing text never merges two items. */
export function pageMarkdown(lines: readonly Line[]): string {
  const groups: Line[][] = [];
  for (const l of lines) {
    if (ITEM.test(l.runs.map((r) => r.text).join("")) || !groups.length) groups.push([l]); else groups[groups.length - 1].push(l);
  }
  const out: string[] = [];
  let list = "";
  for (const g of groups) for (const p of toParas(g, true)) {
    const text = p.runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
    const m = ITEM.exec(text);
    if (m && !p.heading) {
      const kind = m[2] ? "n" : "b";
      out.push((list === kind ? "" : "\n") + (m[2] ? `${m[2]}. ` : "- ") + mdEscape(text.slice(m[0].length)));
      list = kind;
    } else {
      out.push((p.heading ? `\n${"#".repeat(p.heading)} ` : "\n") + mdEscape(text));
      list = "";
    }
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
}
