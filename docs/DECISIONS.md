# Decisions

## D1. Name: Pagehold (not Paper Desk), 2026-11-19
"PaperDesk" is an existing iPad note-taking app by WebSpinner LLC that imports PDFs ([App Store](https://apps.apple.com/us/app/paperdesk/id367563434)), which is a real confusion risk for a PDF tool. Alternatives were checked against web, GitHub, npm and trademark aggregators: Pagewright (npm package for PDF reading, high risk), Hushpage (crowded "hush" privacy space), Quietleaf (existing notes app), Leaflock (npm taken), Sealpage (PDF e-seal apps), Stillpage (generic). Pagehold and Homeleaf were clean; Pagehold fits better ("your pages, held on your device"). Renamed before the repo existed. Not a legal clearance; LEGAL-REVIEW.md repeats the check before v1.0.

## D2. Hosting: Cloudflare Workers static assets
Owner preference, and it can send real headers (CSP with `frame-ancestors`, COOP/COEP for `crossOriginIsolated`, Permissions-Policy) that GitHub Pages can't. No Worker script: static assets only. Deploy with local `wrangler deploy` (already authenticated).

## D3. Licence: MIT, `Copyright (c) 2026 Vin's Atelier`
All runtime dependencies are MIT, BSD, ISC or Apache-2.0. AGPL engines (MuPDF, Ghostscript) are excluded. The logo stays all rights reserved (NOTICE.md).

## D4. Engines
pdf.js for rendering and text positions; @cantoo/pdf-lib for assembly, forms, drawing; EmbedPDF PDFium WASM for true redaction (pending spike); qpdf WASM for check/repair/linearize; tesseract.js for OCR. Details and licences in RESEARCH.md §8.

## D5. HEIC: native decode only
Every permissive-looking HEIC decoder bundles LGPL libheif. Pagehold accepts HEIC only where the browser decodes it itself (Safari), and otherwise says "convert to JPG first".

## D6. NRIC/FIN M-series: format match only
The M-series check-letter rule isn't published; S/T/F/G use the documented checksum. Unverified M numbers are still flagged for review (better a false positive the user unticks than a missed ID).

## D7. Seal after preload
The header CSP allows only same-origin requests, so no third party can ever be reached. On top of that, the app preloads all engines (served from the service-worker cache after the first visit) and then seals itself with a meta CSP that blocks fetch, scripts and new workers (`docs/spikes/csp.md`). Workers that exist before the seal are not covered by the meta, so they are either created after the seal (blob URLs, WASM bytes passed in by message) or served with a `connect-src 'none'` header. Files can be opened before the seal finishes; until then the header CSP is the guarantee, and the panel says so honestly. Rejected: sealing before any engine loads (every tool would need a reload), and loading packs lazily after sealing (impossible by design).

## D8. Face detection is not decided yet
MediaPipe's WASM is about 29 MB raw. That is too heavy to preload for one tool. In M6 a lighter, permissive detector will be evaluated. If none is reliable, photo mode ships EXIF/GPS stripping plus manual blur boxes and says auto-detection is not included.

## D9. Engine split (from the spike)
Redaction and text search use PDFium (`EPDFText_RedactInRect` + `FPDFPage_GenerateContent`). Metadata and XMP scrubbing use pdf-lib (PDFium has no XMP API). Encryption and decryption use qpdf WASM, which writes R6 AES-256. Every redacted export is checked with a `qpdf --qdf` needle scan before it is offered for download. The qpdf WASM package bundles qpdf 12.2.0.

## D10. Page assembly: qpdf WASM, pdf-lib for repair and metadata (2026-11-19)
Compared `qpdf --empty --pages ... --` (qpdf-wasm 12.2.0) with pdf-lib `copyPages` on the generated corpus (`tests/corpus/README.md`):

| Check | qpdf WASM | pdf-lib copyPages |
|---|---|---|
| AcroForm kept on page copy | yes (`/AcroForm` present; duplicate field names renamed on merge, 10 widgets / 8 unique names) | no: widgets stay but `/AcroForm` is dropped, so the fields are dead |
| Links, annotations | kept (URI, GoTo, Text) | kept |
| Outlines | dropped (reported as a warning) | dropped |
| Encrypted input with password (AES-256, RC4-40) | ok | ok |
| Mixed sizes, /Rotate | ok | ok |
| broken-xref, truncated | **fails: this 12.2.0 wasm build cannot rebuild a damaged xref** (the 12.4.2 CLI repairs both, exit 3) | opens, 3 pages |
| corrupt (600 random bytes) | fails (same reason) | opens but silently keeps 1 of 3 pages |
| 1,000 pages | 370 ms | 1,470 ms |

Verdict: the premise "qpdf repairs damaged files" does not hold for the WASM build, so the decision is split. qpdf WASM does the assembly (forms kept, fastest, handles rotate and password input; output is unencrypted). When qpdf cannot open a file, pdf-lib loads and re-saves it (writing a fresh xref, blanking pages whose content stream was cut off) and qpdf continues from that copy; the user gets a `repaired` warning. pdf-lib also sets Producer/Creator after assembly, because qpdf `--update-from-json` replaces the whole trailer (a partial update loses /Size and /Root), which makes it unsafe for a one-field change. `--empty` output carries no Info, so with the credit off nothing needs removing. Cost: the credit pass re-parses the output with pdf-lib (about 1.5 s for 1,000 pages). Revisit when qpdf-wasm ships a build with working xref recovery.

D10 follow-up (same day): checked whether the wasm failures were exit code 3 mistaken for an error. They are not. On broken-xref, truncated and corrupt, `callMain` returns 2 (nothing thrown), no output file is written, and stderr lacks the "Attempting to reconstruct cross-reference table" line the 12.4.2 CLI prints before it succeeds with exit 3. `--warning-exit-0` changes nothing (same rc 2, no output). So qpdf 12.2.0 aborts before its repair path in this build and there is nothing to accept as a success; the pdf-lib re-save stays as the repair step. A wrapper that treated exit 3 plus an existing output as success is still correct and already what `assemble` does (it only fails on code 2 or a missing file), so a newer qpdf-wasm would take over repair with no code change.

## D11. M1 integration notes (2026-11-19)
- qpdf-wasm 0.3.1 ignores `wasmBinary` and fetches `qpdf.wasm` itself, which the ops worker's `connect-src 'none'` blocks. In a worker `createQpdf` answers that one fetch from memory (`src/engines/qpdf.ts`); Node still reads the file from disk. Any later fetch from the worker still hits the CSP.
- The `/assets/workers/*` rule is merged with `/*` by Cloudflare: both CSPs are sent, joined with a comma, so the browser applies both and `connect-src 'none'` wins. `tests/headers.expected.json` records the joined value and `tests/headers.test.ts` checks it against `public/_headers`.
- `parseRanges` lives in `src/ops/ranges.ts` (imports only `PdfError`), so the main bundle never pulls pdf-lib; `npm run check:budgets` fails if pdf-lib code appears in the main-thread chunks.
- Single-PDF tools (split, organize, extract) work on the newest file. Adding another replaces it, with a closable "Replaced X. Undo" toast and a hint to Merge.
- The favicon SVG may not carry a `<style>` element: WebKit applies the page CSP to it (`style-src 'self'`).
- Playwright's iPhone WebKit on a display-scaled Windows machine reports `clientWidth` 312 for a 390 layout (a bare page shows it too), so `expectNoOverflow` compares `scrollWidth` with the layout width of `<html>` (1px tolerance).
- Playwright runs 3 workers locally: six parallel browsers with WASM and pdf.js crash Firefox content processes on a 16 GB machine.
- The pdf.js data pack includes Liberation Sans (GPL-2 with the font exception) as the fallback for non-embedded fonts; see THIRD_PARTY_NOTICES.md. Dropping it is possible if that is unwanted (non-embedded Arial-like fonts would then fall back to the Foxit set).
