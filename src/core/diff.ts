// Myers word diff (linear space, middle-snake bisection). Pure: no DOM, no dependencies.
// `diffSeq` works on any string sequence (words, or the text of whole pages) and returns only the changed ranges.

/** One changed range: a[a0..a1) became b[b0..b1). Either side may be empty (a pure insertion or deletion). */
export interface Hunk { a0: number; a1: number; b0: number; b1: number }
export interface DiffOpts {
  /** More than this many items in total: give up (null). */
  maxItems?: number;
  /** Work budget (inner-loop steps) before giving up (null): two unrelated long texts would otherwise take minutes. */
  maxSteps?: number;
}
export const MAX_ITEMS = 200_000;
const MAX_STEPS = 60_000_000;

/** What two words must have in common to count as the same word. */
export function wordKey(text: string, o: { ignoreCase?: boolean; ignorePunct?: boolean }): string {
  let k = text.normalize("NFKC");
  if (o.ignoreCase) k = k.toLowerCase();
  if (o.ignorePunct) k = k.replace(/[\p{P}\p{S}]/gu, "");
  return k;
}

class Budget extends Error {}

export function diffSeq(a: readonly string[], b: readonly string[], opts: DiffOpts = {}): Hunk[] | null {
  if (a.length + b.length > (opts.maxItems ?? MAX_ITEMS)) return null;
  const ids = new Map<string, number>();
  const id = (s: string) => ids.get(s) ?? (ids.set(s, ids.size), ids.size - 1);
  const A = Int32Array.from(a, id), B = Int32Array.from(b, id);
  const out: Hunk[] = [];
  let steps = 0;
  const max = opts.maxSteps ?? MAX_STEPS;

  /** Middle snake of A[a0..a1) / B[b0..b1) as the split point [x, y] (offsets into the ranges), or null when they share nothing useful. */
  function bisect(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
    const n = a1 - a0, m = b1 - b0;
    const maxD = Math.ceil((n + m) / 2), off = maxD, len = 2 * maxD;
    const v1 = new Int32Array(len).fill(-1), v2 = new Int32Array(len).fill(-1);
    v1[off + 1] = 0; v2[off + 1] = 0;
    const delta = n - m, front = delta % 2 !== 0;
    let k1s = 0, k1e = 0, k2s = 0, k2e = 0;
    for (let d = 0; d < maxD; d++) {
      for (let k1 = -d + k1s; k1 <= d - k1e; k1 += 2) {
        const o1 = off + k1;
        let x1 = k1 === -d || (k1 !== d && v1[o1 - 1] < v1[o1 + 1]) ? v1[o1 + 1] : v1[o1 - 1] + 1;
        let y1 = x1 - k1;
        while (x1 < n && y1 < m && A[a0 + x1] === B[b0 + y1]) { x1++; y1++; }
        if (++steps > max) throw new Budget();
        v1[o1] = x1;
        if (x1 > n) k1e += 2;
        else if (y1 > m) k1s += 2;
        else if (front) {
          const o2 = off + delta - k1;
          if (o2 >= 0 && o2 < len && v2[o2] !== -1 && x1 >= n - v2[o2]) return [x1, y1];
        }
      }
      for (let k2 = -d + k2s; k2 <= d - k2e; k2 += 2) {
        const o2 = off + k2;
        let x2 = k2 === -d || (k2 !== d && v2[o2 - 1] < v2[o2 + 1]) ? v2[o2 + 1] : v2[o2 - 1] + 1;
        let y2 = x2 - k2;
        while (x2 < n && y2 < m && A[a0 + n - x2 - 1] === B[b0 + m - y2 - 1]) { x2++; y2++; }
        if (++steps > max) throw new Budget();
        v2[o2] = x2;
        if (x2 > n) k2e += 2;
        else if (y2 > m) k2s += 2;
        else if (!front) {
          const o1 = off + delta - k2;
          if (o1 >= 0 && o1 < len && v1[o1] !== -1) {
            const x1 = v1[o1];
            if (x1 >= n - x2) return [x1, off + x1 - o1];
          }
        }
      }
    }
    return null;
  }

  function solve(a0: number, a1: number, b0: number, b1: number): void {
    while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { a0++; b0++; }
    while (a0 < a1 && b0 < b1 && A[a1 - 1] === B[b1 - 1]) { a1--; b1--; }
    if (a0 === a1 && b0 === b1) return;
    if (a0 === a1 || b0 === b1) { out.push({ a0, a1, b0, b1 }); return; }
    const s = bisect(a0, a1, b0, b1);
    if (!s || (s[0] === 0 && s[1] === 0) || (s[0] === a1 - a0 && s[1] === b1 - b0)) { out.push({ a0, a1, b0, b1 }); return; }
    solve(a0, a0 + s[0], b0, b0 + s[1]);
    solve(a0 + s[0], a1, b0 + s[1], b1);
  }

  try { solve(0, A.length, 0, B.length); } catch (e) { if (e instanceof Budget) return null; throw e; }
  // touching hunks (a deletion next to an insertion) are one replacement
  const merged: Hunk[] = [];
  for (const h of out) {
    const p = merged.at(-1);
    if (p && p.a1 === h.a0 && p.b1 === h.b0) { p.a1 = h.a1; p.b1 = h.b1; } else merged.push({ ...h });
  }
  return merged;
}
