// Memory guard: a plain warning with "Try anyway" before a big job on a device with little memory. Never a block.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";
import { test, expect, loadApp } from "./fixtures";

/** A valid 1-page PDF of about 55 MB (one unreferenced-looking padding stream hung off the catalog). */
async function bigPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const pad = doc.context.register(PDFRawStream.of(doc.context.obj({}), new Uint8Array(55 * 1024 * 1024)));
  doc.catalog.set(PDFName.of("Pad"), pad);
  const path = join(mkdtempSync(join(tmpdir(), "mosspdf-mem-")), "big.pdf");
  writeFileSync(path, await doc.save());
  return path;
}

test("A-PERF-2 a big file on a low-memory device warns first; Try anyway runs it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { get: () => 0.5 }));
  await loadApp(page, "/#/compress");
  await page.getByTestId("file-input").setInputFiles(await bigPdf());
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1, { timeout: 60_000 });
  await page.getByTestId("primary-action").click();
  const warn = page.getByTestId("mem-warning");
  await expect(warn).toBeVisible();
  await expect(warn).toContainText("may need about");
  await expect(page.getByTestId("result-row")).toHaveCount(0); // nothing ran
  await page.getByTestId("mem-try-anyway").click();
  await expect(page.getByTestId("result-row").first()).toBeVisible({ timeout: 120_000 });
  await expect(warn).toBeHidden();
});

test("A-PERF-2 a small file never warns", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { get: () => 0.25 }));
  await loadApp(page, "/#/compress");
  await page.getByTestId("file-input").setInputFiles("tests/corpus/generated/plain-3p.pdf");
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("mem-warning")).toBeHidden();
  await expect(page.getByTestId("result-row").first()).toBeVisible({ timeout: 60_000 });
});
