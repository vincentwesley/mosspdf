# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.0.0] - 2026-11-26
Launch polish (roadmap v2.0, D39).
- A page for every tool (`/tools/merge/` and so on) with a short how-to and links to related tools, a help page with answers about privacy, offline use, limits and browsers, plus a sitemap and robots.txt. Same strict security headers as the app; no trackers.
- Help is linked in the footer and the command palette.
- Design pass on phones, tablets and desktops in dark and light:
  - Inside a tool the file tray now lists only files that tool won't use (with the reason), so the tool's options start higher on phones.
  - Conversions (Word, Markdown, PowerPoint...) no longer show a misleading "Saved 98%".
  - My workflows: the step buttons line up.
  - The remove button stays on the file's row on phones; no empty options box while a file is still locked; the "Use Merge" tip only shows when it helps; the privacy log header no longer breaks mid-word.
- Faster first view on slow connections: the tool code loads before the PDF engines, and the footer no longer jumps while the page starts. Lighthouse 96-100 on the home and Merge pages (docs/PERF.md).
- COMPARISON, LEGAL-REVIEW and README refreshed (36 tools and 4 workflows).

## [1.12.0] - 2026-11-24
Fill and sign (roadmap v1.12, D38).
- Create form: add text, multi-line, checkbox, date, dropdown and signature-area fields to a PDF so others can fill it in; then test it in Fill forms.
- Sign: keep signatures and initials on this device for next time (off by default; up to 4; "Forget all"); add today's date under a signature.
- Privacy page updated: signatures are never stored unless you choose to keep them.

## [1.11.0] - 2026-11-24
Conversions (roadmap v1.11, D36-D37).
- PDF to Word keeps pictures, bold and italic (read from the real font data).
- PDF to PowerPoint: each page becomes a full-slide picture (text is not editable, the tool says so).
- PDF to Markdown: headings, paragraphs and lists as a .md file.
- OCR cleans up scans first: straighten, crop off dark scanner edges, clearer text; optionally use the cleaned pages in the PDF.
- 13 more OCR languages, loaded only when chosen: Traditional Chinese, Japanese, Korean, Indonesian, Vietnamese, Thai, Hindi, Arabic, Spanish, French, German, Italian, Portuguese.
- HEIC photos in Images to PDF where the browser opens them itself (Safari).
- CI: the browser install retry now waits for a leftover apt-get instead of failing on its lock.

## [1.10.0] - 2026-11-24
Workspace (roadmap v1.10, D34-D35).
- File tray: files stay loaded while you move between tools ("N files ready" on home), with remove, clear all and undo; files a tool can't use are dimmed with the reason. Kept only while the tab is open.
- One page grid across files in Merge and Organize: file badges, drag pages between files, multi-select to move, rotate or delete, undo and redo.
- Batch on 17 tools, and a failing file no longer stops the rest.
- My workflows: chain 2-5 steps (repair, rotate, crop, flatten, watermark, page numbers, add pages, pages per sheet, compress), save them on this device, export and import them.
- Faster first load: the tool-page shell moved out of the main bundle (27.6 → 16.4 KB gzip).

## [1.9.0] - 2026-11-24
Quality pass (D33, roadmap v1.9).
- Clearer everywhere: buttons say what they do ("Merge PDFs", "Shrink PDF"), each tool has a one-line "how it works", the drop area says which files it takes, and about 70 error messages now say what happened and what to do.
- First-visit hint on home (closable). Better "Continue with" suggestions after a result.
- Accessibility: every tool checked with axe (WCAG 2.2 AA) and a keyboard walk, empty and with a file loaded; disabled buttons now explain why.
- Large files: a plain warning with "Try anyway" before heavy jobs on big files when the device may run short of memory; browser performance budgets for 100 MB and 1000-page files.
- Test runs can no longer hang silently; flaky tests steadied.

## [1.8.0] - 2026-11-23
- PDF to Excel (D32): tables from text positions into .xlsx (a sheet per page) or CSV; numbers become numbers; CSV text cells are guarded against formula injection.
- Extract images (D32): save the pictures inside a PDF (JPEGs byte for byte, others as PNG), optionally skipping tiny ones.
- Split by bookmarks: one file per top-level bookmark, named after it.
- Page numbers and headers: custom text with {n}, {total}, {date}, {file}; skip the first page or pick a range; mirror on even pages; margin.
- Design pass: bookmark rows fit phones, clearer disabled buttons.

## [1.7.0] - 2026-11-23
- PDF to Word (D31): text, paragraphs and headings into an editable .docx, written in the browser (layout, tables and pictures are not kept).
- Bookmarks tool (D31): read, add, rename, nest, reorder and remove bookmarks, or one per page. Merge now adds a bookmark for each file and keeps each file's own bookmarks under it.
- Traditional Chinese, Japanese and Korean text (D30): the footer switch is now "Extra text" with one font at a time.
- Edit PDF: add pictures (JPG, PNG, WebP), undo and redo (buttons and Ctrl+Z / Ctrl+Shift+Z), bold text and white text.

## [1.6.0] - 2026-11-23
- Four new tools (D29): Flatten PDF (forms, or forms and annotations baked into the page), Remove blank pages (pick a sensitivity, see the pages before they go), Pages per sheet (2 or 4 per sheet, or a fold-in-half booklet) and Add blank pages.
- Drop files straight onto a tool on the home page to open them in it.
- Install offer in the footer (Chromium browsers) so MossPDF runs as an app and offline.
- Tool icon data moved out of the main bundle into the pre-seal tools chunk (main 27.7 → 26.4 KB gzip).

## [1.5.0] - 2026-11-23
- Edit PDF (D27): add text (Unicode, Chinese when on), white-out, highlight, rectangle and line to pages; white-out only covers, with a link to Redact.
- Three small tools (D28): Rotate PDF (all or chosen pages, batch), Crop PDF (margins in mm with a live preview; hides edges, content stays in the file) and PDF to text (.txt download, preview and copy).
- Choice cards for Split mode and PDF to images (picture type, sharpness); the result card shows a small local preview of page 1 or the first picture.

## [1.4.0] - 2026-11-21
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
