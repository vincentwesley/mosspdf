// Flow specs for the M4 tools: fill forms and sign. Outputs are checked with the real qpdf CLI and read back (pdf-lib, pdf.js).
import { resolve } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, expectNoOverflow, loadApp, qpdfCheck, setTheme, waitForSeal, type Theme } from "./fixtures";
import { readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const isMobile = () => test.info().project.name.startsWith("mobile");
const THEMES: Theme[] = ["dark", "light"];

const add = (page: Page, name: string) => page.getByTestId("file-input").setInputFiles([corpus(name)]);
const ready = (page: Page) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
const primary = (page: Page) => page.getByTestId("primary-action");
const list = (page: Page) => page.getByTestId("fields-list");
const overlay = (page: Page, i = 0) => page.getByTestId("pv-overlay").nth(i);

async function save(page: Page) {
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  const c = qpdfCheck(dl.path);
  expect(c.ok, `qpdf --check on ${dl.name}: ${c.output}`).toBe(true);
  return dl;
}
/** One text signature, placed by clicking page `i`. */
async function typeSignature(page: Page, name = "Ana Maria") {
  await page.getByTestId("sg-sig-tab-type").click();
  await page.getByTestId("sg-sig-name").fill(name);
}

test.describe("Fill forms", () => {
  test("A-E2E-1 fill a form: type on the page and in the list (kept in sync), save, read the values back", async ({ page }) => {
    await loadApp(page, "/#/fill");
    await add(page, "forms-2p");
    await ready(page);
    await expect(list(page).getByLabel("full_name")).toBeVisible();
    await expect(page.getByTestId("primary-action")).toHaveText("Save filled form");
    // overlay <-> list sync. Phones (narrow screens) hide the on-page controls and use the list only.
    const wide = !isMobile();
    const onPage = wide ? overlay(page) : list(page);
    await onPage.getByLabel("full_name").fill("Ana Maria");
    await expect(list(page).getByLabel("full_name")).toHaveValue("Ana Maria");
    await list(page).getByLabel("notes").fill("line one\nline two");
    await list(page).getByLabel("agree").check();
    await list(page).getByLabel("choice: b").check();
    if (wide) {
      await expect(overlay(page).getByLabel("notes")).toHaveValue("line one\nline two");
      await expect(overlay(page).getByLabel("agree")).toBeChecked();
      await expect(overlay(page).getByLabel("choice: b")).toBeChecked();
    }
    await onPage.getByLabel("country").selectOption("Gamma");
    await expect(list(page).getByLabel("country")).toHaveValue("Gamma");
    await list(page).getByLabel("interests").selectOption(["Go", "Shogi"]);
    await (wide ? overlay(page, 1) : list(page)).getByLabel("page2_note").fill("turned page"); // the page that is rotated 90 degrees
    await expect(onPage.getByLabel("ref_no")).toBeDisabled(); // read-only
    await primary(page).click();
    const dl = await save(page);
    expect(dl.name).toBe("forms-2p-filled.pdf");
    const form = (await PDFDocument.load(dl.bytes)).getForm();
    expect(form.getTextField("full_name").getText()).toBe("Ana Maria");
    expect(form.getTextField("notes").getText()).toBe("line one\nline two");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("choice").getSelected()).toBe("b");
    expect(form.getDropdown("country").getSelected()).toEqual(["Gamma"]);
    expect(form.getOptionList("interests").getSelected()).toEqual(["Go", "Shogi"]);
    expect(form.getTextField("page2_note").getText()).toBe("turned page");
    expect(form.getTextField("ref_no").getText()).toBe("REF-001");
  });

  test("A-E2E-1 flatten turns the answers into page content (no fields left)", async ({ page }) => {
    await loadApp(page, "/#/fill");
    await add(page, "forms-2p");
    await ready(page);
    await list(page).getByLabel("full_name").fill("Flat Name");
    await page.getByTestId("fill-flatten").check();
    await primary(page).click();
    const dl = await save(page);
    expect((await PDFDocument.load(dl.bytes)).getForm().getFields()).toHaveLength(0);
    expect((await readPdf(dl.bytes))[0].text).toContain("Flat Name");
  });

  test("A-E2E-1 characters the form can't take give a plain message", async ({ page }) => {
    await loadApp(page, "/#/fill");
    await add(page, "forms-2p");
    await ready(page);
    await list(page).getByLabel("full_name").fill("李小龍");
    await primary(page).click();
    await expect(page.getByTestId("job-error")).toContainText("can't take characters like");
    await expect(page.getByTestId("result-row")).toHaveCount(0);
  });

  test("A-E2E-1 a signed PDF warns before running; a hybrid XFA form says the XFA data is removed", async ({ page }) => {
    await loadApp(page, "/#/fill");
    await add(page, "signed");
    await ready(page);
    await expect(page.getByTestId("warnings")).toContainText("digitally signed");
    await page.getByTestId("clear-all").click();
    await add(page, "risk-xfa");
    await ready(page);
    await expect(page.getByTestId("warnings")).toContainText("removes the XFA data");
    await list(page).getByLabel("full_name").fill("Zed");
    await primary(page).click();
    const dl = await save(page);
    expect((await PDFDocument.load(dl.bytes)).getForm().hasXFA()).toBe(false);
    await expect(page.getByTestId("results")).toContainText("XFA data");
  });

  test("A-E2E-1 an XFA-only form is explained, not faked; a PDF without fields points to Sign", async ({ page }) => {
    await loadApp(page, "/#/fill");
    await add(page, "xfa-only");
    await ready(page);
    await expect(page.getByTestId("warnings")).toContainText("MossPDF can't fill it in");
    await expect(primary(page)).toBeDisabled();
    await page.getByTestId("clear-all").click();
    await add(page, "plain-3p");
    await ready(page);
    await expect(page.getByTestId("fill-hint")).toContainText("no form fields");
    await expect(primary(page)).toBeDisabled();
    await page.getByTestId("fill-to-sign").click();
    await expect(page).toHaveURL(/#\/sign$/);
  });
});

test.describe("Sign", () => {
  test("A-E2E-1 type a name, place it on page 1, save, the picture is in the file and the disclaimer shows", async ({ page }) => {
    await loadApp(page, "/#/sign");
    await add(page, "plain-3p");
    await ready(page);
    await expect(page.getByTestId("sign-disclaimer")).toContainText("not a certified digital signature");
    await expect(primary(page)).toBeDisabled();
    await expect(page.getByTestId("primary-why")).toHaveText("Place a signature on a page first.");
    await expect(primary(page)).toHaveAttribute("aria-describedby", "primary-why");
    await typeSignature(page);
    // the handwriting font was loaded before the seal (a late load would be a request after the seal and fail this test)
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.family.includes("Caveat") && f.status === "loaded"))).toBe(true);
    await overlay(page, 0).click({ position: { x: 150, y: 250 } });
    await expect(page.getByTestId("sg-item")).toHaveCount(1);
    await expect(page.getByTestId("sg-row")).toContainText("Signature, page 1");
    await expect(primary(page)).toBeEnabled();
    await expect(page.getByTestId("primary-why")).toBeHidden();
    await primary(page).click();
    const dl = await save(page);
    expect(dl.name).toBe("plain-3p-signed.pdf");
    expect((dl.bytes.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(await readPdf(dl.bytes)).toHaveLength(3);
  });

  test("A-E2E-1 draw a signature with the pointer, place it with the page-number button", async ({ page }) => {
    await loadApp(page, "/#/sign");
    await add(page, "plain-3p");
    await ready(page);
    const pad = page.getByTestId("sg-sig-pad");
    await pad.scrollIntoViewIfNeeded();
    const b = (await pad.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width * (0.1 + i * 0.07), b.y + b.height * (0.5 + 0.2 * Math.sin(i)));
    await page.mouse.up();
    await page.getByTestId("sg-pageno").fill("2");
    await page.getByTestId("sg-place").click();
    await expect(page.getByTestId("sg-row")).toContainText("page 2");
    await primary(page).click();
    const dl = await save(page);
    expect((dl.bytes.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test("A-E2E-1 keep a signature on this device: reload, saved thumbnail places it, forget all clears storage", async ({ page }) => {
    await loadApp(page, "/#/sign");
    await add(page, "plain-3p");
    await ready(page);
    await expect(page.getByTestId("sg-saved")).toBeHidden();
    await typeSignature(page);
    await page.getByTestId("sg-keep").check();
    await page.getByTestId("sg-date-under").check();
    await page.getByTestId("sg-pageno").fill("1");
    await page.getByTestId("sg-place").click();
    await expect(page.getByTestId("sg-row")).toHaveCount(2); // signature + its date
    await expect(page.getByTestId("sg-saved-use")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mosspdf.saved-sigs") ?? "[]").length)).toBe(1);
    await page.reload(); // one navigation only: a second goto right after cancels the reload's workers (WebKit reports that as an error)
    await waitForSeal(page);
    await add(page, "plain-3p");
    await ready(page);
    await expect(page.getByTestId("sg-saved-use")).toHaveCount(1);
    await expect(page.getByTestId("sg-saved")).toContainText("Never uploaded");
    await page.getByTestId("sg-saved-use").click();
    await expect(page.getByTestId("sg-row")).toHaveCount(1);
    await primary(page).click();
    const dl = await save(page);
    expect((dl.bytes.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
    await page.getByTestId("sg-forget-all").click();
    await expect(page.getByTestId("sg-saved")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("mosspdf.saved-sigs"))).toBeNull();
  });

  test("A-E2E-1 text and date on every page; keyboard moves and deletes an item", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only flow");
    await loadApp(page, "/#/sign");
    await add(page, "plain-3p");
    await ready(page);
    await page.getByTestId("kind-text").check();
    await page.getByTestId("sg-text").fill("Approved BY-ANA");
    await page.getByTestId("sg-all").check();
    await page.getByTestId("sg-place").click();
    const items = page.getByTestId("sg-item");
    await expect(items).toHaveCount(1);
    const item = items.first();
    const before = (await item.boundingBox())!;
    await item.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ArrowDown");
    const after = (await item.boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x + 5);
    expect(after.y).toBeGreaterThan(before.y);
    await page.getByTestId("kind-date").check();
    await page.getByTestId("sg-all").uncheck();
    await page.getByTestId("sg-pageno").fill("3");
    await page.getByTestId("sg-place").click();
    await expect(page.getByTestId("sg-row")).toHaveCount(2);
    await primary(page).click();
    const dl = await save(page);
    const pages = await readPdf(dl.bytes);
    expect(pages.map((p) => p.text.includes("Approved BY-ANA"))).toEqual([true, true, true]);
    expect(pages[2].text).toMatch(/\d{1,2} [A-Z][a-z]{2} \d{4}/);
    // Delete removes the item
    await item.focus();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("sg-row")).toHaveCount(1);
  });

  test("A-E2E-1 helpful messages: nothing made yet, characters that can't be used, a signed PDF", async ({ page }) => {
    await loadApp(page, "/#/sign");
    await add(page, "signed");
    await ready(page);
    await expect(page.getByTestId("warnings")).toContainText("digitally signed");
    await page.getByTestId("sg-place").click();
    await expect(page.getByTestId("sg-msg")).toContainText("Make your signature first");
    await page.getByTestId("kind-text").check();
    await page.getByTestId("sg-text").fill("李");
    await expect(page.getByTestId("sg-text-msg")).toContainText("cannot be used yet");
    await page.getByTestId("sg-place").click();
    await expect(page.getByTestId("sg-msg")).toContainText("can't be used");
    await expect(page.getByTestId("sg-item")).toHaveCount(0);
  });
});

// ---- axe + overflow ----
const VIEWS: { name: string; route: string; open: (page: Page) => Promise<void> }[] = [
  { name: "fill form", route: "/#/fill", open: async (page) => { await add(page, "forms-2p"); await ready(page);
    // waitFor, not expect().toBeVisible(): that pairing crashes Firefox in the following axe run (see tools-m3.spec.ts)
    await list(page).getByLabel("full_name").waitFor();
    await overlay(page).getByLabel("full_name").waitFor({ state: "attached" });
  } },
  { name: "sign placed", route: "/#/sign", open: async (page) => {
    await add(page, "plain-3p"); await ready(page); await typeSignature(page);
    await overlay(page, 0).click({ position: { x: 150, y: 250 } });
    await expect(page.getByTestId("sg-item")).toHaveCount(1);
  } },
];
test.describe("axe and layout", () => {
  for (const v of VIEWS) {
    for (const theme of THEMES) {
      test(`@A-E2E-6 ${v.name} has no axe violations and no horizontal overflow (${theme})`, async ({ page }) => {
        await loadApp(page, v.route);
        await setTheme(page, theme);
        await v.open(page);
        await checkA11y(page, `${v.name} ${theme}`);
        await expectNoOverflow(page);
      });
    }
  }
});
