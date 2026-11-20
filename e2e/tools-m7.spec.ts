// Flow specs for Compare (M7, D18): summary, change list, side by side highlights, overlay, report download (qpdf-checked), identical files, scans.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, expectNoOverflow, loadApp, qpdfCheck, setTheme, type Theme } from "./fixtures";
import { readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const THEMES: Theme[] = ["dark", "light"];
const add = (page: Page, a: string, b: string) => page.getByTestId("file-input").setInputFiles([corpus(a), corpus(b)]);
const compare = async (page: Page, a: string, b: string) => {
  await loadApp(page, "/#/compare");
  await add(page, a, b);
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  await page.getByTestId("primary-action").click();
  await page.getByTestId("cmp-summary").waitFor({ timeout: 60_000 }); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run
};

test.describe("Compare", () => {
  test("A-E2E-1 two versions: summary, change list, side by side highlights, overlay, report", async ({ page }) => {
    await compare(page, "compare-v1", "compare-v2");
    await expect(page.getByTestId("cmp-summary")).toHaveText("3 changes on 2 pages");
    await expect(page.getByTestId("cmp-note")).toContainText("3 pages and the Changed has 2 pages");
    const changes = page.getByTestId("cmp-change");
    await expect(changes).toHaveCount(3);
    await expect(changes.first()).toContainText("Original page 2, Changed page 2");
    await expect(changes.first()).toContainText("Removed: two");
    await expect(changes.first()).toContainText("Added: three");
    await expect(changes.last()).toContainText("Original page 3");
    await expect(changes.last()).toContainText("Removed:");

    // tabs: a real tablist, arrow keys move between tabs
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByTestId("cmp-tab-changes")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("cmp-tab-changes").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("cmp-tab-side")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("cmp-panel-side")).toBeVisible();
    await page.getByTestId("cmp-tab-changes").click();

    // a change opens side by side with its words boxed on both sides
    await changes.first().click();
    await expect(page.getByTestId("cmp-panel-side")).toBeVisible();
    const col = (n: string) => page.getByTestId(`cmp-col-${n}`).getByTestId("cmp-hl");
    await expect(col("original").first()).toBeAttached({ timeout: 20_000 });
    await expect(col("changed").first()).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("cmp-col-original").locator('.cmp__hl[data-change="1"]').first()).toHaveClass(/is-current/);

    // overlay
    await page.getByTestId("cmp-tab-overlay").click();
    await expect(page.getByTestId("cmp-ov-status")).toContainText("pixels differ", { timeout: 20_000 });
    expect(Number(await page.getByTestId("cmp-ov-stage").getAttribute("data-changed"))).toBeGreaterThan(50);
    await page.getByTestId("cmp-ov-fade").fill("80");
    await expect(page.getByTestId("cmp-ov-base")).toHaveCSS("opacity", "0.8");

    // the report (and the .txt when asked for)
    await expect(page.getByTestId("result-summary")).toHaveText("3 changes on 2 pages");
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("compare-v2-comparison.pdf");
    const c = qpdfCheck(dl.path);
    expect(c.ok, `qpdf --check: ${c.output}`).toBe(true);
    const text = (await readPdf(dl.bytes)).map((p) => p.text).join(" ");
    expect(text).toContain("3 changes on 2 pages");
    expect(text).toContain("compare-v1.pdf");
    expect(text).toContain("Removed:");
  });

  test("A-E2E-1 identical text: no differences; a moved picture is reported as a look difference", async ({ page }) => {
    await compare(page, "compare-v1", "compare-v1");
    await expect(page.getByTestId("cmp-summary")).toHaveText("No text differences found");
    await expect(page.getByTestId("cmp-change")).toHaveCount(0);
    await page.getByTestId("start-over").click();
    await page.getByTestId("file-input").setInputFiles([corpus("compare-moved-a"), corpus("compare-moved-b")]);
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("cmp-summary")).toHaveText("No text differences found. The text is the same, but 3 pages look different.", { timeout: 60_000 });
    await page.getByTestId("cmp-tab-overlay").click();
    await expect(page.getByTestId("cmp-ov-status")).toContainText("pixels differ", { timeout: 20_000 });
  });

  test("A-E2E-1 options: ignore case and the text file", async ({ page }) => {
    await loadApp(page, "/#/compare");
    await add(page, "compare-v1", "compare-v2");
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
    await page.getByTestId("cmp-out-txt").check();
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("result-row")).toHaveCount(2, { timeout: 60_000 });
    await expect(page.locator(".out__name").nth(1)).toHaveText("compare-v2-comparison.txt");
    await page.getByTestId("cmp-ignore-case").check();
    await expect(page.getByTestId("compare-view")).toBeHidden(); // changed options: the old view is cleared
  });

  test("A-E2E-1 scans: points to OCR, overlay still works", async ({ page }) => {
    await compare(page, "scan-1p", "scan-1p");
    await expect(page.getByTestId("cmp-scans")).toContainText("These look like scans. Run OCR first");
    await expect(page.getByTestId("cmp-ocr-link")).toHaveAttribute("href", "#/ocr");
    await page.getByTestId("cmp-tab-overlay").click();
    await expect(page.getByTestId("cmp-ov-status")).toContainText("No visible differences", { timeout: 20_000 });
  });

  for (const theme of THEMES) {
    test(`A-E2E-3 axe and overflow with a comparison open (${theme})`, async ({ page }) => {
      await compare(page, "compare-v1", "compare-v2");
      await setTheme(page, theme);
      await checkA11y(page, `compare changes ${theme}`);
      await page.getByTestId("cmp-change").first().click();
      await expect(page.getByTestId("cmp-col-original").getByTestId("cmp-hl").first()).toBeAttached({ timeout: 20_000 });
      await checkA11y(page, `compare side by side ${theme}`);
      await page.getByTestId("cmp-tab-overlay").click();
      await expect(page.getByTestId("cmp-ov-status")).toContainText("pixels differ", { timeout: 20_000 });
      await checkA11y(page, `compare overlay ${theme}`);
      for (const w of [1280, 375, 320]) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.waitForTimeout(250);
        await expectNoOverflow(page);
      }
    });
  }
});
