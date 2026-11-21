// Flow specs for the M2 tools: images to PDF, PDF to images, compress, page numbers, watermark, metadata.
// Each flow: open, run, download, verify the file (qpdf --check, then pdf.js for pages, text, metadata, size). Titles carry the ACCEPTANCE ID.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import type { Page } from "@playwright/test";
import { test, expect, checkA11y, downloadAndCheck, expectNoOverflow, loadApp, qpdfCheck, setTheme, type Theme } from "./fixtures";
import { findText, readInfo, readPdf } from "../tests/helpers/qpdf";

const corpus = (n: string) => resolve("tests/corpus/generated", n.includes(".") ? n : `${n}.pdf`);
const image = (n: string) => resolve("tests/fixtures/images", n);
const isMobile = () => test.info().project.name.startsWith("mobile");
const THEMES: Theme[] = ["dark", "light"];

const add = (page: Page, ...paths: string[]) => page.getByTestId("file-input").setInputFiles(paths);
const readyRows = (page: Page, n: number) => expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(n);
const run = (page: Page) => page.getByTestId("primary-action").click();

/** Downloads result row `i`, checks it with qpdf, and returns its bytes. */
async function savePdf(page: Page, i = 0) {
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-row").nth(i).getByTestId("result-download").click());
  const check = qpdfCheck(dl.path);
  expect(check.ok, `qpdf --check on ${dl.name}: ${check.output}`).toBe(true);
  return dl;
}
const pngSize = (b: Uint8Array) => { const v = new DataView(b.buffer, b.byteOffset); return { w: v.getUint32(16), h: v.getUint32(20) }; };
function jpegSize(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset);
  for (let p = 2; p + 9 < b.length; ) {
    const m = b[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: v.getUint16(p + 7), h: v.getUint16(p + 5) };
    p += 2 + v.getUint16(p + 2);
  }
  throw new Error("no JPEG size");
}

