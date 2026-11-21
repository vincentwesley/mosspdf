# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
- Design pass (D26): an icon for every tool, category chips and a three-step cue on home, a larger add-files button, choice cards for Compress, a clearer result card and Chinese text switch.
- Optional Simplified Chinese text (D24): the "Chinese text" switch in the footer loads a 2.2 MB font (about 6,700 common hanzi) before the page seals; fill forms, watermark, page numbers, sign text and the compare report can then use it.
- Tool code moved to its own chunk, loaded before the seal (D25); main bundle 63 to 25 KB gzip.
- Sign on phones: "Make your signature" folds away once placed, and the page comes before the placed list.

## [1.3.0] - 2026-11-21
- Renamed to MossPDF; new address https://mosspdf.pages.dev.
- Liberation Sans is no longer shipped (D22).
- licences.txt is linked from the footer; Terms added to the privacy page.
- Clearer wording on redaction, OCR, signatures, the accessibility check and the clean-copy workflow.

## [1.2.1] - 2026-11-21
- Safety scan uses far less memory on large files (+593 MB to +69 MB on a 193 MB file); repair one input copy less (+772 MB to +578 MB). Results unchanged (docs/PERF.md).

## [1.2.0] - 2026-11-21

- OCR in Chinese (Simplified), Malay and Tamil as well as English, picked on the OCR page and loaded only when chosen; the hidden text layer now uses a glyphless font, so any script is kept.

## [1.1.0] - 2026-11-21
- Unicode text: names like Đặng Thị Hồng, Łukasz, Ş, Greek and Cyrillic now work in fill, page numbers, watermark, sign text, OCR layer and the comparison report (Noto Sans subset, only embedded when needed). CJK, Tamil and emoji are still refused by name.

## [1.0.0] - 2026-11-21
- M9: persona walkthroughs (docs/USABILITY.md) and two polish passes: Sign offered after Merge, 48px file-row and footer tap targets, a reason line when the main button is disabled, placed signatures scroll into view, a carried-over files notice with Clear, a large-file notice while working.
- Privacy page names Cloudflare's standard request logs and lists recently used tools as stored.
- Release zip (`npm run release`) with a one-file local server (`serve.mjs`) that applies the site's security headers.
- Large-file timings (docs/PERF.md), README with screenshots.
- M8: command palette (Ctrl/Cmd+K, header button) and a shortcuts list (?); workflows Small enough to email, Safe to share and Job application pack; batch mode for compress, page numbers, watermark, protect, details and repair (results in a .zip); accessibility check with a saved .txt report.
- M1: shell, file intake, page grid, merge, split, organize, extract, seal and privacy panel, offline PWA.
- M2: images to PDF, PDF to images, compress, page numbers, watermark, document details.
- M3: add/remove password (correct password only), safety scan with cleaned copy, repair.
- M4: fill forms (on-page controls plus a synced fields list, flatten, XFA and signed-PDF warnings) and sign (draw, type or upload a signature, initials, date, text; placed by click, drag, keys). Visual signature only, nothing is stored.
- M7: compare two PDFs (Original / Changed): word diff with ignore case and punctuation, change list, side by side with boxed words, pixel overlay, report PDF and optional .txt.
- M6: redact (SG NRIC/FIN with checksum, phones, emails, addresses, search, hand-drawn boxes, review list; affected pages become pictures plus a hidden text layer, metadata and attachments stripped, verified before saving) and photo clean (EXIF/GPS shown then removed, blur or pixelate boxes; no automatic face detection).
