// Pages per sheet and Add blank pages: each downloads a result that is read back (page count and sizes).
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";

const primary = (page: Page) => page.getByTestId("primary-action");
async function open(page: Page, route: string, pages: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([612, 792]).drawText(`P${i + 1}`, { x: 100, y: 100, size: 30 });
  await loadApp(page, route);
  await page.getByTestId("file-input").setInputFiles({ name: "six.pdf", mimeType: "application/pdf", buffer: Buffer.from(await d.save()) });
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
}
const download = (page: Page) => downloadAndCheck(page, () => page.getByTestId("result-download").click());
const sizes = async (bytes: Buffer) => (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);

test("pages per sheet: 2 per sheet, 4 per sheet on A4, then a booklet", async ({ page }) => {
  await open(page, "/#/nup", 6);
  await primary(page).click();
  const a = await download(page);
  expect(a.name).toBe("six-2-up.pdf");
  expect(qpdfCheck(a.path).ok).toBe(true);
  expect(await sizes(a.bytes)).toEqual([[792, 612], [792, 612], [792, 612]]);

  await page.getByTestId("nup-4").check();
  await page.getByTestId("nup-sheet").selectOption("a4");
  await page.getByTestId("nup-border").check();
  await primary(page).click();
  const b = await download(page);
  expect(b.name).toBe("six-4-up.pdf");
  expect(await sizes(b.bytes)).toEqual([[595, 842], [595, 842]]);

  await page.getByTestId("nup-booklet").check();
  await primary(page).click();
  const c = await download(page);
  expect(c.name).toBe("six-booklet.pdf");
  expect(qpdfCheck(c.path).ok).toBe(true);
  expect((await sizes(c.bytes)).length).toBe(4); // 6 pages padded to 8, two per side
});

test("add blank pages: after every page, then two after page 2", async ({ page }) => {
  await open(page, "/#/add-pages", 3);
  await expect(page.getByTestId("ap-page")).toBeHidden();
  await page.getByTestId("ap-every").check();
  await primary(page).click();
  const a = await download(page);
  expect(a.name).toBe("six-with-blanks.pdf");
  expect(qpdfCheck(a.path).ok).toBe(true);
  expect((await sizes(a.bytes)).length).toBe(6);

  await page.getByTestId("ap-after").check();
  await page.getByTestId("ap-page").fill("2");
  await page.getByTestId("ap-count").fill("2");
  await primary(page).click();
  const b = await download(page);
  expect((await sizes(b.bytes)).length).toBe(5);

  await page.getByTestId("ap-page").fill("9");
  await expect(primary(page)).toBeDisabled();
});
