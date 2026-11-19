// A-E2E-9: screenshots of every M1 view at 375 / 1280 (768 for home), dark and light, into qa-output/screens/ (reviewed manually).
// Chromium only; `npm run pw -- test e2e/screens.spec.ts --project=chromium`.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, loadApp, setTheme, shot, type Theme } from "./fixtures";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const add = (page: Page, ...names: string[]) => page.getByTestId("file-input").setInputFiles(names.map(corpus));
const drawn = async (page: Page) => {
  await page.locator(".pg.is-drawn").first().waitFor({ timeout: 20_000 }); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run
  await page.waitForTimeout(600);
};

const SCENES: { name: string; widths: number[]; open: (p: Page) => Promise<void> }[] = [
  { name: "home", widths: [375, 768, 1280], open: (p) => loadApp(p) },
  { name: "chooser", widths: [375, 1280], open: async (p) => { await loadApp(p); await add(p, "plain-3p", "mixed-sizes"); await expect(p.getByTestId("chooser")).toBeVisible(); await p.waitForTimeout(500); } },
  { name: "merge", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/merge"); await add(p, "plain-3p", "mixed-sizes"); await expect(p.getByTestId("file-meta").nth(1)).toContainText("pages"); } },
  { name: "merge-pages", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/merge"); await add(p, "plain-3p", "mixed-sizes"); await expect(p.getByTestId("file-meta").nth(1)).toContainText("pages"); await p.getByTestId("edit-pages").click(); await drawn(p); } },
  { name: "split", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/split"); await add(p, "plain-3p"); await p.getByTestId("range-input").fill("1-2, 3"); await expect(p.getByTestId("split-part")).toHaveCount(2); } },
  { name: "organize", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/organize"); await add(p, "rotated"); await drawn(p); } },
  { name: "extract", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/extract"); await add(p, "plain-3p"); await drawn(p); await p.getByTestId("page-select").first().click(); } },
  { name: "privacy-dialog", widths: [375, 1280], open: async (p) => { await loadApp(p); await p.getByTestId("seal-badge").click(); await expect(p.getByTestId("privacy-dialog")).toBeVisible(); await p.waitForTimeout(500); } },
  { name: "error", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/merge"); await add(p, "renamed-text", "empty", "plain-3p"); await expect(p.locator('[data-testid="file-row"][data-status="error"]')).toHaveCount(2); } },
  { name: "locked", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/organize"); await add(p, "encrypted-aes256"); await expect(p.locator('[data-status="locked"]')).toHaveCount(1); } },
];

for (const scene of SCENES) {
  for (const theme of ["dark", "light"] as Theme[]) {
    test(`A-E2E-9 screenshot ${scene.name} (${theme})`, async ({ page }) => {
      test.skip(test.info().project.name !== "chromium", "screenshots are taken in desktop Chromium");
      for (const w of scene.widths) {
        await page.setViewportSize({ width: w, height: w < 600 ? 800 : 900 });
        await scene.open(page);
        await setTheme(page, theme);
        await page.waitForTimeout(300);
        // the project name prefixes the file; encode the width in the name
        await shot(page, `${scene.name}-${w}`);
        await page.reload();
        await page.evaluate(() => (location.hash = "#/"));
      }
    });
  }
}
