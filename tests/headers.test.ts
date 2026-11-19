import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// tests/headers.expected.json must stay in step with public/_headers.
it("headers.expected.json matches public/_headers", () => {
  const txt = readFileSync("public/_headers", "utf8");
  const global: Record<string, string> = {};
  const block = txt.split(/^\/\*\r?\n/m)[1].split(/^\/\S/m)[0];
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (m) global[m[1].toLowerCase()] = m[2].trim();
  }
  expect(JSON.parse(readFileSync("tests/headers.expected.json", "utf8")).global).toEqual(global);
});
