// PDF to Excel: a three-column table made in the test, read back from the .xlsx and the CSV download.
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { test, expect, downloadAndCheck, loadApp } from "./fixtures";

const ROWS = [["Item", "Qty", "Price"], ["Apple", "3", "1,234.50"], ["Pear", "12", "(5)"], ["Fig", "007", "45%"]];

async function tablePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 300]);
  ROWS.forEach((r, i) => r.forEach((s, j) => p.drawText(s, { x: 40 + j * 120, y: 250 - i * 24, size: 12, font })));
  return Buffer.from(await doc.save());
}

const open = async (page: import("@playwright/test").Page) => {
  await loadApp(page, "/#/pdf-to-excel");
  await page.getByTestId("file-input").setInputFiles({ name: "table.pdf", mimeType: "application/pdf", buffer: await tablePdf() });
  await expect(page.getByTestId("primary-action")).toBeEnabled({ timeout: 20_000 });
};
const get = (page: import("@playwright/test").Page) => downloadAndCheck(page, () => page.getByTestId("result-download").click());

test("pdf to excel: xlsx has the table, numbers as numbers, zero-padded text kept", async ({ page }) => {
  await open(page);
  await page.getByTestId("primary-action").click();
  const r = await get(page);
  expect(r.name).toBe("table.xlsx");
  const sheet = strFromU8(unzipSync(r.bytes)["xl/worksheets/sheet1.xml"]);
  for (const s of ["Item", "Qty", "Price", "Apple", "Pear", "Fig"]) expect(sheet).toContain(`>${s}</t>`);
  expect(sheet).toContain('<c r="B2"><v>3</v></c>');
  expect(sheet).toContain('<c r="C2"><v>1234.5</v></c>');
  expect(sheet).toContain('<c r="C3"><v>-5</v></c>');
  expect(sheet).toContain('<c r="C4" s="1"><v>0.45</v></c>');
  expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">007</t>');
});

test("pdf to excel: csv", async ({ page }) => {
  await open(page);
  await page.getByTestId("pte-csv").check({ force: true });
  await page.getByTestId("primary-action").click();
  const r = await get(page);
  expect(r.name).toBe("table.csv");
  expect(r.bytes.toString("utf8")).toBe("﻿Item,Qty,Price\r\nApple,3,1234.5\r\nPear,12,-5\r\nFig,007,45%\r\n");
});