test.describe("M2 tools", () => {
  test("A-COR-4 A-E2E-1 images to PDF: an EXIF-rotated JPEG comes out as a portrait page", async ({ page }) => {
    await loadApp(page, "/#/images-to-pdf");
    await add(page, image("exif6-40x20.jpg")); // stored 40x20, rotation flag 6 = shown 20x40
    await readyRows(page, 1);
    await expect(page.getByTestId("file-meta")).toContainText("20 × 40");
    await expect(page.getByTestId("primary-action")).toHaveText("Create PDF");
    await run(page);
    const dl = await savePdf(page);
    expect(dl.name).toBe("images.pdf");
    const pages = await readPdf(dl.bytes);
    expect(pages).toHaveLength(1);
    expect(Math.round(pages[0].w)).toBe(20);
    expect(Math.round(pages[0].h)).toBe(40);
  });

  test("A-COR-4 A-E2E-1 images to PDF: reorder, A4 portrait, one page per picture", async ({ page }) => {
    await loadApp(page, "/#/images-to-pdf");
    await add(page, corpus("photo.jpg"), image("wide-40x20.png"), corpus("photo-alpha.png"));
    await readyRows(page, 3);
    await page.getByTestId("file-down").first().click();
    await expect(page.getByTestId("file-row").first()).toContainText("wide-40x20.png");
    await page.getByTestId("size-a4").check();
    await page.getByTestId("orient-select").selectOption("portrait");
    await expect(page.getByTestId("primary-action")).toHaveText("Create PDF from 3 pictures");
    await run(page);
    const pages = await readPdf((await savePdf(page)).bytes);
    expect(pages).toHaveLength(3);
    for (const p of pages) { expect(Math.round(p.w)).toBe(595); expect(Math.round(p.h)).toBe(842); }
  });

  test("A-COR-4 A-E2E-1 PDF to images: three pages make a zip of PNGs at the right size", async ({ page }) => {
    await loadApp(page, "/#/pdf-to-images");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("dpi-72").check();
    await expect(page.getByTestId("primary-action")).toHaveText("Save 3 pages as pictures");
    await run(page);
    await expect(page.getByTestId("result-row")).toHaveCount(3);
    const dl = await downloadAndCheck(page, () => page.getByTestId("download-zip").click());
    expect(dl.name).toBe("plain-3p-pdf-to-images.zip");
    const files = unzipSync(new Uint8Array(dl.bytes));
    expect(Object.keys(files).sort()).toEqual(["plain-3p-page-1.png", "plain-3p-page-2.png", "plain-3p-page-3.png"]);
    for (const b of Object.values(files)) {
      expect([...b.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      const s = pngSize(b);
      expect(s.w).toBeGreaterThanOrEqual(595); expect(s.w).toBeLessThanOrEqual(597); // A4 at 72 dpi (595.28 x 841.89 pt)
      expect(s.h).toBeGreaterThanOrEqual(841); expect(s.h).toBeLessThanOrEqual(843);
    }
  });

  test("A-COR-4 A-E2E-1 PDF to images: JPG at 150 dpi for pages 2-3", async ({ page }) => {
    await loadApp(page, "/#/pdf-to-images");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("format-jpeg").check();
    await expect(page.getByTestId("quality-input")).toBeVisible();
    await page.getByTestId("pages-range").check();
    await page.getByTestId("pages-input").fill("2-3");
    await expect(page.getByTestId("primary-action")).toHaveText("Save 2 pages as pictures");
    await run(page);
    await expect(page.getByTestId("result-row")).toHaveCount(2);
    const dl = await downloadAndCheck(page, () => page.getByTestId("result-row").first().getByTestId("result-download").click());
    expect(dl.name).toBe("plain-3p-page-2.jpg");
    expect([...dl.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    const s = jpegSize(new Uint8Array(dl.bytes));
    expect(Math.abs(s.w - 1241)).toBeLessThanOrEqual(2); // 595.28 pt at 150 dpi
    expect(Math.abs(s.h - 1754)).toBeLessThanOrEqual(2);
  });

  test("A-E2E-1 PDF to images warns before many pages at 300 dpi", async ({ page }) => {
    await loadApp(page, "/#/pdf-to-images");
    await add(page, corpus("text-500p"));
    await readyRows(page, 1);
    await expect(page.getByTestId("warnings")).toHaveText("");
    await page.getByTestId("dpi-300").check();
    await expect(page.getByTestId("warnings")).toContainText("500 pages at 300 dpi");
  });

  test("A-COR-5 A-E2E-1 compress: balanced makes an image-heavy file smaller and shows before and after", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await add(page, corpus("image-mixed"));
    await readyRows(page, 1);
    await expect(page.getByTestId("level-about")).toContainText("Text stays sharp");
    await expect(page.getByTestId("primary-action")).toHaveText("Compress PDF");
    await run(page);
    await expect(page.getByTestId("result-summary")).toContainText(/MB → .*Saved \d+%/);
    const dl = await savePdf(page);
    expect(dl.bytes.length).toBeLessThan(readFileSync(corpus("image-mixed")).length);
    expect((await readPdf(dl.bytes)).length).toBe((await readPdf(readFileSync(corpus("image-mixed")))).length);
  });

  test("A-COR-5 A-E2E-1 compress: compressing a compressed file returns it unchanged with a plain note", async ({ page }) => {
    await loadApp(page, "/#/compress");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("level-light").check();
    await run(page);
    const first = await savePdf(page); // already smaller than the input; run it through again
    await page.getByTestId("clear-all").click();
    await add(page, first.path);
    await readyRows(page, 1);
    await run(page);
    await expect(page.getByTestId("results")).toContainText("already compact");
    await expect(page.getByTestId("result-summary")).toContainText(/→/);
    const dl = await savePdf(page);
    expect(dl.bytes.equals(first.bytes)).toBe(true);
  });

  test("A-COR-6 A-E2E-1 page numbers: top right, 'Page 1 of 3' on every page", async ({ page }) => {
    await loadApp(page, "/#/page-numbers");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("pos-top-right").check();
    await page.getByTestId("format-select").selectOption("Page {n} of {total}");
    await expect(page.getByTestId("primary-action")).toHaveText("Add page numbers");
    await run(page);
    const dl = await savePdf(page);
    const pages = await readPdf(dl.bytes);
    expect(pages.map((p) => /Page \d of 3/.exec(p.text)?.[0])).toEqual(["Page 1 of 3", "Page 2 of 3", "Page 3 of 3"]);
    const at = await findText(dl.bytes, 0, "Page 1 of 3");
    expect(at!.x).toBeGreaterThan(at!.w / 2);
    expect(at!.y).toBeGreaterThan(at!.h / 2); // origin bottom-left, so top = large y
    expect(Math.abs(at!.angle)).toBeLessThan(1);
  });

  test("A-COR-6 A-E2E-1 page numbers: only pages 2-3, counting from 1", async ({ page }) => {
    await loadApp(page, "/#/page-numbers");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("pages-range").check();
    await page.getByTestId("pages-input").fill("2-3");
    await page.getByTestId("format-select").selectOption("{n} / {total}");
    await run(page);
    const pages = await readPdf((await savePdf(page)).bytes);
    expect(pages[0].text).not.toMatch(/\d \/ \d/);
    expect(pages[1].text).toContain("1 / 2");
    expect(pages[2].text).toContain("2 / 2");
  });

  test("A-COR-6 A-E2E-1 watermark: text lands on every page and stays extractable", async ({ page }) => {
    await loadApp(page, "/#/watermark");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await expect(page.getByTestId("primary-action")).toBeDisabled(); // no text yet
    await page.getByTestId("wm-text").fill("DRAFT");
    await page.getByTestId("wm-colour").fill("#cc0000");
    await page.getByTestId("layer-under").check();
    await page.getByTestId("angle-custom").check();
    await page.getByTestId("wm-angle-custom").fill("30");
    await page.getByTestId("wm-opacity").fill("40");
    await expect(page.getByTestId("primary-action")).toHaveText("Add watermark");
    await run(page);
    const pages = await readPdf((await savePdf(page)).bytes);
    expect(pages).toHaveLength(3);
    for (const p of pages) expect(p.text).toContain("DRAFT");
    expect(pages.map((p) => /PAGE-MARKER (\S+)/.exec(p.text)?.[1])).toEqual(["p1", "p2", "p3"]);
  });

  test("D20 watermark: Vietnamese text downloads and re-opens", async ({ page }) => {
    await loadApp(page, "/#/watermark");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("wm-text").fill("Bản nháp");
    await expect(page.getByTestId("wm-text-msg")).toHaveText("");
    await run(page);
    const pages = await readPdf((await savePdf(page)).bytes);
    expect(pages).toHaveLength(3);
    for (const p of pages) expect(p.text).toContain("Bản nháp");
  });

  test("A-COR-6 watermark: characters the PDF font cannot draw are explained before running", async ({ page }) => {
    await loadApp(page, "/#/watermark");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("wm-text").fill("草稿 DRAFT");
    await expect(page.getByTestId("wm-text-msg")).toContainText("cannot be used yet");
    await expect(page.getByTestId("wm-text-msg")).toContainText("草");
    await expect(page.getByTestId("primary-action")).toBeDisabled();
    await page.getByTestId("wm-text").fill("Café – DRAFT €");
    await expect(page.getByTestId("wm-text-msg")).toHaveText("");
    await expect(page.getByTestId("primary-action")).toBeEnabled();
  });

  test("A-COR-10 A-E2E-1 metadata: details are read on load, an edit changes only that field", async ({ page }) => {
    await loadApp(page, "/#/metadata");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await expect(page.getByTestId("md-title")).toHaveValue("Quarterly notes (made up)");
    await expect(page.getByTestId("md-author")).toHaveValue("Sample Author");
    await expect(page.getByTestId("md-credit")).toContainText("MossPDF by Vin's Atelier");
    await expect(page.getByTestId("primary-action")).toBeDisabled(); // nothing changed yet
    await page.getByTestId("md-title").fill("Board notes");
    await page.getByTestId("md-keywords").fill("one, two");
    await expect(page.getByTestId("primary-action")).toHaveText("Save details");
    await run(page);
    const info = await readInfo((await savePdf(page)).bytes);
    expect(info.Title).toBe("Board notes");
    expect(info.Author).toBe("Sample Author");
    expect(info.Keywords).toBe("one, two");
    expect(info.Producer).toBe("MossPDF by Vin's Atelier");
  });

  test("A-COR-10 A-E2E-1 metadata: 'Remove all details' leaves no title, author or credit", async ({ page }) => {
    await loadApp(page, "/#/metadata");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await expect(page.getByTestId("md-title")).toHaveValue("Quarterly notes (made up)");
    await page.getByTestId("md-remove-all").check();
    await expect(page.getByTestId("md-title")).toBeDisabled();
    await expect(page.getByTestId("md-credit")).toContainText("Nothing is added");
    await expect(page.getByTestId("primary-action")).toHaveText("Remove all details");
    await run(page);
    const dl = await savePdf(page);
    const info = await readInfo(dl.bytes);
    expect(info.Title).toBeUndefined();
    expect(info.Author).toBeUndefined();
    expect(info.Producer).toBeUndefined();
    expect((await readPdf(dl.bytes)).length).toBe(3);
  });

  test("A-E2E-4 keyboard only: watermark flow", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only is for desktop input");
    await loadApp(page, "/#/watermark");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("wm-text").focus();
    await page.keyboard.type("COPY");
    await page.getByTestId("angle-45").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("angle-90")).toBeChecked();
    await page.getByTestId("primary-action").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("results")).toBeVisible();
    const dl = await downloadAndCheck(page, async () => {
      await page.getByTestId("result-download").focus();
      await page.keyboard.press("Enter");
    });
    expect(qpdfCheck(dl.path).ok).toBe(true);
    for (const p of await readPdf(dl.bytes)) expect(p.text).toContain("COPY");
  });

  test("A-E2E-4 keyboard only: page number position picker uses the arrow keys", async ({ page }) => {
    test.skip(isMobile(), "keyboard-only is for desktop input");
    await loadApp(page, "/#/page-numbers");
    await add(page, corpus("plain-3p"));
    await readyRows(page, 1);
    await page.getByTestId("pos-bottom-center").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("pos-bottom-right")).toBeChecked();
  });
});

