> Update at the end of any session that changed state. Keep it lean.

Continue work on **Pagehold** (repo `vincentwesley/pagehold`). Branch `m1` holds M1 (ops + UI + e2e merged); not pushed or merged to main yet.

## Before anything
1. Work in `C:\Coding Projects\pagehold`; read this file, `docs/PLAN.md`, `docs/DECISIONS.md` (D7, D10, D11).
2. `npm ci --ignore-scripts`, `npm run pw -- install chromium firefox webkit`, then `npm run check`.

## How to work here
- Local commits only unless the owner says push. Identity: `vincentwesley` noreply.
- Deploys run locally: `npm run deploy` (no deploy workflow).
- Checks: `npm run check`, `npm run check:budgets`, `npm run licences`; `npm run test:e2e` (5 projects, builds and serves `dist` with wrangler dev so `_headers` apply). Screenshots: `npm run pw -- test e2e/screens.spec.ts --project=chromium` writes `qa-output/screens/`.
- qpdf CLI for tests: `tools/qpdf/*/bin/qpdf(.exe)` (found by `scripts/qpdf-bin.mjs`), then `QPDF_BIN`, then PATH.

## Current state
- Adding a tool: create `src/tools/<id>.ts` exporting a `ToolDef` (see `src/tools/types.ts`; planned stubs already exist for every id on the home map: give yours a `run`), import it in `src/tools/index.ts` if new. Fields kit: `src/ui/fields.ts`. D12.
- Tools: merge, split (ranges, every N, by size), organize, extract; password and bad-file handling; seal + privacy panel; PWA offline; version shown.
- e2e covers flows, axe (both themes), overflow (320 to 1280, 200% zoom), offline (Chromium, WebKit), seal negative controls (page and ops worker), 1,000-page thumbnails (Chromium).

## Known gaps
- Firefox offline test skipped (setOffline broken with service workers, docs/spikes/csp.md); keyboard-only tests skip on touch projects.
- Liberation Sans (GPL-2 + font exception) ships in the pdf.js data pack; owner may prefer to drop it (D11).
- Not yet: M2+ tools, release zip.

## Resume point (2026-11-19, usage limit)
- M1 merged (PR #2) and live. Branch `m2` (local, not pushed) = main + m2-ops + m3-ops + ui-shell merged; unit checks passed before the ui-shell merge; re-run `npm ci --ignore-scripts && npm run check && npm run check:budgets && npm run licences && npm run test:e2e` on `m2` first.
- Next: wire the M2/M3 ops into the `src/tools/<id>.ts` stubs (images-to-pdf, pdf-to-images, compress, page-numbers, watermark, metadata, protect, unprotect, safety-scan, repair) with e2e per tool; then PR, CI, merge, deploy, smoke.
- Fixed on branch `fixes` (2026-11-19, local): Firefox worker-src race (D14), compact phone home, live smoke merge flow, update-prompt e2e. Still open: qpdf passwords via `--user-password=`/`--owner-password=`. Parallel worktrees: set `PH_PORT` (and never run two e2e runs on one worktree: both rebuild `dist/`).
- Worktrees `.worktrees/m2-ops`, `m3-ops`, `ui-shell` can be removed once `m2` is verified.

- m3-ui (local branch, not pushed): protect, unprotect, safety-scan, repair wired to the ops (`src/tools/*.ts`, `passwordField` in fields.ts, `ToolDef.onError`), `e2e/tools-m3.spec.ts`. Passwords reach qpdf as named options (`--user-password=`, `--owner-password=`, `--bits=256`). Safety scan runs on add; "Download cleaned copy" cleans and downloads in one click.
