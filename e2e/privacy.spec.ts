import { test, expect, waitForSeal } from "./fixtures";

// Keys the app may write: theme, palette, logo form (+ its first-visits hint counter). Opt-in prefs get added here when they exist.
const ALLOWED_KEYS = ["theme", "palette", "logo-form", "logo-hint"];

test("A-NET-5: no cookies, localStorage keys only from the allowlist", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Light theme" }).click(); // exercise the writers
  await page.locator('input[name="logo-form"][value="long"]').check({ force: true }).catch(() => {});
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((k) => !ALLOWED_KEYS.includes(k))).toEqual([]);
});

test("A-NET-2: a full load makes no cross-origin request (enforced by the fixture)", async ({ page, baseURL }) => {
  const origins = new Set<string>();
  page.on("request", (r) => r.url().startsWith("http") && origins.add(new URL(r.url()).origin));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect([...origins]).toEqual([new URL(baseURL!).origin]);
});

test("A-NET-1: no request reaches the network after the seal", async ({ page }) => {
  test.fixme(true, "the placeholder page does not seal yet (M1 UI fires pagehold:sealed); the fixture already enforces it once it does");
  await page.goto("/");
  await waitForSeal(page);
  await page.evaluate(() => fetch("/").catch(() => {})); // negative control belongs in the real flow specs
});