// ---- views with files loaded (axe, overflow) ----
const loaded = (route: string, ...files: string[]) => async (page: Page) => {
  await loadApp(page, route);
  await add(page, ...files);
  await readyRows(page, files.length);
};
const VIEWS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: "images-to-pdf", open: loaded("/#/images-to-pdf", image("exif6-40x20.jpg"), image("wide-40x20.png")) },
  { name: "pdf-to-images", open: loaded("/#/pdf-to-images", corpus("plain-3p")) },
  { name: "compress", open: loaded("/#/compress", corpus("plain-3p")) },
  { name: "page-numbers", open: loaded("/#/page-numbers", corpus("plain-3p")) },
  { name: "watermark", open: loaded("/#/watermark", corpus("plain-3p")) },
  { name: "metadata", open: async (p) => { await loaded("/#/metadata", corpus("plain-3p"))(p); await expect(p.getByTestId("md-title")).toHaveValue("Quarterly notes (made up)"); } },
];

for (const theme of THEMES) {
  for (const v of VIEWS) {
    test(`A-E2E-3 axe: ${v.name} (${theme})`, async ({ page }) => {
      await v.open(page);
      await setTheme(page, theme);
      await checkA11y(page, `${v.name} ${theme}`);
    });
  }
}

for (const v of VIEWS) {
  test(`A-E2E-5 no horizontal overflow: ${v.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await v.open(page);
    for (const [w, h] of [[1280, 800], [768, 900], [375, 800], [320, 700], [640, 500]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      await expectNoOverflow(page);
    }
  });
}
