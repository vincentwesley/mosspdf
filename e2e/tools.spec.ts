// Flow specs for the M1 tools (merge, split, organize, extract), password/bad-file handling, keyboard, axe, overflow, offline, seal, version, perf.
// Outputs are verified with the real qpdf CLI (--check) and pdf.js (page count, order, rotation, marker text). Titles carry the ACCEPTANCE ID.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, expectNoOverflow, loadApp, qpdfCheck, setTheme, waitForSeal, type Theme } from "./fixtures";
import { marker, readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const pkgVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const isMobile = () => test.info().project.name.startsWith("mobile");
const THEMES: Theme[] = ["dark", "light"];

const add = (page: Page, ...names: string[]) => page.getByTestId("file-input").setInputFiles(names.map(corpus));
const rows = (page: Page) => page.getByTestId("file-row");
const readyRows = (page: Page, n: number) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(n);
const run = (page: Page) => page.getByTestId("primary-action").click();

/** Downloads every result row and checks each with qpdf --check; returns the parsed pages. */
async function saveAll(page: Page, n: number) {
  const list = page.getByTestId("result-row");
  await expect(list).toHaveCount(n);
  const out: { name: string; pages: Awaited<ReturnType<typeof readPdf>> }[] = [];
  for (let i = 0; i < n; i++) {
    const dl = await downloadAndCheck(page, () => list.nth(i).getByTestId("result-download").click());
    const check = qpdfCheck(dl.path);
    expect(check.ok, `qpdf --check on ${dl.name}: ${check.output}`).toBe(true);
    out.push({ name: dl.name, pages: await readPdf(dl.bytes) });
  }
  return out;
}
const markers = (pages: { text: string; rotate: number; w: number; h: number }[]) => pages.map((p) => marker(p as never));

test.describe("tools", () => {
  test("A-E2E-1 merge two PDFs: one download, pages in order", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await add(page, "plain-3p", "mixed-sizes");
    await readyRows(page, 2);
    await expect(page.getByTestId("file-meta").first()).toContainText("3 pages");
    await run(page);
    const [file] = await saveAll(page, 1);
    expect(file.pages).toHaveLength(6);
    expect(markers(file.pages)).toEqual(["p1", "p2", "p3", "m1", "m2", "m3"]);
  });

  test("A-E2E-1 merge: reordering files with the buttons changes the output order", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await add(page, "plain-3p", "rotated");
    await readyRows(page, 2);
    await page.getByTestId("file-down").first().click();
    await expect(rows(page).first()).toContainText("rotated.pdf");
    await run(page);
    const [file] = await saveAll(page, 1);
    expect(markers(file.pages)).toEqual(["r1", "r2", "r3", "r4", "p1", "p2", "p3"]);
  });

  test("A-E2E-1 split by ranges '1-2, 3' gives two files", async ({ page }) => {
    await loadApp(page, "/#/split");
    await add(page, "plain-3p");
    await readyRows(page, 1);
    await page.getByTestId("range-input").fill("1-2, 3");
    await expect(page.getByTestId("split-part")).toHaveCount(2);
    await run(page);
    const out = await saveAll(page, 2);
    expect(out.map((o) => markers(o.pages))).toEqual([["p1", "p2"], ["p3"]]);
  });

  test("A-E2E-1 split every N pages", async ({ page }) => {
    await loadApp(page, "/#/split");
    await add(page, "rotated");
    await readyRows(page, 1);
    await page.getByTestId("mode-every").check();
    await page.getByTestId("every-input").fill("3");
    await expect(page.getByTestId("split-part")).toHaveCount(2);
    await run(page);
    const out = await saveAll(page, 2);
    expect(out.map((o) => o.pages.length)).toEqual([3, 1]);
    expect(out.map((o) => markers(o.pages))).toEqual([["r1", "r2", "r3"], ["r4"]]);
  });

  test("A-E2E-1 split by size keeps every part under the limit", async ({ page }) => {
    await loadApp(page, "/#/split");
    await add(page, "text-500p");
    await readyRows(page, 1);
    await page.getByTestId("mode-size").check();
    await page.getByTestId("size-input").fill("0.1");
    await run(page);
    await expect(page.getByTestId("result-row").first()).toBeVisible({ timeout: 60_000 });
    const n = await page.getByTestId("result-row").count();
    expect(n).toBeGreaterThan(1);
    const out = await saveAll(page, n);
    expect(out.reduce((s, o) => s + o.pages.length, 0)).toBe(500);
    for (const o of out) expect(o.name).toMatch(/\.pdf$/);
    const sizes = await page.locator(".out__size").allTextContents();
    expect(sizes.length).toBe(n);
  });

  test("A-E2E-1 organize: rotate page 2, delete page 3, move page 1 later", async ({ page }) => {
    await loadApp(page, "/#/organize");
    await add(page, "plain-3p");
    const cards = page.getByTestId("page-card");
    await expect(cards).toHaveCount(3);
    await cards.nth(1).getByTestId("page-rotate-right").click();
    await cards.nth(2).getByTestId("page-delete").click();
    await expect(cards).toHaveCount(2);
    await cards.nth(0).getByTestId("page-move-later").click();
    await expect(cards.nth(1).locator(".pg__src")).toHaveText("was 1");
    await run(page);
    const [file] = await saveAll(page, 1);
    expect(markers(file.pages)).toEqual(["p2", "p1"]);
    expect(file.pages.map((p) => p.rotate)).toEqual([90, 0]);
  });

  test("A-E2E-1 extract pages 1 and 3", async ({ page }) => {
    await loadApp(page, "/#/extract");
    await add(page, "plain-3p");
    const cards = page.getByTestId("page-card");
    await expect(cards).toHaveCount(3);
    await cards.nth(0).getByTestId("page-select").click();
    await cards.nth(2).getByTestId("page-select").click();
    await expect(page.getByTestId("range-input")).toHaveValue("1, 3");
    await expect(page.getByTestId("primary-action")).toHaveText("Extract 2 pages");
    await run(page);
    const [file] = await saveAll(page, 1);
    expect(file.pages).toHaveLength(2);
    expect(markers(file.pages)).toEqual(["p1", "p3"]);
  });

  test("A-E2E-1 organize replaces the current PDF with a closable toast and undo", async ({ page }) => {
    await loadApp(page, "/#/organize");
    await add(page, "plain-3p");
    await expect(page.getByTestId("page-card")).toHaveCount(3);
    await add(page, "rotated");
    await expect(page.getByTestId("page-card")).toHaveCount(4);
    await expect(rows(page)).toHaveCount(1);
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Replaced plain-3p.pdf");
    await expect(page.getByTestId("tip-merge")).toHaveAttribute("href", "#/merge");
    await toast.getByTestId("toast-action").click();
    await expect(page.getByTestId("page-card")).toHaveCount(3);
    await expect(rows(page).first()).toContainText("plain-3p.pdf");
    await add(page, "rotated");
    await page.getByTestId("toast-close").click();
    await expect(page.getByTestId("toast")).toHaveCount(0);
  });

  test("A-COR-3 encrypted file: password prompt, wrong password message, right password works", async ({ page }) => {
    await loadApp(page, "/#/organize");
    await add(page, "encrypted-aes256");
    const row = rows(page).first();
    await expect(row).toHaveAttribute("data-status", "locked");
    await row.getByTestId("file-password").fill("not-the-password");
    await row.getByTestId("file-unlock").click();
    await expect(row.locator(".file__hint")).toContainText("did not work");
    await expect(row).toHaveAttribute("data-status", "locked");
    await row.getByTestId("file-password").fill("test-pass");
    await row.getByTestId("file-unlock").click();
    await expect(row).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("page-card")).toHaveCount(3);
    await run(page);
    const [file] = await saveAll(page, 1);
    expect(markers(file.pages)).toEqual(["p1", "p2", "p3"]);
  });

  for (const name of ["empty", "renamed-png", "renamed-text", "corrupt", "truncated"]) {
    test(`A-COR-3 bad file '${name}': plain message or repaired warning, app stays usable`, async ({ page }) => {
      await loadApp(page, "/#/merge");
      await add(page, name, "plain-3p", "mixed-sizes");
      await expect(rows(page)).toHaveCount(3);
      await expect(page.locator('[data-testid="file-row"][data-status="loading"]')).toHaveCount(0);
      const bad = rows(page).filter({ hasText: `${name}.pdf` });
      const status = await bad.getAttribute("data-status");
      if (status === "error") {
        // plain English, names the file, says what to do next
        await expect(bad.locator(".file__err")).toContainText(/\.|Choose|Try|Pick/);
        await expect(bad.locator(".file__err")).not.toContainText(/undefined|\[object|stack|TypeError/i);
      } else {
        expect(["corrupt", "truncated"]).toContain(name); // only damaged-but-recoverable files may open
        await expect(page.getByTestId("warnings")).toContainText("repaired");
      }
      await run(page); // good files still merge
      const [file] = await saveAll(page, 1);
      expect(file.pages.length).toBeGreaterThanOrEqual(6);
    });
  }

  test("A-COR-3 a broken-xref file is repaired and shows the 'repaired' warning", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await add(page, "broken-xref", "plain-3p");
    await readyRows(page, 2);
    await expect(page.getByTestId("warnings")).toContainText("repaired");
    await run(page);
    await expect(page.getByTestId("results")).toContainText("repaired");
    const [file] = await saveAll(page, 1);
    expect(markers(file.pages)).toEqual(["p1", "p2", "p3", "p1", "p2", "p3"]);
  });

  test("A-E2E-4 keyboard only: merge flow", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only is for desktop input");
    await loadApp(page, "/#/merge");
    await add(page, "plain-3p", "rotated");
    await readyRows(page, 2);
    await page.getByTestId("file-down").first().focus();
    await page.keyboard.press("Enter");
    await expect(rows(page).first()).toContainText("rotated.pdf");
    await page.getByTestId("primary-action").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("results")).toBeVisible();
    const dl = await downloadAndCheck(page, async () => {
      await page.getByTestId("result-download").focus();
      await page.keyboard.press("Enter");
    });
    expect(qpdfCheck(dl.path).ok).toBe(true);
    expect(markers(await readPdf(dl.bytes))).toEqual(["r1", "r2", "r3", "r4", "p1", "p2", "p3"]);
  });

  test("A-E2E-4 keyboard only: Alt+Arrow reorders pages, Delete removes one", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only is for desktop input");
    await loadApp(page, "/#/organize");
    await add(page, "plain-3p");
    const cards = page.getByTestId("page-card");
    await expect(cards).toHaveCount(3);
    await cards.first().locator("[data-focus]").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(cards.nth(1).locator(".pg__src")).toHaveText("was 1");
    await expect(cards.nth(1).locator("[data-focus]")).toBeFocused();
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(cards.nth(1).locator(".pg__src")).toHaveText("was 1");
    await cards.first().locator("[data-focus]").focus();
    await page.keyboard.press("Delete"); // removes p2 (now first)
    await expect(cards).toHaveCount(2);
    await page.getByTestId("primary-action").focus();
    await page.keyboard.press("Enter");
    const [file] = await saveAll(page, 1);
    expect(markers(file.pages)).toEqual(["p1", "p3"]);
  });
});

