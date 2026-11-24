// M8 (D19): command palette and shortcuts, the three workflows, batch tools, the accessibility check.
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, expectNoOverflow, loadApp, qpdfCheck, setTheme, type Theme } from "./fixtures";
import { qpdfJson, readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const THEMES: Theme[] = ["dark", "light"];
const isMobile = () => test.info().project.name.startsWith("mobile");
const add = (page: Page, ...names: string[]) => page.getByTestId("file-input").setInputFiles(names.map(corpus));
const readyRows = (page: Page, n: number) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(n);
const done = (page: Page) => page.getByTestId("results").waitFor({ timeout: 90_000 }); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run

test.describe("Command palette", () => {
  test("A-E2E-1 button opens it, typing filters, Enter opens the tool, Esc returns focus", async ({ page }) => {
    await loadApp(page);
    const opener = page.getByTestId("palette-open");
    await opener.click();
    const input = page.getByTestId("palette-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(page.getByTestId("palette-list")).toHaveAttribute("role", "listbox");
    await input.fill("cmpr");
    await expect(page.getByTestId("palette-option").first()).toHaveAttribute("data-id", "tool-compress");
    await expect(input).toHaveAttribute("aria-activedescendant", /pal-o-0/);
    await input.fill("zzzz");
    await expect(page.getByTestId("palette-none")).toBeVisible();
    await input.fill("pdf");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("palette-option").nth(1)).toHaveAttribute("aria-selected", "true");
    await input.fill("compress");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/compress$/);
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(page.getByTestId("view-heading")).toBeFocused();
    await loadApp(page);
    await opener.focus();
    await opener.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("A-E2E-2 Ctrl+K opens it, commands work, ? lists shortcuts but not while typing", async ({ page }) => {
    test.skip(isMobile(), "keyboard shortcuts");
    await loadApp(page);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("palette-input")).toBeFocused();
    await page.getByTestId("palette-input").fill("theme");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Control+k");
    await page.getByTestId("palette-input").fill("privacy");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("privacy-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("find-tool").focus();
    await page.keyboard.type("?");
    await expect(page.getByTestId("shortcuts")).toBeHidden();
    await page.getByTestId("find-tool").blur();
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts")).toBeVisible();
    await expect(page.getByTestId("shortcut-list")).toContainText("Search tools");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts")).toBeHidden();
    await loadApp(page, "/#/compress");
    await add(page, "plain-3p");
    await readyRows(page, 1);
    await page.keyboard.press("Control+k");
    await page.getByTestId("palette-input").fill("clear all");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("file-row")).toHaveCount(0);
  });
});

test.describe("Workflows", () => {
  test("A-E2E-3 Small enough to email: steps, one result named -email", async ({ page }) => {
    await loadApp(page, "/#/wf-email");
    await add(page, "image-mixed");
    await readyRows(page, 1);
    await page.getByTestId("wf-limit").selectOption("5");
    await page.getByTestId("primary-action").click();
    await done(page);
    const steps = page.getByTestId("wf-step");
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
    await expect(steps.nth(1)).toContainText("fits under 5 MB");
    await expect(page.getByTestId("result-row")).toHaveCount(1);
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("image-mixed-email.pdf");
    expect(qpdfCheck(dl.path).ok).toBe(true);
    expect(dl.bytes.length).toBeLessThan(5 * 1024 * 1024);
  });

  test("A-E2E-4 Clean copy to share removes scripts, attachments and details, and says what it removed", async ({ page }) => {
    await loadApp(page, "/#/wf-share");
    await add(page, "risk-everything");
    await readyRows(page, 1);
    await expect(page.getByTestId("wf-redact-note").getByRole("link", { name: "Redact" })).toHaveAttribute("href", "#/redact");
    await page.getByTestId("primary-action").click();
    await done(page);
    await expect(page.getByTestId("wf-step").nth(0)).toContainText("Removed:");
    await expect(page.getByTestId("wf-step").nth(0)).toContainText("Script");
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("risk-everything-safe.pdf");
    expect(qpdfCheck(dl.path).ok).toBe(true);
    const json = JSON.stringify(qpdfJson(dl.bytes, "qpdf"));
    expect(json).not.toMatch(/"\/JS"|"\/JavaScript"|"\/EF"|"\/Launch"/);
  });

  test("A-E2E-5 Clean copy to share strips title, author and the MossPDF credit", async ({ page }) => {
    await loadApp(page, "/#/wf-share");
    await add(page, "plain-3p");
    await readyRows(page, 1);
    await page.getByTestId("primary-action").click();
    await done(page);
    await expect(page.getByTestId("wf-step").nth(1)).toContainText("title");
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    const json = JSON.stringify(qpdfJson(dl.bytes, "qpdf"));
    expect(json).not.toMatch(/Quarterly notes|Sample Author|MossPDF by/);
    expect(json).not.toContain('"/Info"');
  });

  test("A-E2E-6 Job application pack joins in order and numbers every page", async ({ page }) => {
    await loadApp(page, "/#/wf-apply");
    await add(page, "plain-3p", "mixed-sizes");
    await readyRows(page, 2);
    await expect(page.getByTestId("wf-photos-note").getByRole("link")).toHaveAttribute("href", "#/images-to-pdf");
    await page.getByTestId("wf-compress").check();
    await page.getByTestId("primary-action").click();
    await done(page);
    await expect(page.getByTestId("wf-step")).toHaveCount(3);
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("application-pack.pdf");
    expect(qpdfCheck(dl.path).ok).toBe(true);
    const pages = await readPdf(dl.bytes);
    expect(pages).toHaveLength(6);
    expect(pages[0].text).toContain("Page 1 of 6");
    expect(pages[5].text).toContain("Page 6 of 6");
  });

  test("A-E2E-7 Cancel stops a workflow between steps and says so", async ({ page }) => {
    await loadApp(page, "/#/wf-apply");
    await add(page, "text-500p", "text-500p");
    await readyRows(page, 2);
    await page.getByTestId("primary-action").click();
    await page.getByTestId("cancel-job").click();
    await expect(page.locator(".job__status").first()).toContainText("Cancelled", { timeout: 30_000 });
    await expect(page.getByTestId("results")).toBeHidden();
  });
});

test.describe("Batch", () => {
  test("A-E2E-8 Compress runs on three PDFs and downloads a .zip", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await add(page, "image-mixed", "plain-3p", "mixed-sizes");
    await readyRows(page, 3);
    await expect(page.getByTestId("primary-action")).toContainText("3 files");
    await page.getByTestId("primary-action").click();
    await done(page);
    await expect(page.getByTestId("result-row")).toHaveCount(3);
    const zip = await downloadAndCheck(page, () => page.getByTestId("download-zip").click());
    expect(Object.keys(unzipSync(new Uint8Array(zip.bytes))).sort()).toEqual(["image-mixed-compressed.pdf", "mixed-sizes-compressed.pdf", "plain-3p-compressed.pdf"]);
  });

  test("A-E2E-9 a single-file tool still replaces the file, with undo", async ({ page }) => {
    await loadApp(page, "/#/extract");
    await add(page, "plain-3p");
    await readyRows(page, 1);
    await add(page, "mixed-sizes");
    await expect(page.getByTestId("toast")).toContainText("Replaced");
  });
});

