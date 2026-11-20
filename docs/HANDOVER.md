# Handover

Resume here. Plan: `docs/PLAN.md`. Checks: `docs/ACCEPTANCE.md`. Why things are the way they are: `docs/DECISIONS.md`.

## Current state (2026-11-19)
- Repo https://github.com/vincentwesley/pagehold (public). Live: https://pagehold.vwesley.workers.dev
- M0 done. M1 merged (PR #2) and deployed 2026-11-19: merge, split, organize, extract, seal + privacy panel, offline PWA. CI green (unit + e2e in 5 browser projects); live smoke passed.
- M2 + M3 merged (PR #3) and deployed 2026-11-20: images to PDF, PDF to images, compress, page numbers, watermark, document details, add/remove password, safety scan + cleaned copy, repair. CI green (unit + 5 e2e jobs); live smoke (incl. a real merge, zero requests after the seal) passed.
- Next: M4 (forms + signatures). Open item: CI-only mobile-safari CSP report on Compare intake (see next-session.md Known gaps).

## How to work here
- Node 24: in PowerShell `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 24`. In agent Bash shells, `cd` into the repo can fail because of the fnm hook, so use `git -C`.
- Playwright browsers are project-local: `PLAYWRIGHT_BROWSERS_PATH=0`.
- qpdf CLI for tests goes in `tools/qpdf/` (gitignored; Windows release zip 12.4.2).
- Deploy: `npm run deploy` (wrangler is authenticated locally).

## Known gaps
- See the milestone table in PLAN.md.
