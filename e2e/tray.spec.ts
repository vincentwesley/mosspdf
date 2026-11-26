// File tray: files live in memory across routes; chip on home, dimming of files a tool can't use, remove, clear all.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, loadApp } from "./fixtures";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const go = (page: Page, hash: string) => page.evaluate((x) => { location.hash = x; }, hash);

test("tray: files follow you home and into another tool; remove, clear all, dimming", async ({ page }) => {
  await loadApp(page, "/#/merge");
  await page.getByTestId("file-input").setInputFiles([corpus("plain-3p"), corpus("mixed-sizes")]);
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  await expect(page.getByTestId("tray-count")).toHaveText("2 files ready");
  await expect(page.getByTestId("tray")).toContainText("Kept only while this tab is open");

  await go(page, "#/");
  await expect(page.getByTestId("tray-count")).toHaveText("2 files ready");

  await go(page, "#/split");
  await expect(page.getByTestId("file-row")).toHaveCount(1); // single-PDF tool uses the newest
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tray-item"][data-fit="no"]')).toHaveCount(1);
  await expect(page.getByTestId("tray-why")).toContainText("newest");

  await go(page, "#/images-to-pdf"); // PDFs don't fit an image tool
  await expect(page.locator('[data-testid="tray-item"][data-fit="no"]')).toHaveCount(2);
  await expect(page.getByTestId("tray-why").first()).toContainText("pictures");
  await expect(page.getByTestId("file-row")).toHaveCount(0);

  await go(page, "#/merge");
  await expect(page.getByTestId("tray-item")).toHaveCount(0); // a tool's own file list shows the files it uses; the tray lists only the rest
  await go(page, "#/");
  await page.getByTestId("tray-remove").first().click();
  await expect(page.getByTestId("tray-count")).toHaveText("1 file ready");
  await go(page, "#/merge");
  await page.getByTestId("tray-clear").click();
  await expect(page.getByTestId("tray")).toBeHidden();
  await expect(page.getByTestId("file-row")).toHaveCount(0);
});

test("tray: a chained result shows up in the tray", async ({ page }) => {
  await loadApp(page, "/#/merge");
  await page.getByTestId("file-input").setInputFiles([corpus("plain-3p"), corpus("mixed-sizes")]);
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  await page.getByTestId("primary-action").click();
  await page.getByTestId("next-compress").click();
  await expect(page.getByTestId("tray-count")).toHaveText("1 file ready");
  await expect(page.getByTestId("file-row")).toContainText("merged"); // the tool's own list; the tray lists only files a tool leaves out
});
