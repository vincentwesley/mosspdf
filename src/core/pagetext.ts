// Plain text of a document from pdf.js text items: one string per page, then the .txt file with page separators. Pure.
export interface StrItem { str: string; hasEOL?: boolean }

/** Joins the items of one page; `hasEOL` ends a line. Trailing blanks are trimmed. */
export const pageText = (items: readonly StrItem[]): string =>
  items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join("").replace(/[ \t]+\n/g, "\n").trim();

/** "--- Page 1 ---" blocks, in order. Pages without text keep their separator and stay empty. */
export const joinPages = (pages: readonly string[]): string => pages.map((t, i) => `--- Page ${i + 1} ---\n${t}\n`).join("\n");
