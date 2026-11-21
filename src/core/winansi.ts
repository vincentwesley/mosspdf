import { zhOn } from "./zhfont";
// Which characters the PDF ops can draw. Pure (no pdf-lib), so the main bundle can use it for its gates (D20).
// WinAnsi = what Helvetica draws: printable ASCII, Latin-1 and the extra characters in 0x80-0x9F.
export const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]$/;
// What the bundled Noto Sans subset covers (the ranges it was cut with, so a few unassigned code points in them are still refused by the op):
// Latin, Latin Extended, Vietnamese, Greek, Cyrillic, general punctuation, currency.
export const UNICODE_OK = /^[\x20-\x7e\xa0-\u024f\u0259\u02b0-\u036f\u0370-\u03ff\u0400-\u052f\u1e00-\u1eff\u2000-\u206f\u20a0-\u20bf\u2116\u2122\u2190-\u2193\u2212\u2215\ufb01\ufb02]$/;
// What the optional Simplified Chinese font covers beyond ASCII/Latin-1 (D24): CJK punctuation, hanzi (GB2312 in practice), full-width forms.
export const ZH_OK = /^[\x20-\x7e\xa0-\xff\u2000-\u206f\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]$/;
export const ZH_HINT = ' To use Chinese text, press "Chinese text" at the bottom of the page. It loads a 2 MB font and reloads the tab, so add your files again afterwards.';
/** Characters of `text` that no font we ship can draw (newlines are ignored). With `zh` the Chinese font counts too (D24). */
export const badChars = (text: string, zh = zhOn()) => {
  const cs = [...new Set([...text])].filter((c) => c !== "\n" && c !== "\r");
  // One font per text: once a character needs the Chinese font, everything must be in it (Greek or Cyrillic next to hanzi is refused).
  const needZh = zh && cs.some((c) => !UNICODE_OK.test(c) && ZH_OK.test(c));
  return cs.filter((c) => (needZh ? !ZH_OK.test(c) : !UNICODE_OK.test(c) && !(zh && ZH_OK.test(c))));
};
/** True when `bad` has characters the Chinese font would draw, i.e. turning it on helps. */
export const zhWouldHelp = (bad: string[]) => !zhOn() && bad.some((c) => ZH_OK.test(c));
