// The home map stays compact on phones: two tiles per row, short page, dropzone first, 48px targets, dashed non-link "Coming soon" tiles.
import { test, expect, checkA11y, expectNoOverflow, loadApp, setTheme, type Theme } from "./fixtures";

const WIDTHS = [320, 375, 768, 1280];

for (const theme of ["dark", "light"] as Theme[]) {
  test(`A-E2E-10 home is compact on small screens (${theme})`, async ({ page }) => {
    test.skip(test.info().project.name !== "chromium", "layout is engine-independent; Chromium is enough");
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      await loadApp(page);
      await setTheme(page, theme);
      await expectNoOverflow(page);

      const tiles = page.locator(".tiles .tile__in");
      const boxes = await tiles.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: r.width, h: r.height }; }));
      expect(boxes.length).toBeGreaterThanOrEqual(16);
      if (w <= 640) {
        expect(new Set(boxes.map((b) => b.x)).size, `two tile columns at ${w}px`).toBe(2);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(height, `home height at ${w}px`).toBeLessThan(3000) // was ~4,200 at 375px with one tile per row;
      }
      for (const b of boxes) expect(b.h, "tile tap height").toBeGreaterThanOrEqual(48);

      // dropzone first, then the tools
      const dz = await page.locator(".dz").first().boundingBox();
      expect(dz!.y).toBeLessThan(boxes[0].y);

      // planned tiles stay dashed and are not links
      const pending = page.locator(".tile__in.hs-pending").first();
      expect(await pending.evaluate((e) => e.tagName)).not.toBe("A");
      expect(await pending.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("dashed");
      await expect(pending.locator("a")).toHaveCount(0);
      await expect(pending).toContainText("Coming soon");
      if (w === 320 || w === 375) await checkA11y(page, `home ${theme} ${w}px`);
    }
  });
}
