import { describe, expect, it } from "vitest";
import { alignPages, compare, reportText, reportData, summaryLine } from "../../src/core/compare";
import { diffSeq, wordKey } from "../../src/core/diff";
import { mergeRects, wordsFromItems, type Word } from "../../src/core/pagewords";

const w = (s: string) => (s ? s.split(" ") : []);
/** Applies the hunks to a and checks it gives b: the diff is a valid edit script. */
const apply = (a: string[], b: string[], hunks: NonNullable<ReturnType<typeof diffSeq>>) => {
  const out: string[] = [];
  let i = 0;
  for (const h of hunks) { out.push(...a.slice(i, h.a0), ...b.slice(h.b0, h.b1)); i = h.a1; }
  return [...out, ...a.slice(i)];
};

describe("diffSeq", () => {
  it("identical: no hunks", () => expect(diffSeq(w("a b c"), w("a b c"))).toEqual([]));
  it("both empty: no hunks", () => expect(diffSeq([], [])).toEqual([]));
  it("insertion", () => expect(diffSeq(w("a b c"), w("a b x c"))).toEqual([{ a0: 2, a1: 2, b0: 2, b1: 3 }]));
  it("deletion", () => expect(diffSeq(w("a b x c"), w("a b c"))).toEqual([{ a0: 2, a1: 3, b0: 2, b1: 2 }]));
  it("replacement is one hunk", () => expect(diffSeq(w("a b c d"), w("a x y d"))).toEqual([{ a0: 1, a1: 3, b0: 1, b1: 3 }]));
  it("empty original: all added", () => expect(diffSeq([], w("a b"))).toEqual([{ a0: 0, a1: 0, b0: 0, b1: 2 }]));
  it("empty changed: all removed", () => expect(diffSeq(w("a b"), [])).toEqual([{ a0: 0, a1: 2, b0: 0, b1: 0 }]));
  it("unicode words", () => {
    const a = w("naïve café 日本語 ok"), b = w("naïve cafe 日本語 ok");
    expect(diffSeq(a, b)).toEqual([{ a0: 1, a1: 2, b0: 1, b1: 2 }]);
  });
  it("random edits give a valid script", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rnd(40) }, () => String(rnd(6)));
      const b = a.filter(() => rnd(4)).flatMap((x) => (rnd(5) ? [x] : [x, String(rnd(9))]));
      const hunks = diffSeq(a, b)!;
      expect(apply(a, b, hunks)).toEqual(b);
    }
  });
  it("cap: more than maxItems gives null", () => expect(diffSeq(w("a b c"), w("a b d"), { maxItems: 5 })).toBeNull());
  it("work budget: gives null instead of hanging", () => {
    const a = Array.from({ length: 4000 }, (_, i) => `a${i}`), b = Array.from({ length: 4000 }, (_, i) => `b${i}`);
    expect(diffSeq(a, b, { maxSteps: 10_000 })).toBeNull();
  });
  it("large similar texts finish", () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `w${i}`), b = [...a];
    b[100] = "x"; b.splice(30_000, 0, "new");
    expect(diffSeq(a, b)).toHaveLength(2);
  });
});

describe("wordKey", () => {
  it("case and punctuation options", () => {
    expect(wordKey("Hello,", {})).toBe("Hello,");
    expect(wordKey("Hello,", { ignoreCase: true })).toBe("hello,");
    expect(wordKey("Hello,", { ignoreCase: true, ignorePunct: true })).toBe("hello");
    expect(wordKey("ﬁne", {})).toBe("fine");
  });
});

