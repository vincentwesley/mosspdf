// PDF to PowerPoint and PDF to Markdown: the .pptx parts and the Markdown rules.
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vitest";
import type { Line } from "../../src/core/docx";
import { mdEscape, pageMarkdown } from "../../src/core/markdown";
import { buildPptx } from "../../src/core/pptx";

const line = (text: string, y: number, size = 12, x = 72): Line => ({ runs: [{ text, bold: false, italic: false }], x, y, size });

test("pptx: parts, slide count, balanced XML", () => {
  const z = unzipSync(buildPptx([{ jpeg: Uint8Array.of(1, 2), width: 1000, height: 500 }, { jpeg: Uint8Array.of(3), width: 500, height: 500 }]));
  for (const k of ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/media/image1.jpeg", "ppt/media/image2.jpeg"]) expect(z[k], k).toBeTruthy();
  expect(Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(2);
  expect(strFromU8(z["ppt/presentation.xml"])).toContain('<p:sldSz cx="12192000" cy="6096000"/>');
  for (const [k, v] of Object.entries(z)) {
    if (!/\.(xml|rels)$/.test(k)) continue;
    const s = strFromU8(v).replace(/<\?xml[^>]*\?>/, "");
    const stack: string[] = [];
    for (const m of s.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) expect(stack.pop(), k).toBe(m[2]); else stack.push(m[2]);
    }
    expect(stack, k).toEqual([]);
  }
});

test("markdown: headings, paragraphs, lists, escaping", () => {
  const md = pageMarkdown([line("Title", 700, 24), line("Some *text* with", 660), line("two lines", 646), line("• apple", 600), line("• pear_x", 586), line("1. one", 560), line("2. two", 546)]);
  expect(md).toBe(["# Title", "", "Some \\*text\\* with two lines", "", "- apple", "- pear\\_x", "", "1. one", "2. two"].join("\n"));
  expect(mdEscape("# not a heading")).toBe("\\# not a heading");
  expect(mdEscape("2024. a year")).toBe("2024\\. a year");
});
