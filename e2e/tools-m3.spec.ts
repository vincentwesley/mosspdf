// Flow specs for the M3 tools: add password, remove password, safety scan + cleaned copy, repair. Outputs are checked with the real qpdf CLI.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, loadApp, qpdfCheck, setTheme, type Theme } from "./fixtures";
import { qpdfCli, showEncryption } from "../tests/helpers/m3";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const isMobile = () => test.info().project.name.startsWith("mobile");
const THEMES: Theme[] = ["dark", "light"];

const add = (page: Page, ...paths: string[]) => page.getByTestId("file-input").setInputFiles(paths);
const addFixture = (page: Page, name: string) => add(page, corpus(name));
const ready = (page: Page) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
const unlock = async (page: Page, pw: string) => {
  const row = page.getByTestId("file-row").first();
  await expect(row).toHaveAttribute("data-status", "locked");
  await row.getByTestId("file-password").fill(pw);
  await row.getByTestId("file-unlock").click();
  await ready(page);
};
const primary = (page: Page) => page.getByTestId("primary-action");
const KINDS = ["javascript", "open-action", "additional-actions", "launch", "embedded-file", "file-attachment", "submit-form", "import-data", "uri", "go-to-remote", "go-to-embedded", "rich-media", "xfa"];

async function protectWith(page: Page, pw: string) {
  await loadApp(page, "/#/protect");
  await addFixture(page, "plain-3p");
  await ready(page);
  await page.getByTestId("pw-input").fill(pw);
  await page.getByTestId("pw-confirm").fill(pw);
  await primary(page).click();
  return downloadAndCheck(page, () => page.getByTestId("result-download").click());
}

