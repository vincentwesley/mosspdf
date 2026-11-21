// Flow specs for the M6 tools: redact and photo clean. Redacted output is checked with the real qpdf CLI and searched for leaks in Node.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, expectNoOverflow, loadApp, qpdfCheck, setTheme, type Theme } from "./fixtures";
import { readPdf } from "../tests/helpers/qpdf";
import { qpdfBin } from "../scripts/qpdf-bin.mjs";

const corpus = (n: string) => resolve("tests/corpus/generated", n);
const isMobile = () => test.info().project.name.startsWith("mobile");
const THEMES: Theme[] = ["dark", "light"];
const add = (page: Page, name: string) => page.getByTestId("file-input").setInputFiles([corpus(name)]);
const ready = (page: Page) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
const primary = (page: Page) => page.getByTestId("primary-action");

/** `qpdf --qdf` of a file: streams decompressed, object streams off, so a plain byte search sees everything but picture data. */
function qdf(path: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mosspdf-qdf-"));
  try {
    const r = spawnSync(qpdfBin(), ["--qdf", "--object-streams=disable", path, join(dir, "o.pdf")], { encoding: "utf8" });
    if (r.status !== 0 && r.status !== 3) throw new Error(r.stderr);
    return readFileSync(join(dir, "o.pdf")).toString("latin1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const utf16 = (s: string) => [...s].map((c) => "\0" + c).join("");

async function saveRedacted(page: Page) {
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  const c = qpdfCheck(dl.path);
  expect(c.ok, `qpdf --check on ${dl.name}: ${c.output}`).toBe(true);
  return dl;
}
const found = (page: Page) => expect(page.getByTestId("rd-status")).toContainText("Found", { timeout: 30_000 });

/** Scrolls so the top of `o` sits below the sticky header (a mouse at a point under it, or off screen, hits nothing), then returns its box. */
async function reveal(o: Locator) {
  await o.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 220));
  return (await o.boundingBox())!;
}

/** Draws a box over the page's first-line marker text with the mouse (page 1 of plain-3p). */
async function drawOverMarker(page: Page) {
  const o = page.getByTestId("pv-overlay").first();
  const b = await reveal(o);
  await page.mouse.move(b.x + b.width * 0.06, b.y + b.height * 0.062);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.09, { steps: 4 });
  await page.mouse.move(b.x + b.width * 0.56, b.y + b.height * 0.108, { steps: 4 });
  await page.mouse.up();
}