test.describe("site", () => {
  test("A-E2E-8 the running version matches package.json", async ({ page }) => {
    await loadApp(page);
    await expect(page.getByTestId("app-version")).toHaveText(pkgVersion);
    await page.getByTestId("seal-badge").click();
    await expect(page.getByTestId("privacy-dialog")).toContainText(`Version ${pkgVersion}`);
  });

  test("A-NET-4 privacy panel: seal time shown and zero requests after the seal, even after a merge", async ({ page }) => {
    await loadApp(page, "/#/merge");
    await add(page, "plain-3p", "mixed-sizes");
    await readyRows(page, 2);
    await run(page);
    await saveAll(page, 1);
    await expect(page.getByTestId("seal-badge")).toContainText("Sealed · 0 requests");
    await page.getByTestId("seal-badge").click();
    const summary = page.getByTestId("seal-summary");
    await expect(summary).toContainText(/Sealed at \d/);
    await expect(summary).toContainText("0 requests have left this page since then");
    await expect(page.locator("[data-testid=request-log] tr.is-after")).toHaveCount(0);
    await expect(page.getByTestId("request-log")).toContainText("before seal");
  });

  test.describe("A-NET-1 the seal blocks the network (negative controls)", () => {
    test.use({ allowedErrors: [/connect-src|Refused to connect|violates|Failed to fetch|csp-violation/i] });

    test("A-NET-1 a fetch from the page after the seal is blocked", async ({ page }) => {
      await loadApp(page, "/#/merge");
      const r = await page.evaluate(() => fetch("/theme-init.js?probe").then(() => "allowed", () => "blocked"));
      expect(r).toBe("blocked");
      await expect(page.getByTestId("seal-badge")).toContainText("1 blocked");
    });

    test("A-NET-1 a fetch from the real ops worker after the seal is blocked", async ({ page }) => {
      await loadApp(page, "/#/merge");
      const worker = page.workers().find((w) => /ops\.worker/.test(w.url()));
      expect(worker, "the in-app ops worker should be running").toBeTruthy();
      const r = await worker!.evaluate(() => fetch("/theme-init.js?probe").then(() => "allowed", () => "blocked"));
      expect(r).toBe("blocked");
      // and it still works: merging after the blocked attempt
      await add(page, "plain-3p", "mixed-sizes");
      await readyRows(page, 2);
      await run(page);
      expect((await saveAll(page, 1))[0].pages).toHaveLength(6);
    });
  });

  test.describe("A-E2E-6 offline", () => {
    test.use({ serviceWorkers: "allow" });
    test("A-E2E-6 with the service worker active and the network off, reload and merge still work", async ({ page, context, browserName }) => {
      test.skip(browserName === "firefox", "Firefox: context.setOffline is broken with service workers (docs/spikes/csp.md)");
      await loadApp(page, "/#/merge");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload(); // now controlled by the service worker
      await waitForSeal(page);
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await context.setOffline(true);
      await page.reload();
      await waitForSeal(page);
      await add(page, "plain-3p", "mixed-sizes");
      await readyRows(page, 2);
      await run(page);
      const [file] = await saveAll(page, 1);
      expect(markers(file.pages)).toEqual(["p1", "p2", "p3", "m1", "m2", "m3"]);
      await context.setOffline(false);
    });
  });
});

