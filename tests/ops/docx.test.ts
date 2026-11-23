// PDF to Word: line and paragraph grouping, headings, and the .docx writer.
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vitest";
import { buildDocx, esc, toLines, toParas, type DocxItem } from "../../src/core/docx";

const it = (str: string, y: number, size = 12, extra: Partial<DocxItem> = {}): DocxItem => ({ str, hasEOL: true, height: size, transform: [size, 0, 0, size, 72, y], ...extra });
const items = [it("Big Title", 700, 24), it("first line", 650), it("second line", 636), it("next paragraph", 600, 12, { fontName: "Arial-BoldMT" })];

test("lines, headings and paragraphs", () => {
  const flow = toParas(toLines(items), true);
  expect(flow.map((p) => p.heading)).toEqual([1, 0, 0]);
  expect(flow[1].runs[0].text).toBe("first line second line");
  expect(flow[2].runs[0].bold).toBe(true);
  expect(toParas(toLines(items), false)).toHaveLength(4);
});

test("items on one baseline form one line", () => {
  expect(toLines([{ str: "a ", transform: [10, 0, 0, 10, 0, 50], height: 10 }, { str: "b", hasEOL: true, transform: [10, 0, 0, 10, 20, 50], height: 10 }])).toHaveLength(1);
});

test("escaping drops control characters", () => expect(esc("<&>\"'\u0001x")).toBe("&lt;&amp;&gt;&quot;&apos;x"));

test("docx has the parts, escaped text, headings and page breaks", () => {
  const z = unzipSync(buildDocx([toParas(toLines([it("T <&> x", 700, 24), it("body", 650)]), true), []]));
  expect(Object.keys(z).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
  const doc = strFromU8(z["word/document.xml"]);
  expect(doc).toContain("T &lt;&amp;&gt; x");
  expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
  expect(doc).toContain("<w:pageBreakBefore/>");
  const st = strFromU8(z["word/styles.xml"]);
  for (const id of ["Normal", "Heading1", "Heading2"]) expect(st).toContain(`w:styleId="${id}"`);
});
