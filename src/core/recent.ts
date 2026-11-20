// "Recently used" tools on the home page: tool ids in localStorage, newest first. Storage may be blocked, so every access is guarded.
const KEY = "pagehold:recent";
const MAX = 4;

export function getRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch { return []; }
}

export function pushRecent(id: string): void {
  try { localStorage.setItem(KEY, JSON.stringify([id, ...getRecent().filter((x) => x !== id)].slice(0, MAX))); } catch { /* not remembered */ }
}
