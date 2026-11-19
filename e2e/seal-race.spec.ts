// D14: Firefox checks a worker's `worker-src` when its script actually loads, not when `new Worker()` is called. A worker that is slow to
// start (a loaded machine, a cold cache) must therefore be running before the seal meta lands, or the seal blocks its own engine.
// The fixture fails any CSP violation, so a delayed pdf.js worker script is the whole test.
import { test, expect, loadApp } from "./fixtures";

test("D14: a slow-starting pdf.js worker does not trip the seal (no worker-src violation)", async ({ page }) => {
  await page.route(/\/assets\/workers\/pdf\.worker-.*\.js/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.fallback();
  });
  await loadApp(page);
  await expect(page.locator("html")).toHaveAttribute("data-sealed", "true");
  await page.waitForTimeout(500); // a late violation would arrive here
});
