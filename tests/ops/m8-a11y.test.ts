import { PDFDocument, PDFName, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { a11yReportText } from "../../src/core/a11yreport";
import { accessibilityCheck, type A11yReport } from "../../src/ops";
import { corpus, engines } from "../helpers/env";

const status = (r: A11yReport, id: string) => r.checks.find((c) => c.id === id)!.status;

/** A tagged document built by hand: language, title, DisplayDocTitle, two figures (one with Alt), an embedded-looking font, 25 pages and an outline. */
async function tagged(): Promise<{ name: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 25; i++) doc.addPage([300, 300]).drawText(`Page ${i + 1}`, { x: 20, y: 200, font });
  doc.setTitle("Tagged sample");
  const c = doc.context;
  const reg = (o: unknown) => c.register(c.obj(o as never));
  const fig = (alt?: string) => reg({ Type: "StructElem", S: "Figure", ...(alt ? { Alt: PDFString.of(alt) } : {}) });
  const tree = reg({ Type: "StructTreeRoot", K: [fig("A chart"), fig()] });
  const outline = reg({ Type: "Outlines", First: reg({ Title: PDFString.of("One") }), Count: 1 });
  doc.catalog.set(PDFName.of("StructTreeRoot"), tree);
  doc.catalog.set(PDFName.of("MarkInfo"), c.obj({ Marked: true }));
  doc.catalog.set(PDFName.of("Lang"), PDFString.of("en-US"));
  doc.catalog.set(PDFName.of("ViewerPreferences"), c.obj({ DisplayDocTitle: true }));
  doc.catalog.set(PDFName.of("Outlines"), outline);
  return { name: "tagged.pdf", bytes: await doc.save({ useObjectStreams: false }) };
}

describe("accessibility check", () => {
  it("@A-A11Y-1 an untagged file with text fails tags, language and title, and warns on fonts", async () => {
    const r = await accessibilityCheck(corpus("plain-3p"), engines);
    expect(status(r, "tagged")).toBe("fail");
    expect(status(r, "language")).toBe("fail");
    expect(status(r, "title")).toBe("warn"); // has a title, no DisplayDocTitle
    expect(status(r, "figures")).toBe("warn");
    expect(status(r, "fonts")).toBe("warn");
    expect(status(r, "text")).toBe("pass");
    expect(status(r, "bookmarks")).toBe("pass");
    expect(r.checks.filter((c) => c.status !== "pass").every((c) => c.fix)).toBe(true);
  });
  it("@A-A11Y-2 a scan has no text", async () => {
    const r = await accessibilityCheck(corpus("scan-1p"), engines);
    expect(status(r, "text")).toBe("fail");
    expect(r.checks.find((c) => c.id === "text")!.fix).toMatch(/OCR/);
  });
  it("@A-A11Y-3 a tagged file passes tags, language, title and bookmarks and counts figures without Alt", async () => {
    const r = await accessibilityCheck(await tagged(), engines);
    expect(status(r, "tagged")).toBe("pass");
    expect(status(r, "language")).toBe("pass");
    expect(status(r, "title")).toBe("pass");
    expect(status(r, "bookmarks")).toBe("pass");
    expect(status(r, "figures")).toBe("fail");
    expect(r.checks.find((c) => c.id === "figures")!.detail).toContain("1 of 2");
  });
  it("@A-A11Y-4 a long file without an outline warns about bookmarks; the text report says it is not PDF/UA", async () => {
    const r = await accessibilityCheck(corpus("text-500p"), engines);
    expect(status(r, "bookmarks")).toBe("warn");
    const t = a11yReportText("x.pdf", r);
    expect(t).toContain("[CHECK] Bookmarks");
    expect(t).toContain("not a PDF/UA validation");
  });
});
