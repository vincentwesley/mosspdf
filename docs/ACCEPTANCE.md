# Acceptance checks

`npm run acceptance` runs every automated check below and prints a pass/fail table (`scripts/acceptance.mjs`). Each check carries an ID. Tests are tagged with that ID (for example `@A-NET-1`) so the script can map results back to it. Manual checks are marked (M) and are recorded in HANDOVER.md each time they are done.

## Build and hygiene
- A-BLD-1 `npm ci --ignore-scripts` + `npm run check` pass from a fresh clone.
- A-BLD-2 `npm audit --omit=dev --audit-level=high` reports nothing.
- A-BLD-3 Every production dependency's licence is in the allowlist (MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, CC0, OFL for fonts) and listed in THIRD_PARTY_NOTICES.md (`scripts/licences.mjs`).
- A-BLD-4 No install-time scripts in package.json; no tracked `.claude/settings.json`; gitleaks is clean.
- A-BLD-5 The bundle stays within `budgets.json` (shell JS/CSS gzip, total precache size).

## Privacy and network
- A-NET-1 E2E: after the `pagehold:sealed` event, zero requests reach the network in Chromium, Firefox and WebKit, measured with `context.route` and service workers blocked, while every tool flow runs.
- A-NET-2 E2E: no request ever goes to an origin other than the app's own, from first byte to the end of every flow.
- A-NET-3 The response headers (CSP, COOP, COEP, CORP, Referrer-Policy, Permissions-Policy, X-Content-Type-Options) match `tests/headers.expected.json`. Checked locally against `wrangler dev` and against the live URL in the release smoke test.
- A-NET-4 The privacy panel shows the seal time and the request count, and the count matches what the test saw.
- A-NET-5 There are no cookies and no localStorage keys except theme, palette, logo form and opt-in preferences.

## Correctness (unit + corpus; ops run in Node on the real WASM engines)
- A-COR-1 Every op's output on every applicable corpus file passes `qpdf --check` and re-opens in pdf.js.
- A-COR-2 Merge, split, extract, reorder, rotate and delete keep the right page count, order, rotation and text per page (fast-check properties).
- A-COR-3 Each bad-input fixture (corrupt, truncated, empty, renamed non-PDF, wrong password, broken xref) gives either a valid output or a typed, user-readable error, never a throw that escapes or a hang.
- A-COR-4 Images to PDF keeps orientation (EXIF rotation applied) and page size; PDF to images gives the expected count and dimensions.
- A-COR-5 Compress output is smaller on image-heavy fixtures and never larger than the input (otherwise the original is returned with a note).
- A-COR-6 Page numbers and watermarks land on every selected page and the text can be extracted.
- A-COR-7 Forms: filled values read back; flattened output has no AcroForm fields; XFA files are detected.
- A-COR-8 OCR: on the scan fixture, at least 95% of the words in the known text are found in the output's text layer, and the page images are unchanged.
- A-COR-9 Compare finds every planted change on the diff fixtures and reports nothing on identical files.
- A-COR-10 Output metadata: Producer/Creator credit "Pagehold by Vin's Atelier" by default; when switched off, these fields are absent.

## Redaction
- A-RED-1 Each redacted string is absent from pdf.js text, from a raw `qpdf --qdf` byte scan (ASCII, UTF-16BE, hex) and from Info, XMP, annotations, form values, outlines and attachments.
- A-RED-2 Detection on the SG fixture finds every NRIC/FIN (with a checksum where one is published), SG phone, email and postal code, and makes no checksum-valid false positives on the negative fixture.
- A-RED-3 Text that wasn't redacted is still extractable; the pages stay vector.
- A-RED-4 Photo mode: output JPEG/PNG has no EXIF/GPS/XMP; the blurred regions differ from the input.

## Safety scan
- A-SAF-1 Each risky-element fixture (JavaScript, OpenAction, AA, Launch, EmbeddedFile, SubmitForm, URI, GoToR, RichMedia, XFA) is reported.
- A-SAF-2 Re-scanning the cleaned copy finds none of these, and the cleaned copy passes `qpdf --check`.
- A-SAF-3 A clean fixture reports "nothing risky found".

## Passwords
- A-PWD-1 Add password: the output is AES-256 (R6), opens with the user password, and doesn't open without it.
- A-PWD-2 Remove password: works with the correct password, fails with a clear message for a wrong one. There is no cracking path in the code (reviewed).

## Site (E2E, Playwright)
- A-E2E-1 Each tool's main flow (open, run, download, verify the downloaded file) passes in Chromium, Firefox, WebKit, Pixel 7 and iPhone 14 emulation.
- A-E2E-2 No console error, page error, unhandled rejection or CSP violation in any test (shared fixture).
- A-E2E-3 axe finds no violations on every view and open dialog, in both themes.
- A-E2E-4 Each main flow can be completed with the keyboard only; reordering works without dragging (WCAG 2.5.7).
- A-E2E-5 No horizontal overflow at 320, 375, 768 and 1280 px, or at 200% zoom.
- A-E2E-6 Offline: with the service worker active and the network off, reloading still runs every tool. Updates show a reload prompt and never interrupt a running job.
- A-E2E-7 Performance: merging two 500-page files, compressing a 100 MB image PDF and rendering thumbnails for a 1,000-page file stay within the time and memory budgets in `tests/perf.budgets.json`.
- A-E2E-8 The running version is shown and matches package.json and the git tag.
- A-E2E-9 Screenshots at 375, 768 and 1280 px in dark and light for every view are written to `qa-output/` (reviewed manually, M).

## Release
- A-REL-1 A live smoke test against the production URL: headers (A-NET-3), every tool loads, the merge flow works, and no network after the seal.
- A-REL-2 The release zip unpacks and its server script serves a working app on localhost with the network off.
- A-REL-3 (M) LEGAL-REVIEW.md has been re-read against the live site; README read as a stranger; the live site checked at phone, tablet and desktop widths.
