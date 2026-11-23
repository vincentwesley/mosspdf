import { cjkLang, type Lang } from "./zhfont";
// Which characters the PDF ops can draw. Pure (no pdf-lib), so the main bundle can use it for its gates (D20).
// WinAnsi = what Helvetica draws: printable ASCII, Latin-1 and the extra characters in 0x80-0x9F.
export const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]$/;
// What the bundled Noto Sans subset covers (the ranges it was cut with, so a few unassigned code points in them are still refused by the op):
// Latin, Latin Extended, Vietnamese, Greek, Cyrillic, general punctuation, currency.
export const UNICODE_OK = /^[\x20-\x7e\xa0-\u024f\u0259\u02b0-\u036f\u0370-\u03ff\u0400-\u052f\u1e00-\u1eff\u2000-\u206f\u20a0-\u20bf\u2116\u2122\u2190-\u2193\u2212\u2215\ufb01\ufb02]$/;
// What each optional CJK font covers beyond ASCII/Latin-1 (D24, D30): punctuation, full-width forms and the language's scripts (hanzi ranges are the whole block;
// characters outside the font's character set pass this gate and are refused by the op).
const CJK = String.raw`\x20-\x7e\xa0-\xff\u2000-\u206f\u3000-\u303f\uff00-\uffef`;
export const CJK_OK: Record<Lang, RegExp> = {
  sc: new RegExp(String.raw`^[${CJK}\u4e00-\u9fff]$`),
  tc: new RegExp(String.raw`^[${CJK}\u4e00-\u9fff]$`),
  jp: new RegExp(String.raw`^[${CJK}\u3040-\u30ff\u4e00-\u9fff]$`),
  kr: new RegExp(String.raw`^[${CJK}\u3130-\u318f\uac00-\ud7a3]$`),
};
/** Any character one of the four fonts could draw beyond the Noto Sans subset. */
export const CJK_ANY = /^[\u3000-\u9fff\uac00-\ud7a3\uff00-\uffef]$/;
export const ZH_HINT = ' To use these characters, pick the language under "Extra text" at the bottom of the page. It loads a 2 MB font and reloads the tab, so add your files again afterwards.';
/** Characters of `text` that no font we ship can draw (newlines are ignored). With `lang` that language's font counts too. */
export const badChars = (text: string, lang = cjkLang()) => {
  const cs = [...new Set([...text])].filter((c) => c !== "\n" && c !== "\r");
  const ok = lang && CJK_OK[lang];
  // One font per text: once a character needs the CJK font, everything must be in it (Greek or Cyrillic next to hanzi is refused).
  const needCjk = ok && cs.some((c) => !UNICODE_OK.test(c) && ok.test(c));
  return cs.filter((c) => (needCjk ? !ok.test(c) : !UNICODE_OK.test(c) && !(ok && ok.test(c))));
};
/** True when `bad` has characters a CJK font would draw that the chosen one does not, i.e. changing "Extra text" helps. */
export const zhWouldHelp = (bad: string[], lang = cjkLang()) => bad.some((c) => CJK_ANY.test(c) && !(lang && CJK_OK[lang].test(c)));
