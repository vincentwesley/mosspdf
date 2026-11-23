> Update at the end of any session that changed state. Keep it lean.

Continue work on **MossPDF** (repo `vincentwesley/mosspdf`, public). Live: https://mosspdf.pages.dev. Owner handed the project over fully: decide and do, never stop to ask; owner-only items go in `docs/NEEDS-VIN.md`.

## Before anything
1. Work in `C:\Coding Projects\mosspdf`. Read this file, `docs/HANDOVER.md` (section 3 = next ideas), `docs/DECISIONS.md` (D12 tools, D14 seal, D20-D28 latest).
2. Node 24. If `node_modules` is missing: `npm ci --ignore-scripts`, then `npm run pw -- install chromium firefox webkit` (npm ci wipes the project-local browsers).

## How to work here
- **Ship flow** (allowed without asking): branch → builders (worktrees for parallel work) → review → `code-review` low + security review (if user input, network, CSP) → `ALLOW_ACTIONS=1 git push` → `gh pr create --body-file` → wait for CI (`gh pr checks N --watch`; right after push it can report "no checks"/pending, so wait ~60 s first) → `gh pr merge N --squash` → `npm run deploy` → `npm run smoke:prod` → `npm run release` → `git tag -a vX.Y.Z` + push tag → `gh release create vX.Y.Z release/mosspdf-vX.Y.Z.zip --notes-file` → update CHANGELOG/HANDOVER/this file → docs-only push with `[skip ci]`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with the Claude Code line. Identity: `vincentwesley` noreply. Never force-push or rewrite main.
- **Deploy**: classic Cloudflare Pages project `mosspdf` (`wrangler pages deploy dist --project-name mosspdf --branch main`, D23). Never pass `--force` again. Local e2e serves dist with `wrangler dev -c scripts/wrangler.dev.jsonc` (config kept out of the root on purpose). Old workers.dev addresses are redirect Workers (outside the repo).
- **Checks**: `npm run check` (typecheck, lint, unit, build), `npm run check:budgets`, `npm run licences`; e2e per touched spec: `PLAYWRIGHT_BROWSERS_PATH=0 npm run pw -- test <spec> --project=chromium --project=webkit`. Full 5-project matrix runs in CI. Screenshots: `e2e/screens.spec.ts` writes `qa-output/screens/`.
- **Worktrees**: `git worktree add -b X .worktrees/X main`, then a node_modules junction (PowerShell `New-Item -ItemType Junction -Path .worktrees\X\node_modules -Target <repo>\node_modules`). Give each builder its own `PH_PORT` (4831, 4832...). Remove ONLY with `powershell -File scripts/worktree-remove.ps1 X` (plain `git worktree remove` or `gh pr merge --delete-branch` wipes the shared node_modules).
- **Leftover servers**: a killed e2e run can leave `wrangler dev` (node + workerd) running and lock the folder. Find it by command line (`Get-CimInstance Win32_Process`) and `taskkill /PID <pid> /T /F` that tree only. Never kill node.exe broadly; never touch port 4397.
- qpdf CLI for tests: `tools/qpdf/*/bin/qpdf(.exe)` (gitignored), then `QPDF_BIN`, then PATH.
- Icons: free Pixelarticons set (MIT) via `npm pack pixelarticons` into the scratchpad; glyph path data goes in `src/ui/toolicons.ts`.

## Architecture in one breath
- Tools: light row in `src/tools/index.ts` (main bundle: home, palette, routing) + module `src/tools/<id>.ts` registered in `src/tools/all.ts` (pre-seal tools chunk, D25) + icon in `src/ui/toolicons.ts`. Ops are pure functions in `src/ops` run in the ops worker (`src/workers/ops.worker.ts`) and in Node tests.
- Seal (D14): engines, fonts, wasm and the tools chunk load BEFORE the page locks itself; e2e fails on any request after the seal. Optional heavy data (OCR languages D21, CJK fonts D24/D30) loads only when switched on, via reload.
- Shared UI: `ui/workspace.ts` (intake, options, action bar, result card with preview + "Continue with"), `ui/pageview.ts` + `ui/boxlayer.ts` (sign, edit, redact), `ui/fields.ts` (`radioGroup` with `about` = choice cards; flex not grid on fieldsets, WebKit).
- Text: `ops/ufont.ts` `pickFont` (Helvetica → Noto Sans → Chinese font when on), client gate `core/winansi.ts` `badChars`.

## Current state
- **Open: PR #20 = v1.8.0** (branch `v180`: PDF to Excel, Extract images, split by bookmarks, header/footer text, design pass; D32 + CHANGELOG already on the branch, version 1.8.0). Local check + e2e (211) green; CI was running at hand-off. Next: `gh pr checks 20` → merge → deploy → smoke → release v1.8.0 → update this file.
- v1.7.0 (2026-11-23): 36 tools + 3 workflows. v1.6 added Flatten, Remove blank pages, Pages per sheet, Add blank pages, tile drop, install offer (D29); v1.7 added PDF to Word, Bookmarks (+ Merge bookmark per file), Traditional Chinese/Japanese/Korean text (D30), Edit PDF pictures, undo/redo, bold (D31). CI green on 5 browser projects.
- Budget: main bundle 26.8 KB gzip of 28 (icon data lives in `ui/icondata.ts`, tools chunk). Home-phone height cap 4800.

## Known gaps
- Local e2e can hang silently (seen twice: webkit worker stalls). Always run with `timeout 1300 ... --global-timeout=1200000` and check on it; heavy unit suites (compress, pwd) time out when e2e runs at the same time.
- Firefox offline test skipped (setOffline broken with service workers); keyboard-only tests skip on touch projects.
- Repair uses about 3x the file size in memory (no streaming output in this qpdf build).
- Logo drag-hint test (`e2e/logo.spec.ts`) is occasionally flaky on webkit (passes on retry).
