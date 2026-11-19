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
