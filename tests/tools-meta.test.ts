// The light registry (src/tools/index.ts) must match the tool modules (read as text: they need a DOM to import).
import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { TOOLS } from "../src/tools";

test("every tool module has exactly one matching registry row", () => {
  const files = readdirSync("src/tools").map((f) => f.replace(/\.ts$/, "")).filter((f) => !["index", "all", "types", "pages", "pagesel"].includes(f));
  expect(TOOLS).toHaveLength(files.length);
  const all = readFileSync("src/tools/all.ts", "utf8");
  for (const t of TOOLS) {
    expect(all, t.id).toContain(`"./${t.id}"`);
    const src = readFileSync(`src/tools/${t.id}.ts`, "utf8");
    for (const v of [`id: "${t.id}", title: "${t.title}"`, `blurb: "${t.blurb}"`, `group: "${t.group}"`]) expect(src, t.id).toContain(v);
    expect(/^\s*next: (\[.*?\]),/m.exec(src)?.[1]).toBe(t.next ? JSON.stringify(t.next).replace(/","/g, '", "') : undefined);
  }
});