test.describe("passwords", () => {
  test("@A-E2E-1 @A-PWD-1 add password: AES-256 R6, needs the password", async ({ page }) => {
    const dl = await protectWith(page, "-open me");
    expect(dl.name).toBe("plain-3p-protected.pdf");
    const enc = showEncryption(dl.bytes, "-open me").out;
    expect(enc).toMatch(/R = 6/);
    expect(enc).toMatch(/AESv3/);
    expect(qpdfCli(dl.bytes, ["--requires-password"]).status).toBe(0);
    expect(qpdfCli(dl.bytes, ["--check", "--password=-open me"]).status).toBe(0);
  });

  test("@A-PWD-1 mismatch blocks the button; separate owner password and limits are applied", async ({ page }) => {
    await loadApp(page, "/#/protect");
    await addFixture(page, "plain-3p");
    await ready(page);
    await expect(primary(page)).toBeDisabled();
    await page.getByTestId("pw-input").fill("abcdefgh");
    await expect(page.getByTestId("pw-strength")).toContainText("Fair");
    await page.getByTestId("pw-confirm").fill("abcdefg");
    await expect(page.getByTestId("pw-confirm-msg")).toContainText("do not match");
    await expect(primary(page)).toBeDisabled();
    await page.getByTestId("pw-confirm").fill("abcdefgh");
    await expect(primary(page)).toBeEnabled();
    await page.getByTestId("pw-input-toggle").click();
    await expect(page.getByTestId("pw-input")).toHaveAttribute("type", "text");
    await expect(page.getByTestId("pw-input")).toHaveAttribute("autocomplete", "new-password");
    await page.getByTestId("more-options").locator("summary").click();
    await page.getByTestId("perm-print").uncheck();
    await expect(page.getByTestId("owner-msg")).toContainText("separate owner password");
    await expect(primary(page)).toBeDisabled();
    await page.getByTestId("owner-input").fill("boss-pass");
    await expect(primary(page)).toBeEnabled();
    await primary(page).click();
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    const out = showEncryption(dl.bytes, "abcdefgh").out;
    expect(out).toMatch(/print high resolution: not allowed/);
    expect(out).toMatch(/extract for any purpose: allowed/);
    expect(showEncryption(dl.bytes, "boss-pass").out).toMatch(/owner password/);
  });

  test("@A-E2E-4 keyboard only: add password", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only is for desktop input");
    await loadApp(page, "/#/protect");
    await addFixture(page, "plain-3p");
    await ready(page);
    await page.getByTestId("pw-input").focus();
    await page.keyboard.type("kbd-pass-1");
    await page.keyboard.press("Tab"); // Show
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("pw-confirm")).toBeFocused();
    await page.keyboard.type("kbd-pass-1");
    await primary(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("results")).toBeVisible();
    const dl = await downloadAndCheck(page, async () => {
      await page.getByTestId("result-download").focus();
      await page.keyboard.press("Enter");
    });
    expect(showEncryption(dl.bytes, "kbd-pass-1").out).toMatch(/R = 6/);
  });

  test("@A-PWD-2 remove password with the right password gives an unencrypted file", async ({ page }) => {
    await loadApp(page, "/#/unprotect");
    await addFixture(page, "encrypted-aes256");
    await unlock(page, "test-pass");
    await expect(page.getByTestId("pw-input")).toHaveValue("test-pass");
    await expect(page.getByTestId("pw-input")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.locator(".protect")).toContainText("MossPDF can only remove a password you know.");
    await primary(page).click();
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(showEncryption(dl.bytes).out).toMatch(/not encrypted/);
    expect(qpdfCheck(dl.path).ok).toBe(true);
  });

  test("@A-PWD-2 wrong password: inline error, focus on the field, nothing downloads", async ({ page }) => {
    await loadApp(page, "/#/unprotect");
    await addFixture(page, "encrypted-aes256");
    await unlock(page, "test-pass");
    await page.getByTestId("pw-input").fill("nope");
    await primary(page).click();
    await expect(page.getByTestId("pw-msg")).toContainText("doesn't open");
    await expect(page.getByTestId("pw-input")).toBeFocused();
    await expect(page.getByTestId("pw-input")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("result-row")).toHaveCount(0);
  });

  test("@A-PWD-2 owner-only restricted file without the owner password is refused", async ({ page }) => {
    await loadApp(page, "/#/unprotect");
    await addFixture(page, "restricted-owner-only");
    await ready(page);
    await page.getByTestId("pw-input").fill("not-the-owner-password");
    await primary(page).click();
    await expect(page.getByTestId("pw-msg")).toContainText("owner password");
    await expect(page.getByTestId("result-row")).toHaveCount(0);
    await page.getByTestId("pw-input").fill("owner-pass");
    await primary(page).click();
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(showEncryption(dl.bytes).out).toMatch(/not encrypted/);
  });
});

test.describe("safety", () => {
  test("@A-SAF-1 @A-SAF-2 scan lists every kind; the cleaned copy re-scans clean and passes qpdf --check", async ({ page }) => {
    await loadApp(page, "/#/safety-scan");
    await addFixture(page, "risk-everything");
    await ready(page);
    await expect(page.getByTestId("risky-found")).toBeVisible();
    for (const k of KINDS) await expect(page.locator(`[data-testid=scan-item][data-kind=${k}]`).first(), k).toBeAttached();
    await expect(page.getByTestId("group-high")).toBeVisible();
    await expect(page.getByTestId("scan-disclaimer")).toContainText("not an antivirus");
    await expect(page.locator('[data-testid=scan-item][data-kind=uri]').first()).toContainText("https://");
    await expect(primary(page)).toHaveText("Save cleaned copy");
    const dl = await downloadAndCheck(page, () => primary(page).click());
    expect(dl.name).toBe("risk-everything-clean.pdf");
    expect(qpdfCheck(dl.path).ok).toBe(true);
    await expect(page.getByTestId("rescan").getByTestId("nothing-risky")).toBeVisible();
    // the cleaned file, scanned on its own
    await add(page, dl.path);
    await expect(page.getByTestId("nothing-risky").first()).toBeVisible();
    await expect(page.getByTestId("risky-found")).toHaveCount(0);
  });

  test("@A-SAF-2 keep web links: links survive, the rest is gone", async ({ page }) => {
    await loadApp(page, "/#/safety-scan");
    await addFixture(page, "risk-everything");
    await ready(page);
    await expect(page.getByTestId("risky-found")).toBeVisible();
    await page.getByTestId("keep-links").check();
    await downloadAndCheck(page, () => primary(page).click());
    await expect(page.getByTestId("rescan")).toContainText("kept, as you asked");
    await expect(page.getByTestId("rescan").getByTestId("nothing-risky")).toBeVisible();
  });

  test("@A-SAF-3 a clean file says nothing risky was found", async ({ page }) => {
    await loadApp(page, "/#/safety-scan");
    await addFixture(page, "plain-3p");
    await ready(page);
    await expect(page.getByTestId("nothing-risky")).toBeVisible();
    await expect(primary(page)).toBeDisabled();
    await expect(page.getByTestId("scan-disclaimer")).toBeVisible();
  });

  test("@A-SAF-1 an encrypted file asks for its password first, then scans", async ({ page }) => {
    await loadApp(page, "/#/safety-scan");
    await addFixture(page, "risk-everything-encrypted");
    await unlock(page, "user-pass");
    await expect(page.getByTestId("risky-found")).toBeVisible();
  });
});