test.describe("Redact", () => {
  test("A-RED-1 detect, review, apply: every redacted string is gone from text, bytes, metadata, outline and annotations", async ({ page }) => {
    await loadApp(page, "/#/redact");
    await add(page, "redact-sample.pdf");
    await ready(page);
    await found(page);
    await expect(page.getByTestId("rd-group-nric")).toBeVisible();
    // the list shows hits partly masked, never in full
    await expect(page.getByTestId("rd-group-nric")).toContainText("S****567D");
    await expect(page.getByTestId("rd-list")).not.toContainText("S1234567D");
    await expect(page.getByTestId("rd-group-phone")).toBeVisible();
    await expect(page.getByTestId("rd-group-email")).toBeVisible();
    await expect(page.getByTestId("rd-group-address")).toBeVisible();
    await expect(page.getByTestId("rd-row")).toHaveCount(4);
    await expect(primary(page)).toHaveText("Redact 4 items");
    // select none / all of a kind, and a kind switched off
    await page.getByTestId("rd-none-email").click();
    await expect(primary(page)).toHaveText("Redact 3 items");
    await page.getByTestId("rd-all-email").click();
    await page.getByTestId("rd-kind-phone").uncheck();
    await expect(page.getByTestId("rd-group-phone")).toHaveCount(0);
    await expect(primary(page)).toHaveText("Redact 3 items");
    await page.getByTestId("rd-kind-phone").check();
    // unticking addresses also unticks postal codes
    await page.getByTestId("rd-kind-address").uncheck();
    await expect(page.getByTestId("rd-kind-postal")).not.toBeChecked();
    await page.getByTestId("rd-kind-address").check();
    await page.getByTestId("rd-kind-postal").check();
    // search adds a group
    await page.getByTestId("rd-q").fill("tan wei ming");
    await page.getByTestId("rd-find").click();
    await expect(page.getByTestId("rd-group-search")).toContainText("Page 1: Tan Wei Ming");
    await expect(page.getByTestId("rd-hitbox").first()).toBeAttached();
    await page.getByTestId("rd-show").first().click();
    await expect(primary(page)).toHaveText("Redact 5 items");
    await expect(page.getByTestId("rd-after")).toContainText("search for a word you redacted");
    await primary(page).click();
    const dl = await saveRedacted(page);
    expect(dl.name).toBe("redact-sample-redacted.pdf");
    await expect(page.getByTestId("results")).toContainText("Redacted 5 items on 1 page");
    await expect(page.getByTestId("results")).toContainText("text outside the boxes can still be searched and copied");

    const secrets = ["S1234567D", "9123 4567", "wei.ming@example.com", "560123", "Blk 123 Ang Mo Kio", "Tan Wei Ming"];
    const pages = await readPdf(dl.bytes);
    const text = pages.map((p) => p.text).join("\n");
    for (const s of secrets) expect(text, `pdf.js text has "${s}"`).not.toContain(s);
    expect(pages[0].text).toContain("KEEP-THIS-SENTENCE");
    expect(pages[1].text).toContain("PAGE-MARKER r2");
    const raw = qdf(dl.path);
    for (const s of [...secrets, "Application for", "Contact wei", "Call 9123"]) {
      expect(raw, `bytes have "${s}"`).not.toContain(s);
      expect(raw, `bytes have "${s}" (UTF-16)`).not.toContain(utf16(s));
    }
    expect(raw).not.toMatch(/\/Annots|\/Author|\/Info\b|\/Metadata|\/AcroForm/);
  });

  test("A-RED-1 a box drawn by hand redacts what is under it; the other pages keep their text", async ({ page }) => {
    test.skip(isMobile(), "mouse drawing is for desktop; the keyboard test covers the button route");
    await loadApp(page, "/#/redact");
    await add(page, "plain-3p.pdf");
    await ready(page);
    await found(page);
    await expect(primary(page)).toBeDisabled();
    await drawOverMarker(page);
    await expect(page.getByTestId("rd-row")).toHaveCount(1);
    await expect(page.getByTestId("rd-row")).toContainText("Page 1: box");
    await primary(page).click();
    const dl = await saveRedacted(page);
    const pages = await readPdf(dl.bytes);
    expect(pages).toHaveLength(3);
    expect(pages[0].text).not.toContain("PAGE-MARKER");
    expect(pages[1].text).toContain("PAGE-MARKER p2");
    expect(pages[2].text).toContain("PAGE-MARKER p3");
    expect(qdf(dl.path)).not.toContain("PAGE-MARKER p1");
  });

  test("A-RED-1 the Add box button and the keyboard do what dragging does (no dragging needed)", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only flow");
    await loadApp(page, "/#/redact");
    await add(page, "plain-3p.pdf");
    await ready(page);
    await found(page);
    await page.getByTestId("rd-pageno").fill("2");
    await page.getByTestId("rd-add").click();
    const box = page.getByTestId("rd-box");
    await expect(box).toHaveCount(1);
    await expect(box).toBeFocused();
    const before = (await box.boundingBox())!;
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("+");
    const after = (await box.boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x + 5);
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.width).toBeGreaterThan(before.width);
    await expect(page.getByTestId("rd-row")).toContainText("Page 2: box");
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("rd-row")).toHaveCount(0);
    await expect(primary(page)).toBeDisabled();
  });

  test("A-RED-1 a PDF with no text says so; a signed one warns before running", async ({ page }) => {
    await loadApp(page, "/#/redact");
    await add(page, "scan-1p.pdf");
    await ready(page);
    await expect(page.getByTestId("rd-status")).toContainText("No text was found", { timeout: 30_000 });
    await page.getByTestId("clear-all").click();
    await add(page, "signed.pdf");
    await ready(page);
    await expect(page.getByTestId("warnings")).toContainText("digitally signed");
  });
});

