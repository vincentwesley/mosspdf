// Where the text of a page sits. pdf.js text items (user space) go through the viewport (rotation and CropBox applied) to boxes
// that are fractions of the displayed page from its top left, the same unit the page viewer overlays and the ops use.
// Pure and isomorphic: the caller passes the items and the viewport's numbers, so Node tests need no canvas.

/** Box as fractions of the displayed page, origin top left. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface TextItem { str: string; transform: number[]; width: number; hasEOL?: boolean }
export interface PageWord { text: string; r: Rect }
export interface PageText {
  /** The page's text in reading order; lines are joined with "\n". */
  text: string;
  /** One entry per character of `text`: the item it came from and its box (absent for the separators added here). */
  chars: { item: number; r?: Rect }[];
  words: PageWord[];
}

const mul = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const union = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
};

/** `vt` is the viewport transform at scale 1 ([a,b,c,d,e,f]); `vw`, `vh` the displayed page in points. */
export function layoutText(items: TextItem[], vt: number[], vw: number, vh: number): PageText {
  let text = "";
  const chars: PageText["chars"] = [];
  const words: PageWord[] = [];
  let prev: { end: [number, number]; dir: [number, number]; fs: number } | undefined;
  const sep = (ch: string, item: number) => { text += ch; chars.push({ item }); };
  items.forEach((it, k) => {
    const n = it.str.length;
    if (!n) { if (it.hasEOL && text && !text.endsWith("\n")) sep("\n", k); return; }
    const m = mul(vt, it.transform);
    const fs = Math.hypot(m[2], m[3]) || 1;
    const len = Math.hypot(m[0], m[1]) || 1;
    const dir: [number, number] = [m[0] / len, m[1] / len];
    if (prev && text && !text.endsWith("\n")) {
      const d = [m[4] - prev.end[0], m[5] - prev.end[1]];
      const along = d[0] * prev.dir[0] + d[1] * prev.dir[1];
      const perp = Math.abs(d[0] * prev.dir[1] - d[1] * prev.dir[0]);
      if (perp > prev.fs * 0.5) sep("\n", k);
      else if (along > prev.fs * 0.25 && !/\s$/.test(text) && !/^\s/.test(it.str)) sep(" ", k);
    }
    const box = (i0: number, i1: number): Rect => {
      const xs: number[] = [], ys: number[] = [];
      for (const t of [i0 / n, i1 / n]) for (const u of [-0.22, 1]) {
        xs.push(m[4] + dir[0] * t * it.width + m[2] * u);
        ys.push(m[5] + dir[1] * t * it.width + m[3] * u);
      }
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return { x: x0 / vw, y: y0 / vh, w: (Math.max(...xs) - x0) / vw, h: (Math.max(...ys) - y0) / vh };
    };
    for (let i = 0; i < n; i++) { text += it.str[i]; chars.push({ item: k, r: box(i, i + 1) }); }
    for (const w of it.str.matchAll(/\S+/g)) words.push({ text: w[0], r: box(w.index!, w.index! + w[0].length) });
    prev = { end: [m[4] + dir[0] * it.width, m[5] + dir[1] * it.width], dir, fs };
    if (it.hasEOL) sep("\n", k);
  });
  return { text, chars, words };
}

/** One box per item the range [start, end) touches (a match across two lines gives two boxes), grown by `pad` (fraction of the page). */
export function rangeRects(pt: PageText, start: number, end: number, pad = 0.002): Rect[] {
  const byItem = new Map<number, Rect[]>();
  for (let i = start; i < end; i++) {
    const c = pt.chars[i];
    if (!c?.r) continue;
    byItem.set(c.item, [...(byItem.get(c.item) ?? []), c.r]);
  }
  return [...byItem.values()].map((rs) => {
    const u = union(rs);
    return { x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad };
  });
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
