import { describe, expect, it } from "vitest";
import type { ReportData } from "../../src/core/compare";
import { compareReport } from "../../src/ops";
import { opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const data = (n: number, text = "plain words"): ReportData => ({
  nameA: "one.pdf", nameB: "two version.pdf", date: "2026-01-01", summary: `${n} changes on 2 pages`, notes: ["The Original has 3 pages and the Changed has 2 pages."],
  changes: Array.from({ length: n }, (_, i) => ({ label: `Change ${i + 1}: Original page 2, Changed page 2`, removed: text, added: `${text} added` })),
});

describe("M7 compareReport", () => {
  it("passes qpdf --check and carries the summary and every change", async () => {
    const r = await compareReport(data(60, "We will hire two engineers in March. ".repeat(8)), opts());
    qpdfCheck(r.bytes);
    expect(r.name).toBe("two version-comparison.pdf");
    const pages = await readPdf(r.bytes);
    expect(pages.length).toBeGreaterThan(1); // 60 changes need more than one page
    const text = pages.map((p) => p.text).join(" ");
    expect(text).toContain("Pagehold comparison report");
    expect(text).toContain("60 changes on 2 pages");
    expect(text).toContain("Change 60:");
    expect(text).toContain("Removed:");
    expect(text).toContain("Added:");
  });
  it("shows characters outside WinAnsi as ? and says so", async () => {
    const r = await compareReport(data(1, "日本語 ok"), opts());
    qpdfCheck(r.bytes);
    const text = (await readPdf(r.bytes)).map((p) => p.text).join(" ");
    expect(text).toContain("? ok");
    expect(text).toContain("shown as ?");
  });
  it("no changes still gives a one page report", async () => {
    const r = await compareReport({ ...data(0), summary: "No text differences found" }, opts());
    qpdfCheck(r.bytes);
    expect(await readPdf(r.bytes)).toHaveLength(1);
  });
  it("a word wider than the line is cut, not run off the page", async () => {
    const r = await compareReport(data(1, "x".repeat(400)), opts());
    qpdfCheck(r.bytes);
  });
});