const item = (str: string, x: number, y: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, hasEOL });
describe("wordsFromItems", () => {
  it("splits on whitespace and positions each word", () => {
    const [a, b] = wordsFromItems([item("ab cd", 100, 700)]);
    expect([a.text, b.text]).toEqual(["ab", "cd"]);
    expect(a.rects[0][0]).toBe(100);
    expect(b.rects[0][0]).toBe(115);
  });
  it("joins items that continue a word, not ones after a gap", () => {
    expect(wordsFromItems([item("Hel", 0, 0), item("lo", 15, 0)]).map((x) => x.text)).toEqual(["Hello"]);
    expect(wordsFromItems([item("Hel", 0, 0), item("lo", 40, 0)]).map((x) => x.text)).toEqual(["Hel", "lo"]);
  });
  it("joins a hyphenated line break", () => {
    const words = wordsFromItems([item("an exam-", 0, 100, true), item("ple of it", 0, 88)]);
    expect(words.map((x) => x.text)).toEqual(["an", "example", "of", "it"]);
    expect(words[1].rects).toHaveLength(2);
  });
  it("keeps a real hyphen before a capital or digit", () => {
    expect(wordsFromItems([item("x-", 0, 100, true), item("Ray", 0, 88)]).map((x) => x.text)).toEqual(["x-", "Ray"]);
  });
  it("merges neighbouring rects on a line", () => {
    const r = mergeRects([[0, 0, 10, 10], [12, 0, 20, 10], [0, 30, 10, 40]]);
    expect(r).toEqual([[0, 0, 20, 10], [0, 30, 10, 40]]);
  });
});

const page = (s: string): Word[] => w(s).map((t) => ({ text: t, rects: [[0, 0, 1, 1]] }));
const O = { ignoreCase: false, ignorePunct: false };
describe("compare", () => {
  it("identical: no changes", () => {
    const c = compare([page("a b"), page("c")], [page("a b"), page("c")], O);
    expect(c.changes).toEqual([]);
    expect(summaryLine(c)).toBe("No text differences found");
    expect(summaryLine(c, 2)).toBe("No text differences found. The text is the same, but 2 pages look different.");
  });
  it("counts changes and pages", () => {
    const c = compare([page("a b c"), page("d e f")], [page("a x c"), page("d e f g")], O);
    expect(c.changes.map((x) => x.kind)).toEqual(["changed", "added"]);
    expect(summaryLine(c)).toBe("2 changes on 2 pages");
    expect(c.changes[0].a!.text).toBe("b");
    expect(c.changes[0].b!.spans).toEqual([{ page: 0, from: 1, to: 2 }]);
  });
  it("a deleted page and different page counts", () => {
    const c = compare([page("a b"), page("c d"), page("e f")], [page("a b"), page("c d")], O);
    expect(c.changes).toHaveLength(1);
    expect(c.changes[0].kind).toBe("removed");
    expect(c.changes[0].a!.pages).toEqual([2, 2]);
    expect(c.align).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }, { a: 2, b: null }]);
  });
  it("an inserted page shifts the pairing, not the later pages", () => {
    expect(alignPages(["a", "b"], ["a", "new", "b"])).toEqual([{ a: 0, b: 0 }, { a: null, b: 1 }, { a: 1, b: 2 }]);
  });
  it("ignore case and punctuation", () => {
    expect(compare([page("Hello, World")], [page("hello world")], O).changes).toHaveLength(1);
    expect(compare([page("Hello, World")], [page("hello world")], { ignoreCase: true, ignorePunct: true }).changes).toHaveLength(0);
  });
  it("empty sides", () => {
    const c = compare([page("")], [page("a b")], O);
    expect(c.wordsA).toBe(0);
    expect(c.changes).toHaveLength(1);
    expect(c.changes[0].kind).toBe("added");
  });
  it("over the cap: page-level changes", () => {
    const big = (t: string) => [Array.from({ length: 100_001 }, (_, i) => ({ text: i === 5 ? t : `w${i}`, rects: [] as never[] }))] as Word[][];
    const c = compare(big("x"), big("y"), O);
    expect(c.coarse).toBe(true);
    expect(c.changes).toHaveLength(1);
    expect(c.changes[0].a!.text).toBe("");
  });
  it("report text lists the changes", () => {
    const c = compare([page("a b c")], [page("a x c")], O);
    const t = reportText(reportData(c, "one.pdf", "two.pdf", "2026-01-01", 0));
    expect(t).toContain("Original: one.pdf");
    expect(t).toContain("Change 1: Original page 1, Changed page 1");
    expect(t).toContain("  Removed: b");
    expect(t).toContain("  Added: x");
  });
});
