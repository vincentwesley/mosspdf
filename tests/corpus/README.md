# Test corpus

`node scripts/corpus.mjs` writes everything below into `tests/corpus/generated/` (gitignored, deterministic; Vitest regenerates it when missing). All files are self-generated with pdf-lib and the qpdf CLI from made-up text and names, released under CC0. Each page carries the text `PAGE-MARKER <prefix><n>` so tests can read back which page is which.

| File | What it is |
|---|---|
| plain-3p | 3 pages (p1-p3) with Title/Author/Producer/Creator set (Producer "pdf-lib (test default)") |
| mixed-sizes | A4, Letter, A3 landscape (m1-m3) |
| rotated | 4 pages with /Rotate 0, 90, 180, 270 (r1-r4) |
| links-annots | URI link, internal GoTo link to page 3, text annotation |
| outline | 4 bookmarks, one per page |
| forms | AcroForm: text, checkbox, radio group (2 widgets), dropdown |
| signed | A /Sig field with a signature dictionary (looks signed, not cryptographically valid) |
| javascript | JavaScript /OpenAction |
| encrypted-aes256 | plain-3p, AES-256, password `test-pass` |
| encrypted-rc4-40 | plain-3p, RC4 40-bit, password `test-pass` |
| corrupt | plain-3p with 600 random bytes overwritten in the middle |
| truncated | plain-3p cut at 60% |
| empty | 0 bytes |
| renamed-png / renamed-text | a 1x1 PNG / a text line, named `.pdf` |
| broken-xref | 10 bytes inserted after the header so every xref offset is wrong |
| text-500p, text-1000p | text-only (k1..kN) for performance and size tests |
| image-heavy | about 19 MB: 5 pages of seeded random-noise RGB images (Flate-compressed, not JPEG: no JPEG encoder is bundled) |

`node scripts/corpus.mjs --external` also downloads `tests/corpus/external/irs-fw9.pdf` (IRS Form W-9, a US federal work, public domain under 17 USC 105), checked against a pinned sha256. Skipped quietly when offline or when the IRS has republished the file. Tests do not depend on it.

## M3 safety and password fixtures
`risk-js-openaction`, `risk-js-names` (JavaScript name tree), `risk-page-aa`, `risk-annot-aa`, `risk-launch`, `risk-embedded` (name-tree attachment + FileAttachment annotation), `risk-submit`, `risk-importdata`, `risk-uri` (two links), `risk-gotor`, `risk-gotoe`, `risk-richmedia`, `risk-xfa` (AcroForm + XFA), `risk-jbig2`. `risk-everything` combines all of these (except JBIG2); `-objstm` is the same content in object streams and `-encrypted` is AES-256 with user password `user-pass`. `restricted-owner-only`: opens without a password, owner password `owner-pass`, print/copy/edit denied. `encrypted-user-owner`: user `user-pass`, owner `owner-pass`, print/copy denied. Clean files: plain-3p, forms, outline, mixed-sizes.

## M4 fill and sign fixtures
`forms-2p`: two pages, the second turned 90 degrees; text, multiline text, max-length text (4), checkbox, radio group (a, b), dropdown, option list, a read-only text field (REF-001), and a text field on page 2. `xfa-only`: AcroForm with an XFA entry and no fields. Also used: `forms`, `signed` (/ByteRange + /Type /Sig), `risk-xfa` (AcroForm + XFA hybrid), `rotated`, `rotated-crop`.
