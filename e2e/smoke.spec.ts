// Basic load check plus one real flow, also run against production by `npm run smoke:prod` (set BASE_URL to point it at another deployment).
import { resolve } from "node:path";
import { test, expect, expectNoOverflow, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";

test("A-REL-1: the app loads, has a title and heading", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/MossPDF/i);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("A-E2E-5: no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expectNoOverflow(page);
});

test("A-REL-1: seal, merge two PDFs, qpdf-valid download, zero requests after the seal", async ({ page }) => {
  await loadApp(page, "/#/merge"); // waits for the seal; the fixture fails the test on any request after it
  await page.getByTestId("file-input").setInputFiles(["plain-3p", "mixed-sizes"].map((n) => resolve("tests/corpus/generated", `${n}.pdf`)));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").first().click());
  const check = qpdfCheck(dl.path);
  expect(check.ok, `qpdf --check: ${check.output}`).toBe(true);
  expect(check.output).toContain("No syntax or stream encoding errors");
  await expect(page.getByTestId("seal-badge")).toContainText(/Sealed\W+0 requests/);
});