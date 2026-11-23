// PDF to Word: a generated PDF with a heading and two paragraphs comes back as a .docx.
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { test, expect, downloadAndCheck, loadApp } from "./fixtures";

test("pdf to word: heading, paragraphs and escaped characters", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([595, 842]);
  p.drawText("Big Heading", { x: 72, y: 760, size: 28, font });
  p.drawText("First paragraph line one", { x: 72, y: 700, size: 12, font });
  p.drawText("continues here <&> done", { x: 72, y: 686, size: 12, font });
  p.drawText("Second paragraph", { x: 72, y: 640, size: 12, font });
  const bytes = Buffer.from(await pdf.save());
  await loadApp(page, "/#/pdf-to-word");
  await page.getByTestId("file-input").setInputFiles({ name: "doc.pdf", mimeType: "application/pdf", buffer: bytes });
  await expect(page.locator('[data-testid="file-row"][data-status="ready"]')).toHaveCount(1);
  await page.getByTestId("primary-action").click();
  const dl = await downloadAndCheck(page, () => page.getByTestId("result-download").click());
  expect(dl.name).toBe("doc.docx");
  const xml = strFromU8(unzipSync(new Uint8Array(dl.bytes))["word/document.xml"]);
  expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
  expect(xml).toContain("Big Heading");
  expect(xml).toContain("First paragraph line one continues here &lt;&amp;&gt; done");
  expect(xml).toContain("Second paragraph");
  expect((xml.match(/<w:p>/g) ?? []).length).toBe(3);
});
