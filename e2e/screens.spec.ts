// A-E2E-9: screenshots of every M1 view at 375 / 1280 (768 for home), dark and light, into qa-output/screens/ (reviewed manually).
// Chromium only; `npm run pw -- test e2e/screens.spec.ts --project=chromium`.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, loadApp, setTheme, shot, type Theme } from "./fixtures";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const add = (page: Page, ...names: string[]) => page.getByTestId("file-input").setInputFiles(names.map(corpus));
const image = (n: string) => resolve("tests/fixtures/images", n);
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
  { name: "images-to-pdf", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/images-to-pdf"); await p.getByTestId("file-input").setInputFiles([image("exif6-40x20.jpg"), resolve("tests/corpus/generated/photo-small.jpg")]); await expect(p.getByTestId("file-row")).toHaveCount(2); await p.getByTestId("size-a4").check(); } },
  { name: "pdf-to-images", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/pdf-to-images"); await add(p, "plain-3p"); await expect(p.getByTestId("file-meta")).toContainText("3 pages"); await p.getByTestId("format-jpeg").check(); } },
  { name: "compress", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/compress"); await add(p, "image-mixed"); await expect(p.getByTestId("file-meta")).toContainText("pages"); await p.getByTestId("primary-action").click(); await expect(p.getByTestId("result-summary")).toBeVisible(); } },
  { name: "page-numbers", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/page-numbers"); await add(p, "plain-3p"); await expect(p.getByTestId("file-meta")).toContainText("3 pages"); await p.getByTestId("pos-top-right").check(); } },
  { name: "watermark", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/watermark"); await add(p, "plain-3p"); await expect(p.getByTestId("file-meta")).toContainText("3 pages"); await p.getByTestId("wm-text").fill("CONFIDENTIAL"); } },
  { name: "metadata", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/metadata"); await add(p, "plain-3p"); await expect(p.getByTestId("md-title")).toHaveValue("Quarterly notes (made up)"); } },
  { name: "privacy-dialog", widths: [375, 1280], open: async (p) => { await loadApp(p); await p.getByTestId("seal-badge").click(); await expect(p.getByTestId("privacy-dialog")).toBeVisible(); await p.waitForTimeout(500); } },
  { name: "error", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/merge"); await add(p, "renamed-text", "empty", "plain-3p"); await expect(p.locator('[data-testid="file-row"][data-status="error"]')).toHaveCount(2); } },
  { name: "scan-findings", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/safety-scan"); await add(p, "risk-everything"); await expect(p.getByTestId("risky-found")).toBeVisible(); } },
  { name: "protect", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/protect"); await add(p, "plain-3p"); await expect(p.getByTestId("pw-input")).toBeVisible(); await p.getByTestId("pw-input").fill("correct horse"); await p.getByTestId("pw-confirm").fill("correct horse"); await p.getByTestId("more-options").locator("summary").click(); } },
  { name: "unprotect", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/unprotect"); await add(p, "encrypted-aes256"); await expect(p.locator('[data-status="locked"]')).toHaveCount(1); } },
  { name: "repair", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/repair"); await add(p, "truncated"); await p.getByTestId("primary-action").click(); await expect(p.getByTestId("repair-actions")).toBeVisible(); } },
  { name: "fill", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/fill"); await add(p, "forms-2p"); await expect(p.getByTestId("fields-list").getByLabel("full_name")).toBeVisible(); await p.getByTestId("fields-list").getByLabel("full_name").fill("Ana Maria"); await p.waitForTimeout(600); } },
  { name: "sign", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/sign"); await add(p, "plain-3p"); await p.getByTestId("sg-sig-tab-type").click(); await p.getByTestId("sg-sig-name").fill("Ana Maria"); await p.getByTestId("pv-overlay").first().click({ position: { x: 120, y: 200 } }); await expect(p.getByTestId("sg-item")).toHaveCount(1); await p.waitForTimeout(600); } },
  { name: "redact", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/redact"); await add(p, "redact-sample"); await expect(p.getByTestId("rd-status")).toContainText("Found", { timeout: 30_000 }); await p.getByTestId("rd-hitbox").first().waitFor({ state: "attached" }); await p.locator(".vw__page").first().scrollIntoViewIfNeeded(); await p.locator(".vw__page.is-drawn").first().waitFor({ timeout: 20_000 }); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(600); } },
  { name: "photo", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/photo"); await p.getByTestId("file-input").setInputFiles([resolve("tests/corpus/generated/photo-gps.jpg")]); await expect(p.getByTestId("ph-exif")).toContainText("PagerCam"); await p.getByTestId("ph-add").click(); await p.getByTestId("ph-box").waitFor({ state: "attached" }); await p.waitForTimeout(600); } },
  { name: "result-next", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/page-numbers"); await add(p, "plain-3p"); await expect(p.getByTestId("file-meta")).toContainText("3 pages"); await p.getByTestId("primary-action").click(); await expect(p.getByTestId("start-over")).toBeVisible(); } },
  { name: "ocr", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/ocr"); await add(p, "scan-1p"); await p.getByTestId("primary-action").click(); await expect(p.getByTestId("results")).toBeVisible({ timeout: 90_000 }); } },
  { name: "compare-changes", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/compare"); await add(p, "compare-v1", "compare-v2"); await expect(p.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2); await p.getByTestId("primary-action").click(); await expect(p.getByTestId("cmp-change")).toHaveCount(3, { timeout: 60_000 }); await p.waitForTimeout(400); } },
  { name: "compare-overlay", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/compare"); await add(p, "compare-v1", "compare-v2"); await expect(p.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2); await p.getByTestId("primary-action").click(); await expect(p.getByTestId("cmp-change")).toHaveCount(3, { timeout: 60_000 }); await p.getByTestId("cmp-tab-overlay").click(); await expect(p.getByTestId("cmp-ov-status")).toContainText("pixels differ", { timeout: 20_000 }); } },
  { name: "palette", widths: [375, 1280], open: async (p) => { await loadApp(p); await p.getByTestId("palette-open").click(); await p.getByTestId("palette-input").fill("s"); await p.waitForTimeout(500); } },
  { name: "wf-share", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/wf-share"); await add(p, "risk-everything"); await expect(p.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1); await p.getByTestId("primary-action").click(); await p.getByTestId("results").waitFor({ timeout: 60_000 }); await p.waitForTimeout(400); } },
  { name: "a11y-check", widths: [375, 1280], open: async (p) => { await loadApp(p, "/#/a11y-check"); await add(p, "plain-3p"); await p.getByTestId("a11y-summary").waitFor({ timeout: 30_000 }); await p.waitForTimeout(400); } },
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
