import { describe, expect, it } from "vitest";
import { matchTool } from "../src/core/toolsearch";

const merge = { title: "Merge", blurb: "Combine PDFs into one.", group: "Organize" as const };
describe("matchTool", () => {
  it("matches title, blurb and group, every word, case-insensitive", () => {
    expect(matchTool(merge, "MERGE")).toBe(true);
    expect(matchTool(merge, "combine one")).toBe(true);
    expect(matchTool(merge, "organize")).toBe(true);
    expect(matchTool(merge, "merge sign")).toBe(false);
    expect(matchTool(merge, "  ")).toBe(true);
  });
});

import { scoreTool } from "../src/core/toolsearch";
describe("scoreTool", () => {
  it("ranks title starts above blurb hits and finds letters in order", () => {
    expect(scoreTool(merge, "mer")).toBeGreaterThan(scoreTool(merge, "combine"));
    expect(scoreTool(merge, "mrg")).toBeGreaterThan(0);
    expect(scoreTool(merge, "zzz")).toBe(0);
    expect(scoreTool(merge, "merge zzz")).toBe(0);
    expect(scoreTool(merge, "")).toBeGreaterThan(0);
  });
});
