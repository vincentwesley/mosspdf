# Handover

Resume here. Plan: `docs/PLAN.md`. Checks: `docs/ACCEPTANCE.md`. Why things are the way they are: `docs/DECISIONS.md`.

## Current state (2026-11-20)
- Repo https://github.com/vincentwesley/pagehold (public). Live: https://pagehold.vwesley.workers.dev
- M0 done. M1 merged (PR #2) and deployed 2026-11-19: merge, split, organize, extract, seal + privacy panel, offline PWA. CI green (unit + e2e in 5 browser projects); live smoke passed.
- M2 + M3 merged (PR #3) and deployed 2026-11-20: images to PDF, PDF to images, compress, page numbers, watermark, document details, add/remove password, safety scan + cleaned copy, repair. CI green (unit + 5 e2e jobs); live smoke (incl. a real merge, zero requests after the seal) passed.
- UX batch (PR #4), M5 OCR (PR #5) and M4 fill + sign (PR #6) merged and deployed 2026-11-20; CI green; live smoke passed.
- Next: M6 redact + photo and M7 compare (local worktrees, see next-session.md), then M8 and M9.

## How to work here
- Node 24: in PowerShell `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 24`. In agent Bash shells, `cd` into the repo can fail because of the fnm hook, so use `git -C`.
- Playwright browsers are project-local: `PLAYWRIGHT_BROWSERS_PATH=0`.
- qpdf CLI for tests goes in `tools/qpdf/` (gitignored; Windows release zip 12.4.2).
- Deploy: `npm run deploy` (wrangler is authenticated locally).

## Known gaps
- See the milestone table in PLAN.md.
