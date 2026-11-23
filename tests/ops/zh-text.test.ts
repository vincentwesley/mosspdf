import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { badChars, zhWouldHelp } from "../../src/core/winansi";
import { addPageNumbers, fillForm, stampPage, watermark } from "../../src/ops";
import { setUnicodeFont } from "../../src/ops/ufont";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const ZH = "机密文件 你好，世界！";
const all = async (b: Uint8Array) => (await readPdf(b)).map((p) => p.text).join("");
const font = (n: string) => new URL(`../../src/fonts/${n}`, import.meta.url);
const noto = new Uint8Array(readFileSync(font("notosans-unicode-400-normal.ttf")));
const sc = new Uint8Array(readFileSync(font("notosanssc-gb2312-400-normal.ttf")));

describe("D24 optional Simplified Chinese font", () => {
  it("is off by default: refused by name, with the switch offered", async () => {
    setUnicodeFont(noto);
    await expect(watermark(corpus("plain-3p"), { text: "机密" }, opts(), engines)).rejects.toMatchObject({ message: expect.stringContaining("Extra text") });
    expect(zhWouldHelp(badChars("机密", undefined))).toBe(true);
  });
  it("round-trips in a stamp, page numbers and a form field; Tamil stays refused", async () => {
    setUnicodeFont(noto, sc);
    const w = await watermark(corpus("plain-3p"), { text: "机密文件" }, opts(), engines);
    qpdfCheck(w.bytes);
    expect(await all(w.bytes)).toContain("机密文件");
    const n = await addPageNumbers(corpus("plain-3p"), { format: "第 {n} 页，共 {total} 页" }, opts(), engines);
    expect(await all(n.bytes)).toContain("第 2 页，共 3 页");
    const s = await stampPage(corpus("plain-3p"), { images: [], items: [{ kind: "text", text: ZH, size: 14, fx: 0.2, fy: 0.5, pages: "all" }] }, opts(), engines);
    expect((await all(s.bytes)).replace(/\s/g, "")).toContain(ZH.replace(/\s/g, ""));
    const f = await fillForm(corpus("forms-2p"), { full_name: "张三" }, { flatten: true }, opts(), engines);
    qpdfCheck(f.bytes);
    expect(await all(f.bytes)).toContain("张三");
    expect(f.bytes.length).toBeLessThan(400_000); // subset: only the used glyphs travel, not the 2 MB font
    await expect(watermark(corpus("plain-3p"), { text: "தமிழ்" }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    setUnicodeFont(noto);
  });
  it("the shipped font stays small and the client gate follows the switch", () => {
    expect(statSync(font("notosanssc-gb2312-400-normal.ttf")).size).toBeLessThan(2.4 * 1024 * 1024);
    expect(badChars("机密，ＡＢ", "sc")).toEqual([]);
    expect(badChars("தமிழ்", "sc")).toHaveLength(5);
  });
  const langs = { tc: ["notosanstc-big5-400-normal.ttf", "機密文件 繁體中文，你好！"], jp: ["notosansjp-jisx0208-400-normal.ttf", "機密文書 こんにちは、カタカナ！"], kr: ["notosanskr-hangul-400-normal.ttf", "기밀 문서 안녕하세요！"] } as const;
  for (const [lang, [file, text]] of Object.entries(langs)) {
    it(`D30 ${lang}: a sample renders, extracts, and the font stays small`, async () => {
      expect(statSync(font(file)).size).toBeLessThan(3 * 1024 * 1024);
      setUnicodeFont(noto, new Uint8Array(readFileSync(font(file))));
      expect(badChars(text, lang as "tc")).toEqual([]);
      const s = await stampPage(corpus("plain-3p"), { images: [], items: [{ kind: "text", text, size: 14, fx: 0.2, fy: 0.5, pages: "all" }] }, opts(), engines);
      qpdfCheck(s.bytes);
      expect((await all(s.bytes)).replace(/\s/g, "")).toContain(text.replace(/\s/g, ""));
      setUnicodeFont(noto);
    });
  }
  it("D30 the gate is per language", () => {
    expect(badChars("こんにちは", "sc")).toHaveLength(5);
    expect(zhWouldHelp(badChars("こんにちは", "sc"), "sc")).toBe(true);
    expect(badChars("안녕", "jp")).toHaveLength(2);
    expect(badChars("안녕", "kr")).toEqual([]);
  });
});
