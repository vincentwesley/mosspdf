// Edit PDF: add text, white-out and highlight, save, read the text back. The fixture fails the test on any request after the seal.
import { resolve } from "node:path";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";
import { readPdf } from "../tests/helpers/qpdf";

const overlay = (page: import("@playwright/test").Page, i = 0) => page.getByTestId("pv-overlay").nth(i);

test("A-E2E-1 add text, white-out and a highlight, save, the text reads back; Delete removes an item", async ({ page }) => {
  await loadApp(page, "/#/edit");
  await page.getByTestId("file-input").setInputFiles(resolve("tests/corpus/generated/plain-3p.pdf"));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await expect(page.getByTestId("primary-action")).toBeDisabled();
  await expect(page.getByTestId("primary-why")).toHaveText("Add something to a page first.");
  await page.getByTestId("ed-text").fill("Žluťoučký Привет edit");
  await overlay(page).click({ position: { x: 120, y: 200 } });
  await expect(page.getByTestId("sg-item")).toHaveCount(1);
  await page.getByTestId("ed-kind-whiteout").check();
  await expect(page.getByTestId("ed-cover")).toContainText("only covers");
  await overlay(page).click({ position: { x: 200, y: 300 } });
  await page.getByTestId("ed-kind-highlight").check();
  await overlay(page).click({ position: { x: 200, y: 380 } });
  await page.getByTestId("ed-kind-line").check();
  await overlay(page).click({ position: { x: 200, y: 440 } });
  await expect(page.getByTestId("ed-row")).toHaveCount(4);
  await expect(page.getByTestId("ed-row").first()).toContainText("Text: Žluťoučký Привет edit, page 1");
  await page.getByTestId("sg-item").last().press("Delete"); // the line
  await expect(page.getByTestId("ed-row")).toHaveCount(3);
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  expect(qpdfCheck(dl.path).ok).toBe(true);
  expect(dl.name).toBe("plain-3p-edited.pdf");
  const pages = await readPdf(dl.bytes);
  expect(pages[0].text).toContain("Žluťoučký Привет edit");
  expect(pages[0].text).toContain("PAGE-MARKER p1");
  const raw = dl.bytes.toString("latin1");
  expect(raw).toContain("1 1 1 rg");
  expect(raw).toMatch(/\/BM\s*\/Multiply/);
});

test("A-E2E-2 add a picture, Undo removes it, Redo brings it back, it saves as an image", async ({ page }) => {
  await loadApp(page, "/#/edit");
  await page.getByTestId("file-input").setInputFiles(resolve("tests/corpus/generated/plain-3p.pdf"));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await page.getByTestId("ed-kind-image").check();
  await page.getByTestId("ed-pic").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("no") });
  await expect(page.getByTestId("ed-pic-msg")).toContainText("not a JPG, PNG or WebP");
  await page.getByTestId("ed-pic").setInputFiles(resolve("tests/corpus/generated/photo-alpha.png"));
  await expect(page.getByTestId("ed-pic-msg")).toContainText("Picture ready");
  await expect(page.getByTestId("ed-undo")).toBeDisabled();
  await overlay(page).click({ position: { x: 150, y: 250 } });
  await expect(page.getByTestId("sg-item")).toHaveCount(1);
  await expect(page.getByTestId("ed-row")).toContainText("Picture, page 1");
  await page.getByTestId("ed-undo").click();
  await expect(page.getByTestId("sg-item")).toHaveCount(0);
  await expect(page.getByTestId("ed-row")).toHaveCount(0);
  await page.getByTestId("ed-redo").click();
  await expect(page.getByTestId("sg-item")).toHaveCount(1);
  await page.getByTestId("sg-item").press("Delete");
  await expect(page.getByTestId("sg-item")).toHaveCount(0);
  await page.getByTestId("ed-place").focus();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("sg-item")).toHaveCount(1);
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  expect(qpdfCheck(dl.path).ok).toBe(true);
  expect(dl.bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
});
