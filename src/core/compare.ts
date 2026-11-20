// Compare two documents: word diff over the whole text (so inserted and deleted pages fall out of it), a page alignment from a diff of
// the page texts, and the wording of the summary, the change list and the saved files. Pure: no DOM, no pdf.js.
import { diffSeq, wordKey } from "./diff";
import type { Word } from "./pagewords";

export interface Opts { ignoreCase: boolean; ignorePunct: boolean }
/** Words [from, to) of one page (0-based). */
export interface Span { page: number; from: number; to: number }
export interface Side {
  spans: Span[];
  /** 0-based first and last page it touches. */
  pages: [number, number];
  text: string;
}
export interface Change {
  /** 1-based, in reading order. */
  n: number;
  kind: "removed" | "added" | "changed";
  /** In the Original. */
  a?: Side;
  /** In the Changed. */
  b?: Side;
}
export interface PageAlign { a: number | null; b: number | null }
export interface Comparison {
  changes: Change[];
  /** Original page <-> Changed page, in order. A page with no partner has null on the other side. */
  align: PageAlign[];
  pagesA: number;
  pagesB: number;
  wordsA: number;
  wordsB: number;
  /** Too long for a word by word diff: the changes are whole pages. */
  coarse: boolean;
  /** Distinct pages (either side) carrying a change. */
  changedPages: number;
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const clip = (s: string, max = 400) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

function flat(pages: Word[][], o: Opts) {
  const keys: string[] = [], at: { page: number; idx: number; text: string }[] = [];
  pages.forEach((words, page) => words.forEach((w, idx) => {
    const k = wordKey(w.text, o);
    if (k) { keys.push(k); at.push({ page, idx, text: w.text }); }
  }));
  return { keys, at };
}

/** Pairs the pages of both sides: pages with the same text first, then the rest in order. */
export function alignPages(a: readonly string[], b: readonly string[]): PageAlign[] {
  const hunks = diffSeq(a, b) ?? [{ a0: 0, a1: a.length, b0: 0, b1: b.length }];
  const out: PageAlign[] = [];
  let i = 0, j = 0;
  const same = (until: number) => { while (i < until) out.push({ a: i++, b: j++ }); };
  for (const h of hunks) {
    same(h.a0);
    const both = Math.min(h.a1 - h.a0, h.b1 - h.b0);
    for (let k = 0; k < both; k++) out.push({ a: i++, b: j++ });
    while (i < h.a1) out.push({ a: i++, b: null });
    while (j < h.b1) out.push({ a: null, b: j++ });
  }
  same(a.length);
  return out;
}

export function compare(pa: Word[][], pb: Word[][], o: Opts): Comparison {
  const A = flat(pa, o), B = flat(pb, o);
  const pageKey = (p: Word[]) => p.map((w) => wordKey(w.text, o)).filter(Boolean).join(" ");
  const ka = pa.map(pageKey), kb = pb.map(pageKey);
  const align = alignPages(ka, kb);
  const base = { align, pagesA: pa.length, pagesB: pb.length, wordsA: A.keys.length, wordsB: B.keys.length };
  const hunks = diffSeq(A.keys, B.keys);
  if (!hunks) {
    const diff = align.filter((p) => p.a === null || p.b === null || ka[p.a] !== kb[p.b]);
    const changes = diff.map((p, i): Change => {
      const side = (n: number | null): Side | undefined => (n === null ? undefined : { spans: [], pages: [n, n], text: "" });
      return { n: i + 1, kind: p.a === null ? "added" : p.b === null ? "removed" : "changed", a: side(p.a), b: side(p.b) };
    });
    return { ...base, changes, coarse: true, changedPages: diff.length };
  }
  const side = (f: ReturnType<typeof flat>, from: number, to: number): Side | undefined => {
    if (from >= to) return undefined;
    const spans: Span[] = [];
    for (const w of f.at.slice(from, to)) {
      const s = spans.at(-1);
      if (s && s.page === w.page && s.to === w.idx) s.to++;
      else spans.push({ page: w.page, from: w.idx, to: w.idx + 1 });
    }
    return { spans, pages: [spans[0].page, spans.at(-1)!.page], text: f.at.slice(from, to).map((w) => w.text).join(" ") };
  };
  const changes = hunks.map((h, i): Change => ({
    n: i + 1,
    kind: h.a0 === h.a1 ? "added" : h.b0 === h.b1 ? "removed" : "changed",
    a: side(A, h.a0, h.a1),
    b: side(B, h.b0, h.b1),
  }));
  const pages = new Set<number>();
  // a change spanning pages touches each of them
  for (const c of changes) for (const s of [c.a, c.b]) if (s) for (let p = s.pages[0]; p <= s.pages[1]; p++) pages.add(p);
  return { ...base, changes, coarse: false, changedPages: pages.size };
}

const pg = (s: Side) => (s.pages[0] === s.pages[1] ? `page ${s.pages[0] + 1}` : `pages ${s.pages[0] + 1}-${s.pages[1] + 1}`);
export function changeLabel(c: Change): string {
  return [c.a && `Original ${pg(c.a)}`, c.b && `Changed ${pg(c.b)}`].filter(Boolean).join(", ");
}

/** "12 changes on 3 pages" or "No text differences found", with the pixel note when the text is the same. */
export function summaryLine(c: Comparison, pixelPages = 0): string {
  if (c.changes.length) return `${plural(c.changes.length, "change")} on ${plural(c.changedPages, "page")}`;
  return pixelPages ? `No text differences found. The text is the same, but ${plural(pixelPages, "page")} look${pixelPages === 1 ? "s" : ""} different.` : "No text differences found";
}

/** Things worth saying next to the summary. */
export function notes(c: Comparison): string[] {
  const out: string[] = [];
  if (c.pagesA !== c.pagesB) out.push(`The Original has ${plural(c.pagesA, "page")} and the Changed has ${plural(c.pagesB, "page")}. Pages are matched by their text first.`);
  if (c.coarse) out.push("These documents are too long to compare word by word, so the changes shown are whole pages.");
  return out;
}

export interface ReportData {
  nameA: string;
  nameB: string;
  /** YYYY-MM-DD. */
  date: string;
  summary: string;
  notes: string[];
  changes: { label: string; removed?: string; added?: string }[];
}
export function reportData(c: Comparison, nameA: string, nameB: string, date: string, pixelPages: number, extra: string[] = []): ReportData {
  return {
    nameA, nameB, date, summary: summaryLine(c, pixelPages), notes: [...notes(c), ...extra],
    changes: c.changes.map((x) => ({ label: `Change ${x.n}: ${changeLabel(x)}`, removed: x.a?.text && clip(x.a.text, 1000), added: x.b?.text && clip(x.b.text, 1000) })),
  };
}

/** The same report as plain text (UTF-8). */
export function reportText(r: ReportData): string {
  const lines = ["Pagehold comparison", `Original: ${r.nameA}`, `Changed: ${r.nameB}`, `Date: ${r.date}`, "", r.summary, ...r.notes.map((n) => `Note: ${n}`)];
  for (const c of r.changes) lines.push("", c.label, ...(c.removed ? [`  Removed: ${c.removed}`] : []), ...(c.added ? [`  Added: ${c.added}`] : []));
  return lines.join("\n") + "\n";
}
