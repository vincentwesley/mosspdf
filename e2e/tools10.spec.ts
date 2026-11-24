// PDF to PowerPoint and PDF to Markdown on a generated 2-page PDF.
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import { test, expect, downloadAndCheck, loadApp } from "./fixtures";

async function pdf() {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p1 = d.addPage([595, 842]);
  p1.drawText("Big Heading", { x: 72, y: 760, size: 28, font });
  p1.drawText("A plain paragraph", { x: 72, y: 700, size: 12, font });
  d.addPage([595, 842]).drawText("Page two", { x: 72, y: 760, size: 12, font });
  return Buffer.from(await d.save());
}
async function open(page: import("@playwright/test").Page, id: string) {
  await loadApp(page, `/#/${id}`);
  await page.getByTestId("file-input").setInputFiles({ name: "doc.pdf", mimeType: "application/pdf", buffer: await pdf() });
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await page.getByTestId("primary-action").click();
}

test("pdf to ppt: one slide and one picture per page", async ({ page }) => {
  await open(page, "pdf-to-ppt");
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  expect(dl.name).toBe("doc.pptx");
  const z = unzipSync(new Uint8Array(dl.bytes));
  expect(Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(2);
  expect(Object.keys(z).filter((k) => k.startsWith("ppt/media/"))).toHaveLength(2);
  expect([...z["ppt/media/image1.jpeg"].subarray(0, 2)]).toEqual([0xff, 0xd8]);
});

test("pdf to markdown: heading and paragraph", async ({ page }) => {
  await open(page, "pdf-to-markdown");
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  expect(dl.name).toBe("doc.md");
  const md = strFromU8(new Uint8Array(dl.bytes));
  expect(md).toContain("# Big Heading");
  expect(md).toContain("A plain paragraph");
  expect(md).toContain("Page two");
});
