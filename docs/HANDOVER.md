# Handover

Resume here. Plan: `docs/PLAN.md`. Checks: `docs/ACCEPTANCE.md`. Why things are the way they are: `docs/DECISIONS.md`.

## Current state (2026-11-19)
- Repo https://github.com/vincentwesley/pagehold (public). Live: https://pagehold.vwesley.workers.dev
- M0 done. M1 merged (PR #2) and deployed 2026-11-19: merge, split, organize, extract, seal + privacy panel, offline PWA. CI green (unit + e2e in 5 browser projects); live smoke passed.
- In progress: M2 ops, M3 ops (passwords, safety scan, repair), UI shell refactor into per-tool modules (`src/tools/`).
- Follow-up: pass passwords to qpdf as `--user-password=`/`--owner-password=` so a password starting with `-` can't be read as an option; live smoke should also run the merge flow (A-REL-1).

## How to work here
- Node 24: in PowerShell `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 24`. In agent Bash shells, `cd` into the repo can fail because of the fnm hook, so use `git -C`.
- Playwright browsers are project-local: `PLAYWRIGHT_BROWSERS_PATH=0`.
- qpdf CLI for tests goes in `tools/qpdf/` (gitignored; Windows release zip 12.4.2).
- Deploy: `npm run deploy` (wrangler is authenticated locally).

## Known gaps
- See the milestone table in PLAN.md.
