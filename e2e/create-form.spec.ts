// Create form: place a text field, a checkbox and a dropdown, rename one, save, read the fields back, then continue into Fill forms.
import { resolve } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";

const overlay = (page: import("@playwright/test").Page) => page.getByTestId("pv-overlay").first();

test("CF-E2E-1 place text, checkbox and dropdown, rename, save; fields read back; Fill lists them", async ({ page }) => {
  await loadApp(page, "/#/create-form");
  await page.getByTestId("file-input").setInputFiles(resolve("tests/corpus/generated/plain-3p.pdf"));
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await expect(page.getByTestId("primary-action")).toBeDisabled();
  await expect(page.getByTestId("primary-why")).toHaveText("Place a field on a page first.");
  await page.getByTestId("cf-required").check();
  await overlay(page).click({ position: { x: 150, y: 150 } });
  await page.getByTestId("cf-required").uncheck();
  await page.getByTestId("cf-kind-checkbox").check();
  await overlay(page).click({ position: { x: 150, y: 250 } });
  await page.getByTestId("cf-kind-dropdown").check();
  await page.getByTestId("cf-place").click();
  await expect(page.getByTestId("cf-msg")).toHaveText("Type the choices first, separated by commas.");
  await page.getByTestId("cf-options").fill("Red, Green, Blue");
  await overlay(page).click({ position: { x: 200, y: 350 } });
  await expect(page.getByTestId("cf-row")).toHaveCount(3);
  await expect(page.getByTestId("cf-name").first()).toHaveValue("Text 1");
  // a duplicate name blocks saving; a rename fixes it
  await page.getByTestId("cf-name").nth(1).fill("Text 1");
  await expect(page.getByTestId("cf-name-msg").nth(1)).toHaveText("Another field has this name.");
  await expect(page.getByTestId("primary-action")).toBeDisabled();
  await page.getByTestId("cf-name").nth(1).fill("Agree!");
  await expect(page.getByTestId("cf-name").nth(1)).toHaveValue("Agree");
  await page.getByTestId("cf-undo").click();
  await page.getByTestId("cf-redo").click();
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  expect(qpdfCheck(dl.path).ok).toBe(true);
  expect(dl.name).toBe("plain-3p-form.pdf");
  const form = (await PDFDocument.load(dl.bytes)).getForm();
  expect(form.getFields().map((f) => `${f.constructor.name}:${f.getName()}`)).toEqual(["PDFTextField:Text 1", "PDFCheckBox:Agree", "PDFDropdown:Dropdown 1"]);
  expect(form.getTextField("Text 1").isRequired()).toBe(true);
  expect(form.getDropdown("Dropdown 1").getOptions()).toEqual(["Red", "Green", "Blue"]);
  // continue with Fill forms: its fields list shows the new fields
  await page.getByTestId("next-fill").click();
  await expect(page.getByTestId("fields-list")).toContainText("Dropdown 1");
  await expect(page.getByTestId("fields-list")).toContainText("Agree");
});
