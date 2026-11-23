// Extract images and Split by bookmarks, on generated PDFs.
import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";
import { unzipSync, zlibSync } from "fflate";
import { test, expect, downloadAndCheck, loadApp } from "./fixtures";

const rawImage = (d: PDFDocument, w: number, h: number, data: Uint8Array, filter: string) =>
  d.context.register(PDFRawStream.of(d.context.obj({ Type: "XObject", Subtype: "Image", Width: w, Height: h, BitsPerComponent: 8, ColorSpace: "DeviceRGB", Filter: filter, Length: data.length }), data));

async function addPdf(page: import("@playwright/test").Page, name: string, bytes: Uint8Array) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
}

test("extract images: a JPEG stays byte for byte, a Flate picture becomes a PNG, in one zip", async ({ page }) => {
  const d = await PDFDocument.create();
  const jpg = Uint8Array.from([0xff, 0xd8, 9, 8, 7, 6, 0xff, 0xd9]);
  const p1 = d.addPage([200, 200]);
  const xo = d.context.obj({});
  (xo as unknown as { set(k: PDFName, v: unknown): void }).set(PDFName.of("A"), rawImage(d, 80, 80, jpg, "DCTDecode"));
  p1.node.Resources()!.set(PDFName.of("XObject"), xo);
  const p2 = d.addPage([200, 200]);
  const xo2 = d.context.obj({});
  (xo2 as unknown as { set(k: PDFName, v: unknown): void }).set(PDFName.of("B"), rawImage(d, 4, 4, zlibSync(new Uint8Array(48).fill(200)), "FlateDecode"));
  p2.node.Resources()!.set(PDFName.of("XObject"), xo2);
  await loadApp(page, "/#/extract-images");
  await addPdf(page, "pics.pdf", await d.save());
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("download-zip").click());
  expect(dl.name).toBe("pics-images.zip");
  const files = unzipSync(new Uint8Array(dl.bytes));
  expect(Object.keys(files).sort()).toEqual(["page-1-1.jpg", "page-2-1.png"]);
  expect(Array.from(files["page-1-1.jpg"])).toEqual(Array.from(jpg));
  expect([...files["page-2-1.png"].subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
});

test("split by bookmarks: disabled without bookmarks", async ({ page }) => {
  const plain = await PDFDocument.create();
  for (let i = 0; i < 4; i++) plain.addPage([200, 200]);
  await loadApp(page, "/#/split");
  await addPdf(page, "plain.pdf", await plain.save());
  await expect(page.getByTestId("mode-bookmarks")).toBeDisabled();
  await expect(page.getByTestId("bookmarks-hint")).toContainText("no bookmarks");
});

test("split by bookmarks: one file per top-level bookmark", async ({ page }) => {
  const d = await PDFDocument.create();
  for (let i = 0; i < 4; i++) d.addPage([200, 200]);
  const { writeOutlineItems } = await import("../src/ops/outline");
  writeOutlineItems(d, [{ title: "Intro", page: 1, level: 0 }, { title: "Part: Two", page: 3, level: 0 }, { title: "sub", page: 4, level: 1 }]);
  await loadApp(page, "/#/split");
  await addPdf(page, "book.pdf", await d.save());
  await page.getByTestId("mode-bookmarks").check();
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("result-row")).toHaveCount(2);
  const dl = await downloadAndCheck(page, () => page.getByTestId("download-zip").click());
  expect(Object.keys(unzipSync(new Uint8Array(dl.bytes))).sort()).toEqual(["Intro.pdf", "Part Two.pdf"]);
});
