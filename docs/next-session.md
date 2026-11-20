> Update at the end of any session that changed state. Keep it lean.

Continue work on **Pagehold** (repo `vincentwesley/pagehold`). main holds M0-M5 + UX batch (live).

## Before anything
1. Work in `C:\Coding Projects\pagehold`; read this file, `docs/PLAN.md`, `docs/DECISIONS.md` (D7, D10, D11).
2. `npm ci --ignore-scripts`, `npm run pw -- install chromium firefox webkit`, then `npm run check`.

## How to work here
- Local commits only unless the owner says push. Identity: `vincentwesley` noreply.
- Deploys run locally: `npm run deploy` (no deploy workflow).
- Checks: `npm run check`, `npm run check:budgets`, `npm run licences`; `npm run test:e2e` (5 projects, builds and serves `dist` with wrangler dev so `_headers` apply). Screenshots: `npm run pw -- test e2e/screens.spec.ts --project=chromium` writes `qa-output/screens/`.
- qpdf CLI for tests: `tools/qpdf/*/bin/qpdf(.exe)` (found by `scripts/qpdf-bin.mjs`), then `QPDF_BIN`, then PATH.
- `npm ci` wipes the project-local Playwright browsers; re-run `npm run pw -- install chromium firefox webkit` after it.
- Worktrees live in `.worktrees/` (ignored). Merge with `gh pr merge <n> --squash` WITHOUT `--delete-branch` while a worktree holds the branch (it deletes the worktree folder); remove the worktree, then `git push origin --delete <branch>`. Worktree `node_modules` = junction to the main checkout's.

## Current state
- Adding a tool: create `src/tools/<id>.ts` exporting a `ToolDef` (see `src/tools/types.ts`; planned stubs already exist for every id on the home map: give yours a `run`), import it in `src/tools/index.ts` if new. Fields kit: `src/ui/fields.ts`. D12.
- M5 OCR (branch m5-ocr, D16): #/ocr loads Tesseract (about 6 MB) before the seal only when the page boots on that route; other routes show a reload button. Engine in src/engines/ocr.ts, worker src/workers/ocr.worker.ts, text layer op src/ops/ocr.ts. Fixtures scan-1p.pdf, scan-mixed-2p.pdf (scripts/scan-image.mjs). Cancel takes effect between pages. Budgets raised (.wasm 4700, .gz 3100).
- M4 (D15): `src/ui/pageview.ts` is the shared page viewer (overlay layer per page); `src/tools/fill.ts` + `src/ops/forms.ts`; `src/tools/sign.ts` + `src/ui/sigmaker.ts` + `src/ops/sign.ts`. `ToolDef.destroy` is new. Caveat font preloaded before the seal.
- Tools: merge, split (ranges, every N, by size), organize, extract; password and bad-file handling; seal + privacy panel; PWA offline; version shown.
- e2e covers flows, axe (both themes), overflow (320 to 1280, 200% zoom), offline (Chromium, WebKit), seal negative controls (page and ops worker), 1,000-page thumbnails (Chromium).

## Known gaps
- CI-only: mobile-safari (Linux WPE) reports an inline `style-src-elem` CSP violation (blank source, line 5) on compare intake after an earlier viewport resize in the same test; passes locally and on CI webkit. Test is `fixme` on CI mobile-safari (`e2e/shell.spec.ts`); investigate when Compare is built (M7).
- Firefox offline test skipped (setOffline broken with service workers, docs/spikes/csp.md); keyboard-only tests skip on touch projects.
- Liberation Sans (GPL-2 + font exception) ships in the pdf.js data pack; owner may prefer to drop it (D11).
- Not yet: M8 (batch, workflows, command palette, a11y check), M9 polish, release zip.

## Resume point (2026-11-20, evening)
- main = M0-M5 + UX batch (result card, Use in another tool, undo, home search, recents), OCR (D16), fill + sign (D15). Deployed 3e2f121b, smoke passed.
- Worktree `.worktrees/m6` (branch `m6-redact`, local only): redact + photo clean (D17). Box-offset leak fixed (measured glyph widths, padding, pixel test); WIP commit 8e6c348: unit 201/201 and tools-m6 green on chromium + webkit; still to do: re-shoot `screens -g redact` and look at the boxes, firefox/mobile runs, security review. Its base is the pre-squash M4 commits: rebase with `git rebase --onto main eb0cb54 m6-redact`. main-gzip budget raised to 52 KB: consider lazy-loading tool modules instead.
- Worktree `.worktrees/m7` (branch `m7-compare`): Compare NOT started (empty WIP commit). Plan: own Myers word diff `src/core/diff.ts`, `src/core/pagewords.ts`, report op, tabbed UI (changes, side by side, overlay). Grep for style strings in src/ found no cause of the mobile-safari CSP report yet. Lazy-loading tool chunks would need preloading before the seal.
- Then: PR each (merge without `--delete-branch`), deploy, smoke; M8; M9 + v1.0.0.
- Local full e2e is unreliable on this 16 GB machine; prefer CI or `--project=<one>` runs locally.
