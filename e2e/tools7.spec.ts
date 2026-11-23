// Bookmarks tool and Merge's per-file bookmarks. Results are read back from the download.
import { resolve } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";
import { readOutlineItems } from "../src/ops/outline";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const primary = (page: Page) => page.getByTestId("primary-action");
const download = (page: Page) => downloadAndCheck(page, () => page.getByTestId("result-download").click());
const outline = async (bytes: Uint8Array) => readOutlineItems(await PDFDocument.load(bytes)).items;

test("bookmarks: edit an existing list, keyboard-reachable buttons, saved with the new order and levels", async ({ page }) => {
  await loadApp(page, "/#/bookmarks");
  await page.getByTestId("file-input").setInputFiles(corpus("outline"));
  await expect(page.getByTestId("bm-row").first()).toBeVisible({ timeout: 20_000 });
  const before = await page.getByTestId("bm-row").count();
  expect(before).toBeGreaterThan(0);

  await page.getByTestId("bm-clear").click();
  await expect(page.getByTestId("bm-row")).toHaveCount(0);
  await page.getByTestId("bm-add").click();
  await page.getByTestId("bm-add").click();
  await expect(page.getByTestId("bm-row")).toHaveCount(2);
  await page.getByTestId("bm-title").nth(0).fill("Café 中文");
  await page.getByTestId("bm-title").nth(1).fill("Second");
  await page.getByTestId("bm-page").nth(1).fill("3");
  await page.getByTestId("bm-in").nth(1).click(); // Second becomes a child of the first
  await expect(page.getByTestId("bm-row").nth(1)).toHaveAttribute("data-level", "1");
  const box = await page.getByTestId("bm-in").first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(47);

  await primary(page).click();
  const r = await download(page);
  expect(r.name).toBe("outline-bookmarks.pdf");
  expect(qpdfCheck(r.path).ok).toBe(true);
  expect(await outline(r.bytes)).toEqual([
    { title: "Café 中文", page: 1, level: 0 },
    { title: "Second", page: 3, level: 1 },
  ]);
});

test("bookmarks: One per page, and a page out of range blocks saving", async ({ page }) => {
  await loadApp(page, "/#/bookmarks");
  await page.getByTestId("file-input").setInputFiles(corpus("plain-3p"));
  await expect(page.getByTestId("bm-note")).toHaveText("No bookmarks yet.", { timeout: 20_000 });
  await page.getByTestId("bm-each").click();
  await expect(page.getByTestId("bm-row")).toHaveCount(3);
  await page.getByTestId("bm-page").first().fill("9");
  await expect(primary(page)).toBeDisabled();
  await page.getByTestId("bm-page").first().fill("2");
  await primary(page).click();
  const r = await download(page);
  expect((await outline(r.bytes)).map((i) => i.page)).toEqual([2, 2, 3]);
});

test("merge: one bookmark per file by default, with the file's own bookmarks nested under it", async ({ page }) => {
  await loadApp(page, "/#/merge");
  await page.getByTestId("file-input").setInputFiles([corpus("plain-3p"), corpus("outline")]);
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  await expect(page.getByTestId("merge-bookmarks")).toBeChecked();
  await primary(page).click();
  const r = await download(page);
  const items = await outline(r.bytes);
  expect(items[0]).toEqual({ title: "plain-3p", page: 1, level: 0 });
  expect(items[1]).toEqual({ title: "outline", page: 4, level: 0 });
  expect(items.length).toBeGreaterThan(2);
  expect(items[2].level).toBe(1);
});
