import { describe, expect, it } from "vitest";
import { history, rangeBetween, shiftSelected } from "../../src/ui/gridlogic";

describe("history", () => {
  it("undoes and redoes, and a new change clears redo", () => {
    const h = history<string>();
    h.push("a"); h.push("b");
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.undo("a")).toBeUndefined();
    expect(h.redo("a")).toBe("b");
    h.push("x");
    expect(h.canRedo).toBe(false);
  });
  it("keeps the last 50 steps", () => {
    const h = history<number>(50);
    for (let i = 0; i < 60; i++) h.push(i);
    let n = 0, last: number | undefined;
    for (let t = h.undo(0); t !== undefined; t = h.undo(0)) { n++; last = t; }
    expect(n).toBe(50);
    expect(last).toBe(10);
  });
});

describe("shiftSelected", () => {
  const sel = (s: number[]) => (x: number) => s.includes(x);
  it("moves a block earlier", () => expect(shiftSelected([1, 2, 3, 4, 5], sel([3, 4]), -1)).toEqual([1, 3, 4, 2, 5]));
  it("moves separate items later", () => expect(shiftSelected([1, 2, 3, 4, 5], sel([1, 4]), 1)).toEqual([2, 1, 3, 5, 4]));
  it("stops at the edges", () => expect(shiftSelected([1, 2, 3], sel([1, 2]), -1)).toEqual([1, 2, 3]));
});

describe("rangeBetween", () => {
  it("works both ways", () => { expect(rangeBetween(1, 3)).toEqual([1, 2, 3]); expect(rangeBetween(3, 1)).toEqual([1, 2, 3]); });
});
