# MossPDF plan

MossPDF is a free, open-source PDF toolkit that runs entirely in the browser. Files never leave the device, and a sealed page with a request log proves it. Live on Cloudflare Workers (static assets), installable as an offline app.

Who it's for: someone who has never used a PDF tool should finish a common task (merge two files, redact a phone number, sign a form) in under a minute without instructions, on a laptop or a phone. Power users get batch, workflows and keyboard control.

## Architecture

- **Vite + TypeScript, no UI framework.** Hash routes per tool (`#/merge`), one shell, one in-memory file store. Nothing is persisted unless the user opts in.
- **Ops are pure functions** in `src/ops/`: `(input bytes, options) => Promise<output bytes + report>`. They run in Web Workers in the app and in Node in unit tests, against the real WASM engines. UI code never touches PDF internals.
- **Engines** (`src/engines/`), loaded once per worker: pdf.js (render, text), @cantoo/pdf-lib (assemble, forms, draw, metadata), PDFium WASM (redact, text search), qpdf WASM (check, repair, encrypt/decrypt, linearize, JSON structure), tesseract.js (OCR). Spike results: `docs/spikes/engines.md`.
- **Seal** (`src/core/seal.ts`): header CSP allows only this site; the app preloads every engine, then seals itself with a meta CSP (`default-src 'none'; script-src 'wasm-unsafe-eval'; worker-src blob:; form-action 'none'; base-uri 'none'`). Workers are created after sealing (blob URLs, WASM bytes passed by `postMessage`) or are served with their own `connect-src 'none'` header. The privacy panel lists every request since load and the seal time. Spike: `docs/spikes/csp.md`. Decision D7.
- **Service worker** precaches the whole build (hand-written, versioned cache, update prompt that never interrupts a job).

## Milestones

Each one is a branch and a PR, merged once CI is green. After each, I use the site headlessly, review screenshots as a designer and fix problems before moving on.

| # | Scope | Done when |
|---|---|---|
| M0 | Scaffold, research, spikes, docs, repo, first deploy | Placeholder live; ACCEPTANCE.md written |
| M1 | Shell, file intake, page grid (reorder/rotate/delete with drag **and** buttons/keys), merge, split, extract, download, seal + privacy panel, PWA, version shown, corpus + qpdf harness | Merge/split flows green in 3 browsers + mobile |
| M2 | Images → PDF, PDF → images, compress (with size preview), page numbers, watermark, metadata editor (default producer credit, can be turned off) | |
| M3 | Add/remove password (correct password only), safety scan + cleaned copy, repair | Scan fixtures per risky element |
| M4 | Fill forms (AcroForm), flatten, XFA detected and explained; signatures (draw, type, upload), place, date | |
| M5 | OCR to searchable PDF, language packs, progress + cancel | |
| M6 | Redaction (SG NRIC/FIN, phones, emails, addresses, search, manual boxes) with review; photo mode (EXIF/GPS strip, blur boxes; auto-detection only if a light, permissive model proves reliable, D8) | Leak tests pass |
| M7 | Compare two versions: word diff + visual overlay + change list + report | |
| M8 | Batch queue, workflows ("job application pack", "scan small enough to email", "safe to share"), command palette + shortcuts, PDF accessibility check | |
| M9 | Two full polish passes, three persona walkthroughs (USABILITY.md), side-by-side vs leaders (COMPARISON.md), LEGAL-REVIEW.md, privacy page, README media, v1.0.0 release + zip, fresh-clone acceptance, final HANDOVER | |

After M9, return to the brainstorm in DECISIONS.md and build the next most valuable ideas until further work adds little.

## Quality gates

Every PR runs the full gate, because users get every tool. Script checks are listed in ACCEPTANCE.md.

- A Playwright flow per tool in Chromium, Firefox and WebKit, plus phone emulation. Every output passes `qpdf --check` and is re-opened with pdf.js to check its content.
- Tests fail on any console error, page error, unhandled rejection or CSP violation, and on any network request after the page is sealed.
- The corpus covers corrupt, truncated, empty, renamed non-PDF, wrong-password, 1,000-page and large files, odd sizes, rotated scans, XFA and broken xref files. Each one gets a correct result or a plain message with a next step; jobs never hang and can always be cancelled.
- Property tests (fast-check) on page operations. Inputs are never modified. If links, outlines, annotations or fields would be dropped, the user is warned before the job runs.
- Memory and time budgets on large files; tests for offline use and service-worker updates.
- axe on every view, keyboard-only runs of the flows, 200% zoom, screenshots at 375/768/1280 in dark and light.
- Before each release: `npm audit` clean at high/critical, licence allowlist, gitleaks, security review, fresh-clone acceptance, a live smoke test after deploy (with rollback if it fails).

## Hosting and release

- `npm run deploy` runs `wrangler pages deploy` from a verified local build. The live smoke test runs straight after.
- Release: `git tag vX.Y.Z` plus a GitHub release with `mosspdf-vX.Y.Z.zip`, a static build that runs offline from the user's own computer. The zip includes a one-file local server script for Node, and alternatives are documented in its README.
