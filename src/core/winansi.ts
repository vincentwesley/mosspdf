// Which characters the PDF ops can draw. Pure (no pdf-lib), so the main bundle can use it for its gates (D20).
// WinAnsi = what Helvetica draws: printable ASCII, Latin-1 and the extra characters in 0x80-0x9F.
export const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]$/;
// What the bundled Noto Sans subset covers (the ranges it was cut with, so a few unassigned code points in them are still refused by the op):
// Latin, Latin Extended, Vietnamese, Greek, Cyrillic, general punctuation, currency.
export const UNICODE_OK = /^[\x20-\x7e\xa0-\u024f\u0259\u02b0-\u036f\u0370-\u03ff\u0400-\u052f\u1e00-\u1eff\u2000-\u206f\u20a0-\u20bf\u2116\u2122\u2190-\u2193\u2212\u2215\ufb01\ufb02]$/;
/** Characters of `text` that no font we ship can draw (newlines are ignored). */
export const badChars = (text: string) => [...new Set([...text])].filter((c) => c !== "\n" && c !== "\r" && !UNICODE_OK.test(c));
