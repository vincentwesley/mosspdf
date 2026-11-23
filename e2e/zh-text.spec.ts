// D24: optional Simplified Chinese font. Off by default; the footer switch reloads the tab so the font loads before the seal.
import { resolve } from "node:path";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck, waitForSeal } from "./fixtures";
import { readPdf } from "../tests/helpers/qpdf";

test("D24 watermark: Chinese text is offered, then turned on, downloads and re-opens", async ({ page }) => {
  await loadApp(page, "/#/watermark");
  await expect(page.getByTestId("zh-toggle")).toHaveValue("off");
  await page.getByTestId("wm-text").fill("机密文件");
  await expect(page.getByTestId("wm-text-msg")).toContainText("\"Extra text\"");
  await Promise.all([page.waitForEvent("load"), page.getByTestId("zh-toggle").selectOption("sc")]);
  await waitForSeal(page); // the font is fetched before this; the fixture fails the test on any request after it
  await expect(page.getByTestId("zh-toggle")).toHaveValue("sc");
  await page.getByTestId("file-input").setInputFiles(resolve("tests/corpus/generated/plain-3p.pdf"));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await page.getByTestId("wm-text").fill("机密文件");
  await expect(page.getByTestId("wm-text-msg")).toHaveText("");
  await page.getByTestId("primary-action").click();
  const { path, bytes } = await downloadAndCheck(page, () => page.getByTestId("result-row").first().getByTestId("result-download").click());
  expect(qpdfCheck(path).ok).toBe(true);
  for (const p of await readPdf(bytes)) expect(p.text).toContain("机密文件");
});

test("D30 Japanese: choose it, reload, Watermark takes Japanese; Simplified-only gate follows", async ({ page }) => {
  await loadApp(page, "/#/watermark");
  await Promise.all([page.waitForEvent("load"), page.getByTestId("zh-toggle").selectOption("jp")]);
  await waitForSeal(page); // font fetched before the seal; any later request fails the test
  await expect(page.getByTestId("zh-toggle")).toHaveValue("jp");
  await page.getByTestId("file-input").setInputFiles(resolve("tests/corpus/generated/plain-3p.pdf"));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await page.getByTestId("wm-text").fill("機密 こんにちは");
  await expect(page.getByTestId("wm-text-msg")).toHaveText("");
  await page.getByTestId("wm-text").fill("안녕");
  await expect(page.getByTestId("wm-text-msg")).toContainText("Extra text");
  await page.getByTestId("wm-text").fill("機密 こんにちは");
  await page.getByTestId("primary-action").click();
  const { path, bytes } = await downloadAndCheck(page, () => page.getByTestId("result-row").first().getByTestId("result-download").click());
  expect(qpdfCheck(path).ok).toBe(true);
  for (const p of await readPdf(bytes)) expect(p.text.replace(/\s/g, "")).toContain("機密こんにちは");
});
