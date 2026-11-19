import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// tests/headers.expected.json must stay in step with public/_headers (global block and the /assets/workers/* rule).
const txt = readFileSync("public/_headers", "utf8");
const expected = JSON.parse(readFileSync("tests/headers.expected.json", "utf8")) as { global: Record<string, string>; workers: Record<string, string> };

/** Header lines of the rule whose path line is `path`. */
function rule(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const start = txt.split(/?
/).findIndex((l) => l === path);
  expect(start, `rule ${path} exists`).toBeGreaterThanOrEqual(0);
  for (const line of txt.split(/?
/).slice(start + 1)) {
    const m = /^s+([w-]+):s*(.+)$/.exec(line);
    if (!m) break;
    out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

it("headers.expected.json matches public/_headers", () => {
  expect(expected.global).toEqual(rule("/*"));
});

it("workers rule: Cloudflare joins the two CSPs with a comma, so the stricter connect-src 'none' wins", () => {
  const w = rule("/assets/workers/*")["content-security-policy"];
  expect(w).toContain("connect-src 'none'");
  expect(expected.workers["content-security-policy"]).toBe(`${expected.global["content-security-policy"]},${w}`);
});
