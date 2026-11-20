// Words of one page with where they sit, from pdf.js text items. Pure (items in, words out) so it runs in Node tests too.
// Rects are PDF user space [x0, y0, x1, y1]; the viewer converts them with the page viewport.
export type Rect = [number, number, number, number];
export interface Word { text: string; rects: Rect[] }
/** The part of a pdf.js TextItem used here. */
export interface TextItemLike { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

interface Tok extends Word { eol: boolean }

/** Splits text items into words. Items that continue a word on the same line (kerning splits) are joined, and a word cut by a hyphen at
 *  the end of a line is joined with the next line's start ("exam-" + "ple" is "example"). Rotated text gets an upright box (ponytail: a
 *  highlight for vertical text is approximate). */
export function wordsFromItems(items: readonly TextItemLike[]): Word[] {
  const toks: Tok[] = [];
  let open: Tok | undefined; // the last word touched the end of its item: the next item may continue it
  let prevY = 0, prevH = 0, prevEnd = 0;
  for (const it of items) {
    const len = it.str.length;
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
    const x = it.transform[4], y = it.transform[5];
    const lineBreak = !!prevH && Math.abs(y - prevY) > Math.max(h, prevH) * 0.5;
    if (lineBreak && toks.length) toks.at(-1)!.eol = true;
    let touchesEnd = false;
    for (const m of it.str.matchAll(/\S+/g)) {
      const s = m.index, e = s + m[0].length;
      const r: Rect = [x + (it.width * s) / len, y - 0.2 * h, x + (it.width * e) / len, y + 0.85 * h];
      if (s === 0 && open && !lineBreak && r[0] - prevEnd < h * 0.25 && r[0] - prevEnd > -h) {
        open.text += m[0];
        open.rects.push(r);
      } else toks.push({ text: m[0], rects: [r], eol: false });
      open = toks.at(-1);
      touchesEnd = e === len;
    }
    if (!touchesEnd) open = undefined;
    if (it.hasEOL && toks.length) toks.at(-1)!.eol = true;
    prevY = y; prevH = h; prevEnd = x + it.width;
  }
  // hyphenated line breaks
  const words: Word[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.eol && next && /\p{L}-$/u.test(t.text) && /^\p{Ll}/u.test(next.text)) {
      toks[i + 1] = { text: t.text.slice(0, -1) + next.text, rects: [...t.rects, ...next.rects], eol: next.eol };
      continue;
    }
    words.push({ text: t.text, rects: t.rects });
  }
  return words;
}

/** Joins rects that continue each other on one line into one box (a highlight per run of words, not per word). */
export function mergeRects(rects: readonly Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const p = out.at(-1);
    const h = r[3] - r[1];
    const overlap = p ? Math.min(p[3], r[3]) - Math.max(p[1], r[1]) : 0;
    if (p && overlap > h * 0.5 && r[0] - p[2] < h * 0.8 && r[0] >= p[0] - h) {
      p[0] = Math.min(p[0], r[0]); p[1] = Math.min(p[1], r[1]); p[2] = Math.max(p[2], r[2]); p[3] = Math.max(p[3], r[3]);
    } else out.push([...r]);
  }
  return out;
}
