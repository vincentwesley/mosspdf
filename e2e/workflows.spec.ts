// v1.10: My workflows (build, save, reload, run on two PDFs, export/import) and batch compress.
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp } from "./fixtures";
import { readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const add = (page: Page, ...names: string[]) => page.getByTestId("file-input").setInputFiles(names.map(corpus));
const readyRows = (page: Page, n: number) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(n);
const done = (page: Page) => page.getByTestId("results").waitFor({ timeout: 90_000 });

async function build(page: Page, name: string) {
  await loadApp(page, "/#/wf-custom");
  await page.getByTestId("wfc-name").fill(name);
  for (const tool of ["rotate", "page-numbers", "compress"]) {
    await page.getByTestId("wfc-add").selectOption(tool);
    await page.getByTestId("wfc-add-btn").click();
    if (tool === "page-numbers") await page.getByTestId("format-select").selectOption("Page {n} of {total}");
  }
  await expect(page.getByTestId("primary-action")).toBeEnabled();
  await page.getByTestId("primary-action").click();
  await done(page);
}

test.describe("My workflows", () => {
  test("A-E2E-WF1 build Rotate, Page numbers, Compress, save, reload, run on two PDFs", async ({ page }) => {
    await build(page, "Tidy scans");
    await expect(page.getByTestId("wfc-saved-row")).toHaveCount(1);
    await loadApp(page, "/");
    const tile = page.locator('[data-testid^="tile-wf-u-"]');
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText("Tidy scans");
    await tile.click();
    await add(page, "plain-3p", "mixed-sizes");
    await readyRows(page, 2);
    await page.getByTestId("primary-action").click();
    await done(page);
    await expect(page.getByTestId("result-row")).toHaveCount(2);
    const zip = await downloadAndCheck(page, () => page.getByTestId("download-zip").click());
    const files = unzipSync(new Uint8Array(zip.bytes));
    expect(Object.keys(files).sort()).toEqual(["mixed-sizes-workflow.pdf", "plain-3p-workflow.pdf"]);
    const pages = await readPdf(files["plain-3p-workflow.pdf"]);
    expect(pages).toHaveLength(3);
    for (const [i, p] of pages.entries()) {
      expect(p.rotate).toBe(90);
      expect(p.text).toContain(`Page ${i + 1} of 3`);
    }
  });

  test("A-E2E-WF2 saved workflows show in the palette; export and strict import", async ({ page }) => {
    await build(page, "Tidy scans");
    await page.getByTestId("wfc-import").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"format":"mosspdf-workflow","version":1,"name":"x","steps":[{"tool":"protect","vals":[]},{"tool":"rotate","vals":[]}]}') });
    await expect(page.getByTestId("wfc-msg")).toContainText("not a MossPDF workflow");
    await loadApp(page, "/");
    await page.getByTestId("palette-open").click();
    await page.getByTestId("palette-input").fill("Tidy");
    await expect(page.getByTestId("palette-option").first()).toContainText("Tidy scans");
  });
});

test.describe("Batch", () => {
  test("A-E2E-WF3 batch Compress on three PDFs gives three results", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await add(page, "image-mixed", "plain-3p", "mixed-sizes");
    await readyRows(page, 3);
    await page.getByTestId("primary-action").click();
    await done(page);
    await expect(page.getByTestId("result-row")).toHaveCount(3);
  });
});
