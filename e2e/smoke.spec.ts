// Basic load check, also used against production by `npm run smoke:prod`.
import { test, expect, expectNoOverflow } from "./fixtures";

test("A-REL-1: the app loads, has a title and heading", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/Pagehold/i);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("A-E2E-5: no horizontal overflow", async ({ page }) => {
  test.fixme(test.info().project.name === "mobile-safari", "iPhone 14 WebKit: scrollWidth 391 vs innerWidth 312 on the placeholder shell");
  await page.goto("/");
  await expectNoOverflow(page);
});
