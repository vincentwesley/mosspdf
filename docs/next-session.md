> Update at the end of any session that changed state. Keep it lean.

Continue work on **MossPDF** (repo `vincentwesley/mosspdf`, public). Live: https://mosspdf.pages.dev. Owner handed the project over fully: decide and do, never stop to ask; owner-only items go in `docs/NEEDS-VIN.md`.

## Before anything
1. Work in `C:\Coding Projects\mosspdf`. Read this file, `docs/HANDOVER.md` (section 3 = next ideas), `docs/DECISIONS.md` (D12 tools, D14 seal, D20-D28 latest).
2. Node 24. If `node_modules` is missing: `npm ci --ignore-scripts`, then `npm run pw -- install chromium firefox webkit` (npm ci wipes the project-local browsers).

## How to work here
- **Ship flow** (allowed without asking): branch → builders (worktrees for parallel work) → review → `code-review` low + security review (if user input, network, CSP) → `ALLOW_ACTIONS=1 git push` → `gh pr create --body-file` → wait for CI (`gh pr checks N --watch`; right after push it can report "no checks"/pending, so wait ~60 s first) → `gh pr merge N --squash` → `npm run deploy` → `npm run smoke:prod` → `npm run release` → `git tag -a vX.Y.Z` + push tag → `gh release create vX.Y.Z release/mosspdf-vX.Y.Z.zip --notes-file` → update CHANGELOG/HANDOVER/this file → docs-only push with `[skip ci]`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with the Claude Code line. Identity: `vincentwesley` noreply. Never force-push or rewrite main.
- **Deploy**: classic Cloudflare Pages project `mosspdf` (`wrangler pages deploy dist --project-name mosspdf --branch main`, D23). Never pass `--force` again. Local e2e serves dist with `wrangler dev -c scripts/wrangler.dev.jsonc` (config kept out of the root on purpose). Old workers.dev addresses are redirect Workers (outside the repo).
- **Checks**: `npm run check` (typecheck, lint, unit, build), `npm run check:budgets`, `npm run licences`; e2e per touched spec, always with a cap and your own port: `PH_PORT=48xx timeout 1300 npm run test:e2e -- <spec> --project=chromium --project=webkit --global-timeout=1200000`. Local config already caps: 2 workers on Windows, 60 s per test, 40 min globalTimeout, and `scripts/pw.mjs` kills the whole tree (wrangler, workerd, browsers) on exit/Ctrl-C and after a 50 min watchdog (`PW_WATCHDOG_MIN`). Full 5-project matrix runs in CI. Screenshots: `e2e/screens.spec.ts` writes `qa-output/screens/`.
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
- v1.12.0 (2026-11-24): fill and sign (D38): Create form, opt-in saved signatures/initials, date under signature. v1.11 conversions (D36-D37), v1.10 workspace (D34-D35), v1.9 quality (D33). 44 tools + 4 workflows. Next: v2.0 launch polish (ROADMAP).
- **Plan: `docs/ROADMAP.md`** (v1.9 quality pass → v1.10 workspace → v1.11 conversions → v1.12 fill and sign → v2.0 launch polish). Work the next milestone.
- Budget: main bundle 17.3 KB gzip of 20; `.gz` 27 MB (opt-in OCR languages).

## Known gaps
- CI webkit install fixed in v1.11 (retry waits for the orphaned apt-get).
- Local full e2e (chromium + webkit, ~20 min) can be stopped by Claude Code when the PC runs low on memory; run per-spec locally and let CI do the full matrix if that happens.
- Local e2e hang (webkit stall, WebKitWebProcess left behind): root cause not pinned down; made un-silent by the caps above. If a run is killed anyway, check for leftover `WebKitWebProcess`/`workerd` by command line before re-running. Heavy unit suites (compress, pwd) now have a 180 s test timeout for loaded machines.
- Firefox offline test skipped (setOffline broken with service workers); keyboard-only tests skip on touch projects.
- Repair uses about 3x the file size in memory (no streaming output in this qpdf build).
- Logo drag-hint test (`e2e/logo.spec.ts`) is occasionally flaky on webkit (passes on retry).
