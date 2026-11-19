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
