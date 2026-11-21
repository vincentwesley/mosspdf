// Every spec imports { test, expect } from here. The extended context fails a test on: console.error, page error, unhandled rejection,
// CSP violation, any cross-origin request (A-NET-2), and any request after `mosspdf:sealed` (A-NET-1, measured per docs/spikes/csp.md:
// context.route + serviceWorkers "block"; page.on('request') is unreliable in Chromium).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { qpdfBin } from "../scripts/qpdf-bin.mjs";

export { expect };
export type Theme = "dark" | "light";

type State = { sealed: WeakSet<Page>; issues: string[] };
const states = new WeakMap<BrowserContext, State>();
type Win = Record<string, unknown> & { __phReport: (k: string, m: string) => void };

export const test = base.extend<{ allowedErrors: RegExp[] }>({
  /** Console/page error messages matching these are ignored (use sparingly, per test). */
  allowedErrors: [[], { option: true }],
  context: async ({ context, baseURL, allowedErrors }, use) => {
    const state: State = { sealed: new WeakSet(), issues: [] };
    states.set(context, state);
    const issue = (m: string) => {
      if (!allowedErrors.some((re) => re.test(m))) state.issues.push(m);
    };
    const origin = new URL(baseURL!).origin;

    await context.exposeBinding("__phReport", ({ page }, kind: string, msg: string) => {
      if (kind === "sealed") state.sealed.add(page);
      else if (kind === "doc-start") state.sealed.delete(page); // every new document (also ones a service worker answers) starts unsealed
      else issue(`${kind}: ${msg}`);
    });
    await context.addInitScript(() => {
      const w = window as unknown as Win;
      if (window.top === window) w.__phReport("doc-start", "");
      document.addEventListener("securitypolicyviolation", (e) => w.__phReport("csp-violation", `${e.violatedDirective} ${e.blockedURI} @${e.sourceFile}:${e.lineNumber} sealed=${(w as unknown as {__phSealed?: boolean}).__phSealed ?? false} t=${Math.round(performance.now())}`), true);
      window.addEventListener("unhandledrejection", (e) => w.__phReport("unhandled-rejection", String(e.reason)));
      window.addEventListener("mosspdf:sealed", () => {
        w.__phSealed = true;
        w.__phReport("sealed", "");
      });
    });
    context.on("console", (m) => m.type() === "error" && issue(`console.error: ${m.text()}`));
    context.on("weberror", (e) => issue(`pageerror: ${e.error().message}`));

    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      let page: Page | undefined;
      try {
        page = req.frame().page();
      } catch {
        /* worker request: no frame */
      }
      const leavingApp = req.isNavigationRequest() && page && req.frame() === page.mainFrame();
      if (leavingApp) state.sealed.delete(page!); // a new document is unsealed until it fires the event again (hash navigation keeps the seal)
      else {
        if (new URL(url).origin !== origin) issue(`cross-origin request: ${url}`);
        const sealed = page ? state.sealed.has(page) : context.pages().some((p) => state.sealed.has(p));
        // the service worker's own fetches (precache, network-first navigation) are not page traffic; ops/pdf.js workers still are
        if (sealed && !req.serviceWorker()) issue(`request after seal: ${req.method()} ${url}`);
      }
      await route.continue();
    });

    await use(context);
    expect(state.issues, "console/page errors, CSP violations, cross-origin or post-seal requests").toEqual([]);
  },
});

/** Resolves once the page has fired `mosspdf:sealed` (and the fixture has recorded it). Requests from then on fail the test. */
export async function waitForSeal(page: Page, timeout = 45_000): Promise<void> {
  await page.waitForFunction(() => (window as unknown as Win).__phSealed === true, undefined, { timeout });
  await expect.poll(() => states.get(page.context())!.sealed.has(page), { timeout }).toBe(true);
}

/** Opens an app route and waits for the seal: every flow test starts here, so the fixture polices all traffic after it. */
export async function loadApp(page: Page, route = "/"): Promise<void> {
  await page.goto(route);
  await waitForSeal(page);
}

/** No horizontal overflow at the current viewport.
 *  Measured against the layout width of <html>, not clientWidth: Playwright's iPhone WebKit on a display-scaled Windows machine reports
 *  clientWidth 312 while the page lays out at 390 (a bare page gives scrollWidth 391 too), so clientWidth is not comparable there. 1px tolerance for that rounding. */
export async function expectNoOverflow(page: Page): Promise<void> {
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.getBoundingClientRect().width }));
  expect(sw, `scrollWidth ${sw} > layout width ${w}`).toBeLessThanOrEqual(Math.ceil(w) + 1);
}

/** axe (wcag2a/2aa/21aa/22aa); fails on any violation with a readable summary. */
export async function checkA11y(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(800); // entrance animations
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`);
  expect(summary, `axe violations on "${name}"`).toEqual([]);
}

/** Switches theme the way the app stores it (localStorage "theme" + data-theme on <html>). */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem("theme", t);
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Writes qa-output/screens/<project>-<theme>-<name>.png (project = Playwright project; theme read from the page). */
export async function shot(page: Page, name: string): Promise<string> {
  const theme = (await page.locator("html").getAttribute("data-theme")) ?? "dark";
  const dir = resolve("qa-output", "screens");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${test.info().project.name}-${theme}-${name}.png`);
  // The sticky action bar and skip link would be stamped over a full-page capture: neutralise them for the shot (CSSOM, allowed by the CSP).
  await page.evaluate(() => document.querySelectorAll<HTMLElement>(".actionbar").forEach((e) => (e.style.position = "static")));
  await page.screenshot({ path, fullPage: true });
  await page.evaluate(() => document.querySelectorAll<HTMLElement>(".actionbar").forEach((e) => (e.style.position = "")));
  return path;
}

/** Runs `trigger` (the click that starts a download), saves the file to a fresh temp dir. */
export async function downloadAndCheck(page: Page, trigger: () => Promise<unknown>): Promise<{ path: string; bytes: Buffer; name: string }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = join(mkdtempSync(join(tmpdir(), "mosspdf-dl-")), dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, bytes: readFileSync(path), name: dl.suggestedFilename() };
}

/** `qpdf --check`; ok only on exit 0 (warnings, exit 3, count as not ok). */
export function qpdfCheck(path: string): { ok: boolean; output: string } {
  const r = spawnSync(qpdfBin(), ["--check", path], { encoding: "utf8" });
  if (r.error) throw new Error(`qpdf not runnable (${r.error.message}); set QPDF_BIN`);
  return { ok: r.status === 0, output: r.stdout + r.stderr };
}
