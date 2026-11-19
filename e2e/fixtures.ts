// Every spec imports { test, expect } from here. The extended context fails a test on: console.error, page error, unhandled rejection,
// CSP violation, any cross-origin request (A-NET-2), and any request after `pagehold:sealed` (A-NET-1, measured per docs/spikes/csp.md:
// context.route + serviceWorkers "block"; page.on('request') is unreliable in Chromium).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
      else issue(`${kind}: ${msg}`);
    });
    await context.addInitScript(() => {
      const w = window as unknown as Win;
      document.addEventListener("securitypolicyviolation", (e) => w.__phReport("csp-violation", `${e.violatedDirective} ${e.blockedURI}`), true);
      window.addEventListener("unhandledrejection", (e) => w.__phReport("unhandled-rejection", String(e.reason)));
      window.addEventListener("pagehold:sealed", () => {
        w.__phSealed = true;
        w.__phReport("sealed", "");
      });
    });
    context.on("console", (m) => m.type() === "error" && issue(`console.error: ${m.text()}`));
    context.on("weberror", (e) => issue(`pageerror: ${e.error().message}`));
    context.on("page", (p) => p.on("framenavigated", (f) => f === p.mainFrame() && state.sealed.delete(p)));

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
      if (!leavingApp) {
        if (new URL(url).origin !== origin) issue(`cross-origin request: ${url}`);
        const sealed = page ? state.sealed.has(page) : context.pages().some((p) => state.sealed.has(p));
        if (sealed) issue(`request after seal: ${req.method()} ${url}`);
      }
      await route.continue();
    });

    await use(context);
    expect(state.issues, "console/page errors, CSP violations, cross-origin or post-seal requests").toEqual([]);
  },
});

/** Resolves once the page has fired `pagehold:sealed` (and the fixture has recorded it). Requests from then on fail the test. */
export async function waitForSeal(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(() => (window as unknown as Win).__phSealed === true, undefined, { timeout });
  await expect.poll(() => states.get(page.context())!.sealed.has(page), { timeout }).toBe(true);
}

/** No horizontal overflow at the current viewport. */
export async function expectNoOverflow(page: Page): Promise<void> {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
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
  await page.screenshot({ path, fullPage: true });
  return path;
}

/** Runs `trigger` (the click that starts a download), saves the file to a fresh temp dir. */
export async function downloadAndCheck(page: Page, trigger: () => Promise<unknown>): Promise<{ path: string; bytes: Buffer; name: string }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = join(mkdtempSync(join(tmpdir(), "pagehold-dl-")), dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, bytes: readFileSync(path), name: dl.suggestedFilename() };
}

function qpdfBin(): string {
  if (process.env.QPDF_BIN) return process.env.QPDF_BIN;
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (git.status === 0) {
    const bundled = join(dirname(git.stdout.trim()), "tools", "qpdf", "bin", process.platform === "win32" ? "qpdf.exe" : "qpdf");
    if (existsSync(bundled)) return bundled;
  }
  return "qpdf";
}

/** `qpdf --check`; ok only on exit 0 (warnings, exit 3, count as not ok). */
export function qpdfCheck(path: string): { ok: boolean; output: string } {
  const r = spawnSync(qpdfBin(), ["--check", path], { encoding: "utf8" });
  if (r.error) throw new Error(`qpdf not runnable (${r.error.message}); set QPDF_BIN`);
  return { ok: r.status === 0, output: r.stdout + r.stderr };
}