test.describe("repair", () => {
  test("@A-E2E-1 repair a truncated file: report, honest page count, output passes qpdf --check", async ({ page }) => {
    await loadApp(page, "/#/repair");
    await addFixture(page, "truncated");
    await ready(page);
    await primary(page).click();
    await expect(page.getByTestId("repair-actions")).toContainText("Rebuilt");
    await expect(page.getByTestId("repair-pages")).toContainText("Pages in the repaired file");
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("truncated-repaired.pdf");
    expect(qpdfCheck(dl.path).ok).toBe(true);
  });
});

const AXE_VIEWS: { name: string; route: string; open: (page: Page) => Promise<void> }[] = [
  { name: "protect empty", route: "/#/protect", open: async () => undefined },
  { name: "protect form", route: "/#/protect", open: async (page) => {
    await addFixture(page, "plain-3p");
    await ready(page);
    await page.getByTestId("more-options").locator("summary").click();
    await page.getByTestId("pw-input").fill("short");
    await page.getByTestId("pw-confirm").fill("shor");
  } },
  { name: "unprotect error", route: "/#/unprotect", open: async (page) => {
    await addFixture(page, "encrypted-aes256");
    await unlock(page, "test-pass");
    await page.getByTestId("pw-input").fill("nope");
    await primary(page).click();
    await expect(page.getByTestId("pw-msg")).toContainText("doesn't open");
  } },
  { name: "scan findings", route: "/#/safety-scan", open: async (page) => {
    await addFixture(page, "risk-everything");
    await ready(page);
    await page.getByTestId("risky-found").waitFor(); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run
  } },
  { name: "scan cleaned", route: "/#/safety-scan", open: async (page) => {
    await addFixture(page, "risk-everything");
    await ready(page);
    await page.getByTestId("risky-found").waitFor(); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run
    await downloadAndCheck(page, () => primary(page).click());
    await page.getByTestId("rescan").waitFor(); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run
  } },
  { name: "repair", route: "/#/repair", open: async (page) => {
    await addFixture(page, "truncated");
    await ready(page);
    await primary(page).click();
    await page.getByTestId("repair-actions").waitFor(); // not expect().toBeVisible(): that pairing crashes Firefox in the following axe run
  } },
];

test.describe("axe", () => {
  for (const v of AXE_VIEWS) {
    for (const theme of THEMES) {
      test(`@A-E2E-6 ${v.name} has no axe violations (${theme})`, async ({ page }) => {
        await loadApp(page, v.route);
        await setTheme(page, theme);
        await v.open(page);
        await checkA11y(page, `${v.name} ${theme}`);
      });
    }
  }
});