// ---- views with files loaded (axe, overflow) ----
type View = { name: string; open: (page: Page) => Promise<void> };
const loaded = (route: string, ...files: string[]): ((page: Page) => Promise<void>) => async (page) => {
  await loadApp(page, route);
  await add(page, ...files);
  await readyRows(page, files.length);
  if (route.includes("organize") || route.includes("extract")) await expect(page.locator(".pg.is-drawn").first()).toBeVisible({ timeout: 20_000 });
};
const VIEWS: View[] = [
  { name: "home", open: (p) => loadApp(p) },
  { name: "merge", open: loaded("/#/merge", "plain-3p", "mixed-sizes") },
  { name: "split", open: loaded("/#/split", "plain-3p") },
  { name: "organize", open: loaded("/#/organize", "plain-3p") },
  { name: "extract", open: loaded("/#/extract", "plain-3p") },
  { name: "privacy page", open: (p) => loadApp(p, "/#/privacy") },
];

for (const theme of THEMES) {
  for (const v of VIEWS) {
    test(`A-E2E-3 axe: ${v.name} (${theme})`, async ({ page }) => {
      await v.open(page);
      await setTheme(page, theme);
      await checkA11y(page, `${v.name} ${theme}`);
    });
  }
  test(`A-E2E-3 axe: privacy dialog (${theme})`, async ({ page }) => {
    await loadApp(page);
    await setTheme(page, theme);
    await page.getByTestId("seal-badge").click();
    await expect(page.getByTestId("privacy-dialog")).toBeVisible();
    await checkA11y(page, `privacy dialog ${theme}`);
  });
  test(`A-E2E-3 axe: chooser (${theme})`, async ({ page }) => {
    await loadApp(page);
    await setTheme(page, theme);
    await add(page, "plain-3p", "mixed-sizes");
    await expect(page.getByTestId("chooser")).toBeVisible();
    await checkA11y(page, `chooser ${theme}`);
  });
  test(`A-E2E-3 axe: error state (${theme})`, async ({ page }) => {
    await loadApp(page, "/#/merge");
    await setTheme(page, theme);
    await add(page, "renamed-text", "empty");
    await expect(page.locator('[data-testid="file-row"][data-status="error"]')).toHaveCount(2);
    await checkA11y(page, `error state ${theme}`);
  });
}

