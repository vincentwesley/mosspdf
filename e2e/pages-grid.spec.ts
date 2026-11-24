// One page grid across files (merge "Edit pages", organize): cross-file drag, keyboard move, undo/redo, multi-select. Output read back with pdf.js.
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, downloadAndCheck, loadApp, qpdfCheck } from "./fixtures";
import { marker, readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", `${n}.pdf`);
const cards = (page: Page) => page.getByTestId("page-card");
/** "plain-3p.pdf, p. 2" -> "p2" style tags, in grid order. */
const order = (page: Page) => cards(page).locator(".pg__src").allTextContents().then((t) => t.map((s) => (s.startsWith("plain") ? "p" : "m") + s.slice(-1)));
async function save(page: Page) {
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").first().click());
  expect(qpdfCheck(dl.path).ok).toBe(true);
  return (await readPdf(dl.bytes)).map((p) => marker(p as never));
}
async function open(page: Page, route: string) {
  await loadApp(page, route);
  await page.getByTestId("file-input").setInputFiles([corpus("plain-3p"), corpus("mixed-sizes")]);
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(2);
  if (route.endsWith("merge")) await page.getByTestId("edit-pages").click();
  await expect(cards(page)).toHaveCount(6);
}

test.describe("page grid across files", () => {
  test("merge: drag page 2 of file B before page 1 of file A, keyboard move, undo and redo, save", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 1500 }); // both cards on screen, so plain mouse moves reach the target
    await open(page, "/#/merge");
    await page.evaluate(() => scrollTo(0, 0));
    await expect(cards(page).first().locator(".pg__badge")).toHaveText("A");
    await expect(cards(page).nth(3).locator(".pg__badge")).toHaveText("B");
    if (browserName === "chromium") {
      const grip = cards(page).nth(4).getByTestId("page-grip");
      const target = (await cards(page).first().boundingBox())!;
      const g = (await grip.boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 20, target.y + 20, { steps: 25 });
      await page.mouse.move(target.x + 30, target.y + 30, { steps: 10 });
      await page.mouse.up();
    } else for (let i = 0; i < 4; i++) await cards(page).nth(4 - i).getByTestId("page-move-earlier").click(); // WebKit's scaled viewport puts the sticky action bar over the grip
    expect(await order(page)).toEqual(["m2", "p1", "p2", "p3", "m1", "m3"]);

    await cards(page).first().getByTestId("page-select").focus();
    await page.keyboard.press("Alt+ArrowRight");
    expect(await order(page)).toEqual(["p1", "m2", "p2", "p3", "m1", "m3"]);

    await page.getByTestId("pg-undo").click(); // one step: the keyboard move
    expect(await order(page)).toEqual(["m2", "p1", "p2", "p3", "m1", "m3"]);
    await page.getByTestId("page-grid").focus();
    for (let i = 0; i < 5 && (await page.getByTestId("pg-undo").isEnabled()); i++) await page.keyboard.press("Control+z");
    await expect(page.getByTestId("pg-undo")).toBeDisabled();
    expect(await order(page)).toEqual(["p1", "p2", "p3", "m1", "m2", "m3"]);
    for (let i = 0; i < 5 && (await page.getByTestId("pg-redo").isEnabled()); i++) await page.keyboard.press(i % 2 ? "Control+y" : "Control+Shift+z");
    expect(await order(page)).toEqual(["p1", "m2", "p2", "p3", "m1", "m3"]);
    await page.getByTestId("pg-undo").click();
    expect(await save(page)).toEqual(["m2", "p1", "p2", "p3", "m1", "m3"]);
  });

  test("organize: two PDFs in one grid, select several (ctrl and shift), rotate and delete, undo restores", async ({ page }) => {
    await open(page, "/#/organize");
    await cards(page).nth(1).getByTestId("page-select").click({ modifiers: ["Control"] });
    await cards(page).nth(4).getByTestId("page-select").click({ modifiers: ["Control"] });
    await cards(page).nth(5).getByTestId("page-select").click({ modifiers: ["Control", "Shift"] });
    await expect(page.getByTestId("pg-sel-count")).toHaveText("3 selected");
    await page.getByTestId("pg-sel-rotate-right").click();
    await page.getByTestId("pg-sel-delete").click();
    expect(await order(page)).toEqual(["p1", "p3", "m1"]);
    await page.getByTestId("pg-undo").click();
    expect(await order(page)).toEqual(["p1", "p2", "p3", "m1", "m2", "m3"]);
    await page.getByTestId("pg-redo").click();
    expect(await order(page)).toEqual(["p1", "p3", "m1"]);
    expect(await save(page)).toEqual(["p1", "p3", "m1"]);
  });

  test("organize: a selected block moves together", async ({ page }) => {
    await open(page, "/#/organize");
    await page.getByTestId("pg-select-mode").click();
    await cards(page).nth(4).getByTestId("page-select").click();
    await cards(page).nth(5).getByTestId("page-select").click();
    await page.getByTestId("pg-sel-earlier").click();
    expect(await order(page)).toEqual(["p1", "p2", "p3", "m2", "m3", "m1"]);
  });
});
