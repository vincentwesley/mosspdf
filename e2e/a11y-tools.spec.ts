// v1.9 a11y pass: axe (wcag2a/2aa/21aa/22aa) on every tool empty and with a file loaded, plus a keyboard walk (Tab reaches every control,
// visible focus, no trap). Chromium only to keep CI time down; dark for tools, one light pass on home.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, loadApp, setTheme } from "./fixtures";
import { TOOLS } from "../src/tools/index";

test.skip(({ browserName }) => browserName !== "chromium", "a11y sweep runs on chromium only");
test.setTimeout(120_000);

const corpus = (n: string) => resolve("tests/corpus/generated", n);
const filesFor = (id: string): string[] => {
  if (["images-to-pdf", "photo"].includes(id)) return ["photo.jpg"];
  if (id === "compare") return ["compare-v1.pdf", "compare-v2.pdf"];
  if (["merge", "wf-apply"].includes(id)) return ["plain-3p.pdf", "forms.pdf"];
  if (id === "fill") return ["forms.pdf"];
  return ["plain-3p.pdf"];
};
async function load(page: Page, id: string) {
  await loadApp(page, `/#/${id}`);
  await expect(page.getByTestId("view-heading")).toBeVisible();
}
async function addFiles(page: Page, id: string) {
  const names = filesFor(id);
  await page.getByTestId("file-input").setInputFiles(names.map(corpus));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(names.length, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

test("home light axe", async ({ page }) => {
  await loadApp(page);
  await setTheme(page, "light");
  await checkA11y(page, "home light");
});

for (const { id } of TOOLS) {
  test(`axe: ${id}`, async ({ page }) => {
    await load(page, id);
    await checkA11y(page, `${id} empty`);
    await addFiles(page, id);
    await checkA11y(page, `${id} loaded`);
  });

  test(`keyboard: ${id}`, async ({ page }) => {
    await load(page, id);
    await addFiles(page, id);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
    const seen: { sel: string; ring: boolean }[] = [];
    let trapped = true;
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        if (!e || e === document.body) return null;
        const cs = getComputedStyle(e);
        const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
        const sr = e.matches(":focus-visible");
        const label = e.getAttribute("data-testid") || e.id || e.tagName.toLowerCase() + ":" + (e.textContent ?? "").trim().slice(0, 20);
        return { sel: label + (e.hasAttribute("data-key") ? "" : ""), ring: ring && sr, uid: (e as unknown as { __u?: number }).__u ?? ((e as unknown as { __u: number }).__u = Math.random()) };
      });
      if (!r) { trapped = false; break; }
      if (seen.some((s) => (s as unknown as { uid: number }).uid === r.uid)) { trapped = false; break; }
      seen.push(r as never);
    }
    expect(trapped, "focus never left or cycled within 300 Tabs").toBe(false);
    expect(seen.filter((s) => !s.ring).map((s) => s.sel), "focused without a visible indicator").toEqual([]);
    const missed = await page.evaluate(() => {
      const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]';
      const groups = new Set<string>();
      return [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => {
        if ((e as HTMLInputElement).disabled || e.getAttribute("tabindex") === "-1" || e.closest("[inert],[hidden]")) return false;
        const det = e.closest("details:not([open])"); if (det && !(e.tagName === "SUMMARY" && e.parentElement === det)) return false;
        const r = e.getBoundingClientRect();
        if (!(r.width && r.height) || getComputedStyle(e).visibility === "hidden") return false;
        const u = (x: Element) => !!(x as unknown as { __u?: number }).__u;
        if (e instanceof HTMLInputElement && e.type === "radio") { if (groups.has(e.name)) return false; groups.add(e.name); return ![...document.getElementsByName(e.name)].some(u); }
        return !u(e);
      }).map((e) => e.getAttribute("data-testid") || e.id || e.outerHTML.slice(0, 120));
    });
    expect(missed, "interactive elements Tab never reached").toEqual([]);
    // a primary that needs more input (password, page list...) stays disabled and says why (primary-why), so it is rightly out of the Tab order
    if (await page.getByTestId("primary-action").isEnabled()) expect(seen.some((s) => s.sel === "primary-action"), "primary action reachable").toBe(true);
    else await expect(page.getByTestId("primary-why")).toBeVisible();
  });
}
