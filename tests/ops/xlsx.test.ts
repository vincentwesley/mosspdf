// PDF to Excel: column detection, number parsing, CSV guard and the .xlsx parts.
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vitest";
import { buildCsv, buildXlsx, detectGrid, parseCell, type XItem } from "../../src/core/xlsx";

const it = (str: string, x: number, y: number): XItem => ({ str, width: str.length * 6, height: 12, transform: [12, 0, 0, 12, x, y] });
const rows = [["Item", "Qty", "Price"], ["Red apple", "3", "1,234.50"], ["Pear", "12", "(5)"], ["Fig", "007", "45%"]];
const xs = [50, 200, 320];
const items = [it("Quarterly report", 50, 760), ...rows.flatMap((r, i) => r.map((s, j) => it(s, xs[j], 700 - i * 20 + (j === 1 ? 1 : 0))))];

test("rows by baseline, columns by whitespace, title row kept", () => {
  const g = detectGrid(items);
  expect(g[0]).toEqual(["Quarterly report", "", ""]);
  expect(g.slice(1)).toEqual(rows);
});

test("words of one cell stay together", () => {
  const g = detectGrid([it("Red", 50, 700), it("apple", 78, 700), it("9", 200, 700), it("Pear", 50, 680), it("8", 200, 680)]);
  expect(g).toEqual([["Red apple", "9"], ["Pear", "8"]]);
});

test("number parsing", () => {
  expect(parseCell("1,234.56")).toMatchObject({ n: 1234.56 });
  expect(parseCell("-12")).toMatchObject({ n: -12 });
  expect(parseCell("(12)")).toMatchObject({ n: -12 });
  expect(parseCell("45%")).toMatchObject({ n: 0.45, pct: true });
  for (const s of ["007", "12 apples", "1,23", "(12", "1.2.3", ""]) expect(typeof parseCell(s)).toBe("string");
});

test("CSV quoting and formula guard", () => {
  const csv = buildCsv([["=SUM(A1)", "-12", "@x", "a,b", 'say "hi"', "-dash"], ["+1 555", "\tx", "(5)", "45%", "007", ""]]);
  expect(csv).toBe("﻿'=SUM(A1),-12,'@x,\"a,b\",\"say \"\"hi\"\"\",'-dash\r\n'+1 555,'\tx,-5,45%,007,\r\n");
});

test("xlsx parts, sheets per page, inline strings, numeric cells", () => {
  const z = unzipSync(buildXlsx([[["A <&>", "1,5", "007"], ["(3)", "45%", ""]], []]));
  expect(Object.keys(z).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
  expect(strFromU8(z["xl/workbook.xml"])).toContain('name="Page 2"');
  const s = strFromU8(z["xl/worksheets/sheet1.xml"]);
  expect(s).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">A &lt;&amp;&gt;</t></is></c>');
  expect(s).toContain('<c r="C1" t="inlineStr"><is><t xml:space="preserve">007</t>');
  expect(s).toContain('<c r="A2"><v>-3</v></c>');
  expect(s).toContain('<c r="B2" s="1"><v>0.45</v></c>');
  expect(s).not.toContain("C2");
});
