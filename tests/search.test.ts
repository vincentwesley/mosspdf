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
