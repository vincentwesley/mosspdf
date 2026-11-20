> Update at the end of any session that changed state. Keep it lean.

Continue work on **Pagehold** (repo `vincentwesley/pagehold`). main holds M0-M3 (live).

## Before anything
1. Work in `C:\Coding Projects\pagehold`; read this file, `docs/PLAN.md`, `docs/DECISIONS.md` (D7, D10, D11).
2. `npm ci --ignore-scripts`, `npm run pw -- install chromium firefox webkit`, then `npm run check`.

## How to work here
- Local commits only unless the owner says push. Identity: `vincentwesley` noreply.
- Deploys run locally: `npm run deploy` (no deploy workflow).
- Checks: `npm run check`, `npm run check:budgets`, `npm run licences`; `npm run test:e2e` (5 projects, builds and serves `dist` with wrangler dev so `_headers` apply). Screenshots: `npm run pw -- test e2e/screens.spec.ts --project=chromium` writes `qa-output/screens/`.
- qpdf CLI for tests: `tools/qpdf/*/bin/qpdf(.exe)` (found by `scripts/qpdf-bin.mjs`), then `QPDF_BIN`, then PATH.
- `npm ci` wipes the project-local Playwright browsers; re-run `npm run pw -- install chromium firefox webkit` after it.

## Current state
- Adding a tool: create `src/tools/<id>.ts` exporting a `ToolDef` (see `src/tools/types.ts`; planned stubs already exist for every id on the home map: give yours a `run`), import it in `src/tools/index.ts` if new. Fields kit: `src/ui/fields.ts`. D12.
- M5 OCR (branch m5-ocr, D16): #/ocr loads Tesseract (about 6 MB) before the seal only when the page boots on that route; other routes show a reload button. Engine in src/engines/ocr.ts, worker src/workers/ocr.worker.ts, text layer op src/ops/ocr.ts. Fixtures scan-1p.pdf, scan-mixed-2p.pdf (scripts/scan-image.mjs). Cancel takes effect between pages. Budgets raised (.wasm 4700, .gz 3100).
- Tools: merge, split (ranges, every N, by size), organize, extract; password and bad-file handling; seal + privacy panel; PWA offline; version shown.
- e2e covers flows, axe (both themes), overflow (320 to 1280, 200% zoom), offline (Chromium, WebKit), seal negative controls (page and ops worker), 1,000-page thumbnails (Chromium).

## Known gaps
- CI-only: mobile-safari (Linux WPE) reports an inline `style-src-elem` CSP violation (blank source, line 5) on compare intake after an earlier viewport resize in the same test; passes locally and on CI webkit. Test is `fixme` on CI mobile-safari (`e2e/shell.spec.ts`); investigate when Compare is built (M7).
- Firefox offline test skipped (setOffline broken with service workers, docs/spikes/csp.md); keyboard-only tests skip on touch projects.
- Liberation Sans (GPL-2 + font exception) ships in the pdf.js data pack; owner may prefer to drop it (D11).
- Not yet: M2+ tools, release zip.

## Resume point (2026-11-20)
- main = M0-M3, live and smoke-tested. Next: M4 (forms + signatures) per docs/PLAN.md.
- Local full e2e is unreliable on this 16 GB machine; prefer CI (5 parallel e2e jobs) or `--project=<one>` runs locally.