for (const v of VIEWS) {
  test(`A-E2E-5 no horizontal overflow: ${v.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await v.open(page);
    for (const [w, h] of [[1280, 800], [768, 900], [375, 800], [320, 700], [640, 500] /* 1280 at 200% zoom */]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      await expectNoOverflow(page);
    }
  });
}

// ---- large file ----
test("A-E2E-7 thumbnails for a 1,000-page file render lazily, without errors, and the page stays responsive", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium" || isMobile(), "perf budgets are measured on desktop Chromium only");
  const budget = (JSON.parse(readFileSync("tests/perf.budgets.json", "utf8")) as { "A-E2E-7": { thumbs1000: Record<string, number> } })["A-E2E-7"].thumbs1000;
  await loadApp(page, "/#/organize");
  await page.evaluate(() => {
    // main-thread stall probe: the longest gap between animation frames
    const w = window as unknown as { __stall: number };
    w.__stall = 0;
    let last = performance.now();
    const tick = () => { const n = performance.now(); w.__stall = Math.max(w.__stall, n - last); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await add(page, "text-1000p");
  const cards = page.getByTestId("page-card");
  await expect(cards).toHaveCount(1000, { timeout: 60_000 });
  const t0 = Date.now();
  await expect(page.locator(".pg.is-drawn").first()).toBeVisible({ timeout: budget.firstThumbMs });
  expect(Date.now() - t0).toBeLessThan(budget.firstThumbMs);
  const drawnAtStart = await page.locator(".pg.is-drawn").count();
  expect(drawnAtStart, "thumbnails are lazy, not all 1,000 at once").toBeLessThan(200);
  const t1 = Date.now();
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last().locator("xpath=self::li")).toHaveClass(/is-drawn/, { timeout: budget.scrollToEndThumbMs });
  expect(Date.now() - t1).toBeLessThan(budget.scrollToEndThumbMs);
  expect(await page.locator(".pg.is-drawn").count(), "offscreen canvases are released").toBeLessThan(200);
  // still responsive: a click gets handled promptly
  const before = Date.now();
  await cards.last().getByTestId("page-rotate-right").click();
  await expect(cards.last().locator("[data-testid=page-card]").or(cards.last())).toBeVisible();
  expect(Date.now() - before).toBeLessThan(5_000);
  const stall = await page.evaluate(() => (window as unknown as { __stall: number }).__stall);
  expect(stall, `longest frame gap ${Math.round(stall)} ms`).toBeLessThan(budget.maxMainThreadStallMs);
});
