// A-E2E-6: service-worker update prompt. A "new version" is simulated by changing the bytes of dist/sw.js that the local server serves
// (context.route cannot see the browser's own sw.js update fetch), then restoring it. Chromium only, local server only (needs dist/).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, loadApp, waitForSeal } from "./fixtures";

test.use({ serviceWorkers: "allow" });

const SW = resolve("dist", "sw.js");
const original = readFileSync(SW, "utf8");
test.afterEach(() => writeFileSync(SW, original));

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);

/** Serves a changed sw.js (the build's next version) and asks the browser to check for it. */
async function deploy(page: Page, tag: string): Promise<void> {
  writeFileSync(SW, `${original}
// ${tag}
`);
  await expect.poll(async () => (await page.request.get("/sw.js")).text(), { timeout: 15_000 }).toContain(`// ${tag}`);
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
}

test("A-E2E-6: a new version shows a closable reload prompt that waits for a running job", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "dist/sw.js swap is verified in Chromium only");
  test.setTimeout(90_000);
  await loadApp(page, "/#/merge");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled, so a waiting worker is offered rather than silently installed
  await waitForSeal(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByTestId("update-banner")).toHaveCount(0);

  // a job is running: hold the ops RPC call so the page stays busy until we release it
  await page.getByTestId("file-input").setInputFiles(["plain-3p", "mixed-sizes"].map(corpus));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  await page.evaluate(() => {
    const w = window as unknown as { __release: () => void };
    const proto = Worker.prototype as unknown as { postMessage: (...a: unknown[]) => void };
    const orig = proto.postMessage;
    const held: [Worker, unknown[]][] = [];
    proto.postMessage = function (this: Worker, ...a: unknown[]) {
      const m = a[0];
      if (m && typeof m === "object" && "method" in m) held.push([this, a]);
      else orig.apply(this, a);
    };
    w.__release = () => { proto.postMessage = orig; held.forEach(([wk, a]) => orig.apply(wk, a)); };
  });
  await page.getByTestId("primary-action").click();

  // deploy "a new version"
  await deploy(page, "v2");

  const banner = page.getByTestId("update-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("A new version is ready.");
  // never interrupts the job: Reload is disabled and says why, and nothing reloaded
  await expect(page.getByTestId("update-reload")).toBeDisabled();
  await expect(page.getByTestId("update-note")).toContainText("Finish or cancel your current job first.");
  await page.getByTestId("update-reload").click({ force: true });
  await expect(page.getByTestId("primary-action")).toBeVisible();
  await expect(page.getByTestId("file-row")).toHaveCount(2); // same document, files still there

  // closable with a 44px target
  const x = page.getByTestId("update-dismiss");
  const box = (await x.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  // job finishes: Reload unlocks, and works
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect(page.getByTestId("result-row")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("update-reload")).toBeEnabled();
  await expect(page.getByTestId("update-note")).toBeHidden();
  const nav = page.waitForEvent("framenavigated", (f) => f === page.mainFrame());
  await page.getByTestId("update-reload").click();
  await nav;
  await waitForSeal(page);
  await expect(banner).toHaveCount(0);

  // a second deploy can be dismissed with the X
  await deploy(page, "v3");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("update-dismiss").click();
  await expect(banner).toHaveCount(0);
});