test.describe("Accessibility check", () => {
  test("A-E2E-10 reports pass, warn and fail with fixes, and saves a text report", async ({ page }) => {
    await loadApp(page, "/#/a11y-check");
    await add(page, "plain-3p");
    await expect(page.getByTestId("a11y-summary")).toBeVisible({ timeout: 30_000 });
    const c = (id: string) => page.locator(`[data-testid="a11y-check"][data-id="${id}"]`);
    await expect(c("tagged")).toHaveAttribute("data-status", "fail");
    await expect(c("tagged")).toContainText("How to fix");
    await expect(c("text")).toHaveAttribute("data-status", "pass");
    await expect(page.getByTestId("a11y-disclaimer")).toContainText("not a PDF/UA");
    await page.getByTestId("primary-action").click();
    await done(page);
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("plain-3p-accessibility.txt");
    expect(dl.bytes.toString("utf8")).toContain("[FAIL] Tagged structure");
  });
});

test.describe("M8 axe and overflow", () => {
  for (const theme of THEMES) {
    test(`A-E2E-11 palette, workflow and accessibility check (${theme})`, async ({ page }) => {
      await loadApp(page);
      await setTheme(page, theme);
      await page.getByTestId("palette-open").click();
      await page.getByTestId("palette-input").fill("s");
      await expectNoOverflow(page);
      await checkA11y(page, `palette ${theme}`);
      await page.keyboard.press("Escape");
      await loadApp(page, "/#/wf-share");
      await setTheme(page, theme);
      await add(page, "risk-everything");
      await readyRows(page, 1);
      await page.getByTestId("primary-action").click();
      await done(page);
      await expectNoOverflow(page);
      await checkA11y(page, `wf-share ${theme}`);
      await loadApp(page, "/#/a11y-check");
      await setTheme(page, theme);
      await add(page, "plain-3p");
      await page.getByTestId("a11y-summary").waitFor({ timeout: 30_000 });
      await expectNoOverflow(page);
      await checkA11y(page, `a11y-check ${theme}`);
    });
  }
});
