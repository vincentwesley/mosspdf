// Smoke spec for the M1 UI (shell, home, merge, organize, split, privacy). m1-e2e owns the shared fixtures; these are local.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "@cantoo/pdf-lib";
import { readFileSync } from "node:fs";

async function pdf(name: string, pages: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 400]).drawText(`${name} ${i + 1}`, { x: 20, y: 340, size: 24 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await d.save()) };
}
const sealed = (p: Page) => p.waitForFunction(() => document.documentElement.dataset.sealed === "true");
const pageCount = async (path: string) => (await PDFDocument.load(readFileSync(path))).getPageCount();

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw e; });
  await page.goto("/");
  await sealed(page);
});

test("home: seal badge, tiles, pending tiles are not links", async ({ page }) => {
  await expect(page.getByTestId("seal-badge")).toContainText("Sealed · 0 requests");
  await expect(page.getByTestId("tile-merge")).toHaveAttribute("href", "#/merge");
  await expect(page.getByTestId("tile-redact")).not.toHaveAttribute("href", /.*/);
  await expect(page.getByTestId("tile-redact")).toContainText("Coming soon");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("drop two PDFs on home: chooser suggests merge, merge downloads one file", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles([await pdf("a.pdf", 2), await pdf("b.pdf", 3)]);
  await expect(page.getByTestId("choose-merge")).toContainText("suggested");
  await page.getByTestId("choose-merge").click();
  await expect(page).toHaveURL(/#\/merge$/);
  await expect(page.getByTestId("view-heading")).toBeFocused();
  await expect(page.getByTestId("file-meta").first()).toHaveText(/2 pages/);
  await page.getByTestId("file-down").first().click(); // keyboard-free reorder: a moves below b
  await expect(page.getByTestId("file-row").first()).toContainText("b.pdf");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("results")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("result-download").click()]);
  expect(await pageCount(await dl.path())).toBe(5);
});

test("organize: rotate, delete, reorder by keyboard, save", async ({ page }) => {
  await page.goto("/#/organize");
  await page.getByTestId("file-input").setInputFiles(await pdf("doc.pdf", 3));
  const cards = page.getByTestId("page-card");
  await expect(cards).toHaveCount(3);
  await cards.first().getByTestId("page-rotate-right").click();
  await cards.nth(1).getByTestId("page-delete").click();
  await expect(cards).toHaveCount(2);
  await cards.first().locator("[data-focus]").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(cards.nth(1).locator(".pg__src")).toHaveText("was 1");
  await page.getByTestId("primary-action").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("result-download").click()]);
  const out = await PDFDocument.load(readFileSync(await dl.path()));
  expect(out.getPageCount()).toBe(2);
  expect(out.getPage(1).getRotation().angle).toBe(90); // original page 1, rotated, moved to the end
});

test("split by ranges shows a live preview and yields one file per range", async ({ page }) => {
  await page.goto("/#/split");
  await page.getByTestId("file-input").setInputFiles(await pdf("doc.pdf", 6));
  await page.getByTestId("range-input").fill("1-2, 4-6");
  await expect(page.getByTestId("split-part")).toHaveCount(2);
  await page.getByTestId("range-input").fill("9");
  await expect(page.getByTestId("range-msg")).toContainText("outside");
  await page.getByTestId("range-input").fill("1-2, 4-6");
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("result-row")).toHaveCount(2);
});

test("privacy dialog opens, lists requests, closes and returns focus", async ({ page }) => {
  const badge = page.getByTestId("seal-badge");
  await badge.click();
  const dlg = page.getByTestId("privacy-dialog");
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId("request-log")).toContainText("before seal");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(badge).toBeFocused();
});

test("a request after the seal is blocked", async ({ page }) => {
  const r = await page.evaluate(() => fetch("/theme-init.js?probe").then(() => "allowed", () => "blocked"));
  expect(r).toBe("blocked");
  await expect(page.getByTestId("seal-badge")).toContainText("1 blocked");
});
