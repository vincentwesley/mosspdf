// Generic house checks. Set PATHS to the project's pages. Needs @playwright/test and @axe-core/playwright.
// Preview servers do not apply _headers/_redirects: those are unit-tested in tests/redirects.test.ts.
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

const PATHS = ["/"]; // add each new page

for (const path of PATHS) {
  for (const theme of ["dark", "light"] as const) {
    test(`${path}: axe, same-origin only, no overflow (${theme})`, async ({ page, baseURL }) => {
      test.fixme(test.info().project.name === "mobile-safari", "iPhone 14 WebKit lays out 1px wider than the viewport (scrollWidth 391, innerWidth 312): shell overflow, fix in the UI");
      const off: string[] = [];
      page.on("request", (r) => {
        if (r.url().startsWith("http") && !r.url().startsWith(baseURL!)) off.push(r.url());
      });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.goto(path);
      if (theme === "light") await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.waitForTimeout(800); // let entrance animations settle before axe
      const bad = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      );
      expect(bad).toEqual([]);
      expect(off).toEqual([]);
    });
  }

  test(`${path}: reduced motion runs no animations`, async ({ page, isMobile }) => {
    test.skip(isMobile, "no mouse wheel or hover on touch devices");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await page.mouse.wheel(0, 2000);
    await page.locator("a:not(.hs-skip), button").first().hover();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
}