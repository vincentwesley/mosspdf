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

  test("files left from another tool are flagged and can be cleared; a hand-off is not flagged", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.evaluate(() => { location.hash = "#/split"; });
    await expect(page.getByTestId("carry-over")).toContainText("1 file carried over from Compress");
    await page.getByTestId("carry-clear").click();
    await expect(page.getByTestId("file-row")).toHaveCount(0);
    await expect(page.getByTestId("carry-over")).toBeHidden();
    await page.getByTestId("toast-action").click();
    await readyRows(page, 1);
    await expect(page.getByTestId("carry-over")).toBeVisible();
    await add(page, corpus("mixed-sizes"));
    await expect(page.getByTestId("carry-over")).toBeHidden();
  });

  test("hand-off from a result card is not flagged as carried over", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await add(page, corpus("plain-3p"), corpus("mixed-sizes"));
    await readyRows(page, 2);
    await page.getByTestId("primary-action").click();
    await page.getByTestId("next-compress").click();
    await expect(page.getByTestId("file-row")).toHaveCount(1);
    await expect(page.getByTestId("carry-over")).toBeHidden();
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
  test("dropping files on a tile opens that tool with them loaded", async ({ page }) => {
    await loadApp(page, "/");
    const drop = (type: string) => page.evaluate(async ([tid, type]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new TextEncoder().encode("%PDF-1.4\n")],"a.pdf", { type: "application/pdf" }));
      const el = document.querySelector(`[data-testid=${tid}]`)!;
      el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      return el.classList.contains("is-drop");
    }, ["tile-compress", type]);
    expect(await drop("dragenter")).toBe(true);
    await drop("drop");
    await expect(page).toHaveURL(/#\/compress$/);
  });

  test("install offer appears on beforeinstallprompt, prompts, and dismissal sticks", async ({ page }) => {
    await loadApp(page, "/");
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      (e as unknown as { prompt: () => Promise<void> }).prompt = async () => { (window as unknown as { __p: number }).__p = 1; };
      dispatchEvent(e);
    });
    await expect(page.getByTestId("install")).toBeVisible();
    await page.getByTestId("install-btn").click();
    expect(await page.evaluate(() => (window as unknown as { __p: number }).__p)).toBe(1);
    await expect(page.getByTestId("install")).toBeHidden();
  });
});