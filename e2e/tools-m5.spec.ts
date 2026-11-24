// M5: OCR. The fixture fails a test on any request after the seal, so "boot on #/ocr, read, save" also proves nothing leaves the page.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck, waitForSeal } from "./fixtures";
import { PDFDocument } from "@cantoo/pdf-lib";
import { readPdf } from "../tests/helpers/qpdf";
import { grayPng, scanGray, skewScan, SCAN_LINES } from "../scripts/scan-image.mjs";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const add = (page: Page, path: string) => page.getByTestId("file-input").setInputFiles([path]);
const SLOW = { timeout: 120_000 };

async function savePdf(page: Page, i = 0) {
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-row").nth(i).getByTestId("result-download").click());
  const check = qpdfCheck(dl.path);
  expect(check.ok, `qpdf --check on ${dl.name}: ${check.output}`).toBe(true);
  return dl;
}

/** The scan fixture tilted 4 degrees on a dark scanner bed, as a one-page image-only PDF. */
async function skewedScan() {
  const doc = await PDFDocument.create();
  const sk = skewScan(scanGray(SCAN_LINES), 4);
  const img = await doc.embedPng(grayPng(sk));
  doc.addPage([sk.w * 0.48, sk.h * 0.48]).drawImage(img, { x: 0, y: 0, width: sk.w * 0.48, height: sk.h * 0.48 });
  return { name: "skewed-scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

test.describe("M5 OCR", () => {
  test.setTimeout(180_000);

  test("A-OCR-5 a crooked scan on a dark bed is straightened and cropped first, and still reads", async ({ page }) => {
    await loadApp(page, "/#/ocr");
    await expect(page.getByTestId("ocr-straighten")).toBeChecked(); // on by default
    await expect(page.getByTestId("ocr-use-cleaned")).not.toBeChecked();
    await page.getByTestId("file-input").setInputFiles([await skewedScan()]);
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
    await page.getByTestId("ocr-use-cleaned").check();
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("results")).toBeVisible(SLOW);
    const pages = await readPdf((await savePdf(page)).bytes);
    for (const w of ["OCR", "FIXTURE", "SCANNED"]) expect(pages[0].text).toContain(w);
  });

  test("A-OCR-1 a scan booted on #/ocr becomes a searchable PDF and a text file, with no request after the seal", async ({ page }) => {
    await loadApp(page, "/#/ocr");
    await expect(page.getByTestId("ocr-missing")).toBeHidden();
    await add(page, corpus("scan-1p"));
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
    await page.getByTestId("ocr-out-txt").check();
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("results")).toBeVisible(SLOW);
    await expect(page.getByTestId("result-row")).toHaveCount(2);
    const pdf = await savePdf(page, 0);
    expect(pdf.name).toBe("scan-1p-searchable.pdf");
    const text = (await readPdf(pdf.bytes))[0].text;
    for (const w of ["OCR", "FIXTURE", "SCANNED"]) expect(text).toContain(w);
    const txt = await downloadAndCheck(page, () => page.getByTestId("result-row").nth(1).getByTestId("result-download").click());
    expect(txt.name).toBe("scan-1p.txt");
    expect(readFileSync(txt.path, "utf8")).toContain("FIXTURE");
  });

  test("A-OCR-2 pages that already have text are skipped by default and the rest is read", async ({ page }) => {
    await loadApp(page, "/#/ocr");
    await add(page, corpus("scan-mixed-2p"));
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
    await page.getByTestId("ocr-clean").check();
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("results")).toBeVisible(SLOW);
    await expect(page.getByTestId("results")).toContainText("page 1");
    const pages = await readPdf((await savePdf(page)).bytes);
    expect(pages[0].text).toContain("PAGE-MARKER t1");
    expect(pages[1].text).toContain("FIXTURE");
  });

  test("A-OCR-3 from another route the sealed page offers to reload with the engine", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await page.evaluate(() => { location.hash = "#/ocr"; });
    await expect(page.getByTestId("view-heading")).toHaveText("Make a scan searchable");
    await expect(page.getByTestId("ocr-missing")).toBeVisible();
    await add(page, corpus("scan-1p"));
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
    await expect(page.getByTestId("ocr-load-clears")).toBeVisible();
    await expect(page.getByTestId("primary-action")).toBeDisabled();
    await Promise.all([page.waitForEvent("load"), page.getByTestId("ocr-load").click()]);
    await waitForSeal(page, 90_000);
    await expect(page.getByTestId("ocr-missing")).toBeHidden();
    await expect(page.getByTestId("file-row")).toHaveCount(0); // the reload cleared the file, as the note said
  });

  test("A-OCR-4 picking Malay with English reloads with those languages and reads the scan", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await page.evaluate(() => { location.hash = "#/ocr"; });
    await expect(page.getByTestId("ocr-lang-eng")).toBeChecked();
    await page.getByTestId("ocr-lang-msa").check();
    await expect(page.getByTestId("ocr-load")).toContainText("Load the OCR engine (about 7 MB");
    await Promise.all([page.waitForEvent("load"), page.getByTestId("ocr-load").click()]);
    await waitForSeal(page, 90_000);
    expect(page.url()).toContain("#/ocr?langs=eng+msa");
    await expect(page.getByTestId("ocr-missing")).toBeHidden();
    await expect(page.getByTestId("ocr-lang-msa")).toBeChecked();
    await page.getByTestId("ocr-lang-tam").check();
    await expect(page.getByTestId("ocr-load")).toContainText("Load these languages");
    await page.getByTestId("ocr-lang-tam").uncheck();
    await add(page, corpus("scan-1p"));
    await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("results")).toBeVisible(SLOW);
    const text = (await readPdf((await savePdf(page)).bytes))[0].text;
    expect(text).toContain("FIXTURE");
  });
});
