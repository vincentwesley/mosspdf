import { describe, expect, it } from "vitest";
import type { ReportData } from "../../src/core/compare";
import { badChars } from "../../src/core/winansi";
import { addPageNumbers, addTextLayer, compareReport, fillForm, stampPage, watermark } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const VI = "Đặng Thị Hồng", PL = "Łukasz Żółć", EXTRA = "Nguyễn Ş Ελλάδα Привет";
const all = async (b: Uint8Array) => (await readPdf(b)).map((p) => p.text).join(" ");

describe("D20 text beyond WinAnsi", () => {
  it("the client gate agrees: Latin Extended, Vietnamese, Greek, Cyrillic pass; CJK and emoji are named", () => {
    expect(badChars(`${VI} ${PL} ${EXTRA}`)).toEqual([]);
    expect(badChars("李 ok 🙂")).toEqual(["李", "🙂"]);
  });
  it("watermark and page numbers", async () => {
    for (const t of [VI, PL, EXTRA]) {
      const w = await watermark(corpus("plain-3p"), { text: t }, opts(), engines);
      qpdfCheck(w.bytes);
      expect(await all(w.bytes)).toContain(t);
    }
    const n = await addPageNumbers(corpus("plain-3p"), { format: "Trang {n} / {total} Đặng Łukasz" }, opts(), engines);
    qpdfCheck(n.bytes);
    expect(await all(n.bytes)).toContain("Trang 2 / 3 Đặng Łukasz");
  });
  it("pure WinAnsi text keeps Helvetica (no embedded font)", async () => {
    const w = await watermark(corpus("plain-3p"), { text: "CAFÉ Ñ" }, opts(), engines);
    expect(new TextDecoder("latin1").decode(w.bytes)).not.toContain("FontFile2");
    const u = await watermark(corpus("plain-3p"), { text: VI }, opts(), engines);
    expect(new TextDecoder("latin1").decode(u.bytes)).toContain("FontFile2");
  });
  it("characters no font covers are refused by name", async () => {
    await expect(watermark(corpus("plain-3p"), { text: "李小龍" }, opts(), engines)).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining('"李"') });
  });
  it("sign text", async () => {
    const r = await stampPage(corpus("plain-3p"), { images: [], items: [{ kind: "text", text: `${VI} / ${PL}`, size: 14, fx: 0.2, fy: 0.5, pages: "all" }] }, opts(), engines);
    qpdfCheck(r.bytes);
    expect(await all(r.bytes)).toContain(`${VI} / ${PL}`);
  });
  it("fill forms, with and without flatten", async () => {
    for (const flatten of [false, true]) {
      const r = await fillForm(corpus("forms-2p"), { full_name: VI, notes: `${PL}\n${EXTRA}` }, { flatten }, opts(), engines);
      qpdfCheck(r.bytes);
      const t = await all(r.bytes);
      if (flatten) expect(t).toContain(VI);
    }
    const r = await fillForm(corpus("forms-2p"), { full_name: VI }, {}, opts(), engines);
    const { readForm } = await import("../../src/ops");
    expect((await readForm({ name: "x.pdf", bytes: r.bytes }, {}, engines)).fields.find((f) => f.name === "full_name")?.value).toBe(VI);
  });
  it("OCR text layer", async () => {
    const words = [VI, PL].map((text, i) => ({ text, x0: 50, x1: 250, y0: 50 + i * 60, y1: 90 + i * 60, eol: true })) as never[];
    const r = await addTextLayer(corpus("scan-1p"), [{ page: 0, width: 600, height: 800, words }], opts(), engines);
    qpdfCheck(r.bytes);
    expect(await all(r.bytes)).toContain(VI);
  });
  it("comparison report", async () => {
    const d: ReportData = { nameA: "a.pdf", nameB: "b.pdf", date: "2026-01-01", summary: "1 change", notes: [], changes: [{ label: "Change 1", removed: PL, added: VI }] };
    const r = await compareReport(d, opts());
    qpdfCheck(r.bytes);
    const t = await all(r.bytes);
    expect(t).toContain(VI);
    expect(t).toContain(PL);
  });
});
