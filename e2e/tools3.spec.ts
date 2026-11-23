// Rotate PDF, Crop PDF and PDF to text: each downloads a result that is read back (rotation, CropBox, text).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";

const fixture = resolve("tests/corpus/generated/plain-3p.pdf");
const primary = (page: Page) => page.getByTestId("primary-action");
async function open(page: Page, route: string) {
  await loadApp(page, route);
  await page.getByTestId("file-input").setInputFiles(fixture);
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
}
const download = (page: Page) => downloadAndCheck(page, () => page.getByTestId("result-download").click());

test("rotate: all pages turned right, then only page 2 turned left", async ({ page }) => {
  await open(page, "/#/rotate");
  await expect(page.getByTestId("rot-strip").locator("canvas")).toHaveCount(3);
  await primary(page).click();
  const a = await download(page);
  expect(a.name).toBe("plain-3p-rotated.pdf");
  expect(qpdfCheck(a.path).ok).toBe(true);
  const docA = await PDFDocument.load(a.bytes);
  expect(docA.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90, 90]);

  await page.getByTestId("turn-left").check();
  await page.getByTestId("pages-range").check();
  await page.getByTestId("pages-input").fill("2");
  await primary(page).click();
  const b = await download(page);
  expect((await PDFDocument.load(b.bytes)).getPages().map((p) => p.getRotation().angle)).toEqual([0, 270, 0]);
});

test("crop: margins set CropBox and TrimBox on every page; the note points to Redact", async ({ page }) => {
  await open(page, "/#/crop");
  await expect(primary(page)).toBeDisabled();
  await expect(page.getByTestId("crop-note")).toContainText("still in the file");
  await expect(page.getByTestId("crop-note").getByRole("link", { name: "Redact" })).toBeVisible();
  await page.getByTestId("crop-top").fill("10");
  await page.getByTestId("crop-left").fill("20");
  await expect(page.getByTestId("crop-preview")).toBeVisible();
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  const dl = await download(page);
  expect(dl.name).toBe("plain-3p-cropped.pdf");
  expect(qpdfCheck(dl.path).ok).toBe(true);
  const src = (await PDFDocument.load(readFileSync(fixture))).getPages();
  const out = (await PDFDocument.load(dl.bytes)).getPages();
  const mm = 72 / 25.4;
  out.forEach((p, i) => {
    const m = src[i].getMediaBox();
    const c = p.getCropBox();
    expect(c.x).toBeCloseTo(m.x + 20 * mm, 1);
    expect(c.y + c.height).toBeCloseTo(m.y + m.height - 10 * mm, 1);
    expect(c.width).toBeCloseTo(m.width - 20 * mm, 1);
    expect(p.getTrimBox()).toEqual(c);
  });
});

test("pdf to text: preview, copy and .txt with page separators", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "/#/pdf-to-text");
  await primary(page).click();
  const area = page.getByTestId("ptt-text");
  await expect(area).toBeVisible();
  await expect(area).toHaveValue(/--- Page 1 ---[\s\S]*--- Page 3 ---/);
  const dl = await download(page);
  expect(dl.name).toBe("plain-3p.txt");
  const txt = dl.bytes.toString("utf8");
  expect(txt).toContain("--- Page 2 ---");
  expect(txt.replace(/--- Page \d ---/g, "").trim().length).toBeGreaterThan(0);
  expect(await area.inputValue()).toBe(txt);
  await page.getByTestId("ptt-copy").click();
  await expect(page.getByTestId("ptt-copy")).toHaveText("Copied");
  await expect(page.getByTestId("ptt-scan")).toBeHidden();
});
