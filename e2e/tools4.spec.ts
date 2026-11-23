// Flatten PDF and Remove blank pages: fixtures are built in the test; results are read back from the download.
import { PDFDocument, PDFName, StandardFonts, rgb } from "@cantoo/pdf-lib";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";

const primary = (page: Page) => page.getByTestId("primary-action");
async function open(page: Page, route: string, bytes: Uint8Array) {
  await loadApp(page, route);
  await page.getByTestId("file-input").setInputFiles({ name: "t.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
}
const download = (page: Page) => downloadAndCheck(page, () => page.getByTestId("result-download").click());

async function formAndNote() {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  const t = d.getForm().createTextField("name");
  t.setText("Ada");
  t.addToPage(p, { x: 20, y: 100, width: 100, height: 20 });
  const ctx = d.context;
  const ap = ctx.register(ctx.stream("1 0 0 rg 0 0 10 10 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] }));
  const note = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Square", Rect: [50, 50, 100, 100], F: 4, AP: { N: ap } }));
  p.node.set(PDFName.of("Annots"), ctx.obj([...(p.node.Annots()?.asArray() ?? []), note]));
  return d.save();
}

test("flatten: forms only keeps notes; forms and annotations removes both", async ({ page }) => {
  await open(page, "/#/flatten", await formAndNote());
  await page.getByTestId("flat-forms").check();
  await primary(page).click();
  const a = await download(page);
  expect(a.name).toBe("t-flattened.pdf");
  expect(qpdfCheck(a.path).ok).toBe(true);
  const docA = await PDFDocument.load(a.bytes);
  expect(docA.getForm().getFields()).toHaveLength(0);
  expect(docA.getPage(0).node.Annots()?.size()).toBe(1);

  await page.getByTestId("flat-all").check();
  await primary(page).click();
  const b = await download(page);
  const docB = await PDFDocument.load(b.bytes);
  expect(docB.getForm().getFields()).toHaveLength(0);
  expect(docB.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});

test("flatten: a PDF without a form gets a plain message", async ({ page }) => {
  const d = await PDFDocument.create();
  d.addPage();
  await open(page, "/#/flatten", await d.save());
  await primary(page).click();
  await expect(page.getByText("has no form fields to flatten")).toBeVisible();
});

async function scan() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 5; i++) {
    const p = d.addPage([300, 400]);
    if (i === 1 || i === 5) p.drawText(`Page ${i} with real text on it`, { x: 30, y: 300, size: 16, font: f });
    if (i === 4) p.drawRectangle({ x: 100, y: 100, width: 5, height: 5, color: rgb(0, 0, 0) }); // a scanner speck, about 0.02% of the page
  }
  return d.save();
}

test("remove blank: lists the blank pages by sensitivity, then drops them", async ({ page }) => {
  await open(page, "/#/remove-blank", await scan());
  const status = page.getByTestId("blank-status");
  await expect(status).toContainText("3 blank pages will be removed: 2-4", { timeout: 30_000 });
  await expect(page.getByTestId("blank-strip").locator("canvas")).toHaveCount(3);
  await page.getByTestId("blank-strict").check();
  await expect(status).toContainText("2 blank pages will be removed: 2-3");
  await page.getByTestId("blank-loose").check();
  await expect(status).toContainText("3 blank pages will be removed: 2-4");
  await primary(page).click();
  const dl = await download(page);
  expect(dl.name).toBe("t-no-blanks.pdf");
  expect(qpdfCheck(dl.path).ok).toBe(true);
  expect((await PDFDocument.load(dl.bytes)).getPageCount()).toBe(2);
});

test("remove blank: refuses when every page is blank", async ({ page }) => {
  const d = await PDFDocument.create();
  d.addPage();
  d.addPage();
  await open(page, "/#/remove-blank", await d.save());
  await expect(page.getByTestId("blank-status")).toContainText("Every page looks blank", { timeout: 30_000 });
  await expect(primary(page)).toBeDisabled();
});
