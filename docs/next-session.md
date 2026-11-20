> Update at the end of any session that changed state. Keep it lean.

Continue work on **Pagehold** (repo `vincentwesley/pagehold`). main holds M0-M8 (all tools live).

## Before anything
1. Work in `C:\Coding Projects\pagehold`; read this file, `docs/PLAN.md`, `docs/DECISIONS.md` (D7, D10, D11).
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
- CI-only: mobile-safari (Linux WPE) reports an inline `style-src-elem` CSP violation (blank source, line 5) on compare intake after an earlier viewport resize in the same test. M7 tried to reproduce it: 3 runs on local mobile-safari and WebKit pass; all pdf.js documents open through `openDoc` (disableFontFace) and src/ has no style strings. Test stays `fixme` on CI mobile-safari (`e2e/shell.spec.ts`); next step is a CI run with the violation details logged (the fixture already records blockedURI/source/line).
- Firefox offline test skipped (setOffline broken with service workers, docs/spikes/csp.md); keyboard-only tests skip on touch projects.
- Liberation Sans (GPL-2 + font exception) ships in the pdf.js data pack; owner may prefer to drop it (D11).
- Not yet: M9 polish, release zip.

## Resume point (2026-11-20, night)
- main = M0-M8, deployed ad62444c, live smoke passed. All 26 tools live (no planned tiles left).
- Done this session: UX batch, OCR (D16), fill + sign (D15), redact + photo (D17, security-review fixes), compare (D18), command palette, workflows, batch, accessibility check (D19, Safe to share fixes). docs/LEGAL-REVIEW.md, docs/COMPARISON.md, docs/NEEDS-VIN.md written.
- Next, M9: persona walkthroughs (USABILITY.md) + two polish passes; privacy page wording vs LEGAL-REVIEW (Cloudflare request logs); README screenshots; large-file perf check (500 pages / 200 MB); main bundle is 62 KB gzip (consider preloading tool chunks before the seal); version 1.0.0 + release zip (static build + local server script) + tag; fresh-clone acceptance; final HANDOVER with three lists.
- Known flaky locally under load: screens sign (light), tools A-COR-3 bad file 'empty'. CI apt installs now retry.
- `.worktrees/m7` and `.worktrees/m8` folders may linger (locked by the editor); they are no longer git worktrees and are gitignored: delete when unlocked.
- Local full e2e is unreliable on this 16 GB machine; prefer CI or `--project=<one>` runs locally.