// ---- photo clean ----
const jpegInfo = (b: Buffer) => {
  const markers: number[] = [];
  let size: { w: number; h: number } | undefined;
  for (let p = 2; p + 4 < b.length; ) {
    if (b[p] !== 0xff) break;
    const m = b[p + 1];
    markers.push(m);
    if (m === 0xc0 || m === 0xc2) size = { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
    if (m === 0xda) break;
    p += 2 + b.readUInt16BE(p + 2);
  }
  return { markers, size };
};

test.describe("Photo clean", () => {
  test("A-RED-2 EXIF is shown, a blur box is drawn, the saved photo has no EXIF and the same size", async ({ page }) => {
    await loadApp(page, "/#/photo");
    await add(page, "photo-gps.jpg");
    await expect(page.getByTestId("file-row")).toHaveCount(1);
    await expect(page.getByTestId("ph-exif")).toContainText("PagerCam PH-1");
    await expect(page.getByTestId("ph-exif")).toContainText("location (GPS): yes");
    await expect(page.getByTestId("ph-exif")).toContainText("2026-01-02");
    await expect(page.locator("body")).toContainText("doesn't detect them automatically");
    await page.getByTestId("ph-add").click();
    await expect(page.getByTestId("ph-box")).toHaveCount(1);
    await page.getByTestId("ph-mode-blur").check();
    await expect(primary(page)).toHaveText("Save clean photo");
    await primary(page).click();
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("photo-gps-clean.jpg");
    expect([dl.bytes[0], dl.bytes[1]]).toEqual([0xff, 0xd8]);
    const info = jpegInfo(dl.bytes);
    expect(info.markers, "no APP1 (EXIF/XMP) segment").not.toContain(0xe1);
    expect(dl.bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(dl.bytes.includes(Buffer.from("PagerCam"))).toBe(false);
    expect(info.size).toEqual({ w: 400, h: 300 });
  });

  test("A-RED-2 draw a box with the mouse, move it with the keyboard, remove it", async ({ page }) => {
    test.skip(isMobile(), "mouse and keyboard flow");
    await loadApp(page, "/#/photo");
    await add(page, "photo-gps.jpg");
    await expect(page.getByTestId("ph-exif")).toContainText("PagerCam");
    const o = page.getByTestId("ph-overlay");
    const b = await reveal(o);
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 5 });
    await page.mouse.up();
    const box = page.getByTestId("ph-box");
    await expect(box).toHaveCount(1);
    await box.focus();
    const before = (await box.boundingBox())!;
    await page.keyboard.press("Shift+ArrowRight");
    expect((await box.boundingBox())!.x).toBeGreaterThan(before.x + 5);
    await page.keyboard.press("Delete");
    await expect(box).toHaveCount(0);
  });

  test("A-RED-2 a PNG stays a PNG, several photos come as a zip", async ({ page }) => {
    await loadApp(page, "/#/photo");
    await add(page, "photo-alpha.png");
    await expect(page.getByTestId("file-row")).toHaveCount(1);
    await expect(page.getByTestId("ph-exif")).toContainText("not a JPG");
    await primary(page).click();
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
    expect(dl.name).toBe("photo-alpha-clean.png");
    expect(dl.bytes.subarray(1, 4).toString()).toBe("PNG");
    await page.getByTestId("start-over").click();
    await page.getByTestId("file-input").setInputFiles([corpus("photo-gps.jpg"), corpus("photo-small.jpg")]);
    await expect(page.getByTestId("file-row")).toHaveCount(2);
    await expect(page.getByTestId("ph-total")).toContainText("1 of 2 photos carry a location");
    await primary(page).click();
    await expect(page.getByTestId("result-row")).toHaveCount(2);
    await expect(page.getByTestId("download-zip")).toBeVisible();
  });
});

// ---- axe + overflow ----
const VIEWS: { name: string; route: string; open: (page: Page) => Promise<void> }[] = [
  { name: "redact review", route: "/#/redact", open: async (page) => {
    await add(page, "redact-sample.pdf"); await ready(page); await found(page);
    await page.getByTestId("rd-hitbox").first().waitFor({ state: "attached" });
  } },
  { name: "photo", route: "/#/photo", open: async (page) => {
    await add(page, "photo-gps.jpg"); await expect(page.getByTestId("ph-exif")).toContainText("PagerCam");
    await page.getByTestId("ph-add").click();
    await page.getByTestId("ph-box").waitFor({ state: "attached" });
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
