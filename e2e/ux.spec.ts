// UX batch: result card, next steps, undo, home search and recent tools.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, loadApp } from "./fixtures";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const add = (page: Page, ...paths: string[]) => page.getByTestId("file-input").setInputFiles(paths);
const readyRows = (page: Page, n: number) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(n);

test.describe("UX batch", () => {
  test("result card shows the size line and next steps carry the file into another tool", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await add(page, corpus("plain-3p"), corpus("mixed-sizes"));
    await readyRows(page, 2);
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("result-summary")).toContainText(/→/);
    await page.getByTestId("next-compress").click();
    await expect(page).toHaveURL(/#\/compress$/);
    await expect(page.getByTestId("file-row")).toHaveCount(1);
    await expect(page.getByTestId("file-row")).toContainText("merged");
  });

  test("Clear all can be undone", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("clear-all").click();
    await expect(page.getByTestId("file-row")).toHaveCount(0);
    await page.getByTestId("toast-action").click();
    await readyRows(page, 1);
  });

  test("home search filters tiles and shows recent tools", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await loadApp(page, "/");
    await expect(page.getByTestId("recent-compress")).toBeVisible();
    await page.getByTestId("find-tool").fill("merge");
    await expect(page.getByTestId("tile-merge")).toBeVisible();
    await expect(page.getByTestId("tile-compress")).toBeHidden();
    await page.getByTestId("find-tool").fill("zzzz");
    await expect(page.getByTestId("find-none")).toBeVisible();
  });
});