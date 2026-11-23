> Update at the end of any session that changed state. Keep it lean.

Continue work on **MossPDF** (repo `vincentwesley/mosspdf`). main holds M0-M8 (all tools live).

## Before anything
1. Work in `C:\Coding Projects\mosspdf`; read this file, `docs/PLAN.md`, `docs/DECISIONS.md` (D7, D10, D11).
2. `npm ci --ignore-scripts`, `npm run pw -- install chromium firefox webkit`, then `npm run check`.

## How to work here
- Local commits only unless the owner says push. Identity: `vincentwesley` noreply.
- Deploys run locally: `npm run deploy` (no deploy workflow).
- Checks: `npm run check`, `npm run check:budgets`, `npm run licences`; `npm run test:e2e` (5 projects, builds and serves `dist` with wrangler dev so `_headers` apply). Screenshots: `npm run pw -- test e2e/screens.spec.ts --project=chromium` writes `qa-output/screens/`.
- qpdf CLI for tests: `tools/qpdf/*/bin/qpdf(.exe)` (found by `scripts/qpdf-bin.mjs`), then `QPDF_BIN`, then PATH.
- `npm ci` wipes the project-local Playwright browsers; re-run `npm run pw -- install chromium firefox webkit` after it.
- Worktrees live in `.worktrees/` (ignored). Merge with `gh pr merge <n> --squash` WITHOUT `--delete-branch` while a worktree holds the branch (it deletes the worktree folder); remove the worktree, then `git push origin --delete <branch>`. Worktree `node_modules` = junction to the main checkout's. Remove a worktree ONLY with `powershell -File scripts/worktree-remove.ps1 <name>` (plain `git worktree remove` deletes the shared packages). A zombie WebKitWebProcess can block `npm ci`; `npm install --ignore-scripts` repairs without wiping.

## Current state
- Adding a tool: create `src/tools/<id>.ts` exporting a `ToolDef` (see `src/tools/types.ts`; planned stubs already exist for every id on the home map: give yours a `run`), import it in `src/tools/index.ts` if new. Fields kit: `src/ui/fields.ts`. D12.
- M5 OCR (branch m5-ocr, D16): #/ocr loads Tesseract (about 6 MB) before the seal only when the page boots on that route; other routes show a reload button. Engine in src/engines/ocr.ts, worker src/workers/ocr.worker.ts, text layer op src/ops/ocr.ts. Fixtures scan-1p.pdf, scan-mixed-2p.pdf (scripts/scan-image.mjs). Cancel takes effect between pages. Budgets raised (.wasm 4700, .gz 3100).
- M4 (D15): `src/ui/pageview.ts` is the shared page viewer (overlay layer per page); `src/tools/fill.ts` + `src/ops/forms.ts`; `src/tools/sign.ts` + `src/ui/sigmaker.ts` + `src/ops/sign.ts`. `ToolDef.destroy` is new. Caveat font preloaded before the seal.
- M6 (D17, branch m6-redact): redact (`src/tools/redact.ts`, `src/ops/redact.ts`, pure `src/core/detect.ts` + `textpos.ts`) rebuilds affected pages as JPEG + hidden text layer, strips metadata, qpdf rewrite, leak scan before saving. Photo clean (`src/tools/photo.ts`, `src/core/exif.ts`): canvas re-encode, blur/pixelate boxes, no auto face detection. Shared box drawing: `src/ui/boxlayer.ts`. Fixtures `redact-sample.pdf`, `photo-gps.jpg`. Budget main-gzip 52.
- Tools: merge, split (ranges, every N, by size), organize, extract; password and bad-file handling; seal + privacy panel; PWA offline; version shown.
- e2e covers flows, axe (both themes), overflow (320 to 1280, 200% zoom), offline (Chromium, WebKit), seal negative controls (page and ops worker), 1,000-page thumbnails (Chromium).

- M8 (D19, branch m8-power, local): palette + shortcuts (`ui/palette.ts`), workflows (`core/workflows.ts`, `tools/wf-*.ts`, `ui/steplist.ts`), `ToolDef.batch` (workspace loops `run` per file), accessibility check (`ops/a11y.ts`, `core/a11yreport.ts`). Budget main-gzip 62. Based on m6-redact.

## Known gaps
- Mobile-safari compare CSP report: gone by v1.5.0 (CI diagnostic logged no violations); the test runs everywhere again.
- Firefox offline test skipped (setOffline broken with service workers, docs/spikes/csp.md); keyboard-only tests skip on touch projects.
- Liberation Sans dropped from the pdf.js data pack (D22).
- Main bundle budget raised to 64 KB gzip (62.2 now).

## Resume point (2026-11-23)
- v1.5.0 released and live at https://mosspdf.pages.dev: 30 tools incl. Edit PDF (D27), Rotate/Crop/PDF to text (D28). Main bundle 27.7 KB gzip of 28 (tool icons and rows live in main; raise the budget or move icons to the tools chunk before adding many more tools).
- Next: docs/HANDOVER.md section 3.
