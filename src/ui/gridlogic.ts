// Pure helpers for the page grid: undo/redo snapshots, moving a selection, shift-click ranges.

/** Snapshot history. `push` the state before a change; `undo(now)` / `redo(now)` swap `now` for the saved one. */
export function history<T>(max = 50) {
  const past: T[] = [], future: T[] = [];
  return {
    push(before: T) { past.push(before); if (past.length > max) past.shift(); future.length = 0; },
    undo(now: T): T | undefined { const t = past.pop(); if (t !== undefined) future.push(now); return t; },
    redo(now: T): T | undefined { const t = future.pop(); if (t !== undefined) past.push(now); return t; },
    clear() { past.length = future.length = 0; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}

/** Moves every selected item one place earlier (-1) or later (1); a selected block already at the edge stays. */
export function shiftSelected<T>(arr: T[], isSel: (x: T) => boolean, dir: -1 | 1): T[] {
  const a = arr.slice();
  const idx = dir < 0 ? Array.from(a.keys()) : Array.from(a.keys()).reverse();
  for (const i of idx) {
    const j = i + dir;
    if (j < 0 || j >= a.length || !isSel(a[i]) || isSel(a[j])) continue;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Indexes from `a` to `b`, either way round, both ends included. */
export const rangeBetween = (a: number, b: number): number[] => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);
