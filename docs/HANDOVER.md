# Handover

Resume here. Plan: `docs/PLAN.md`. Checks: `docs/ACCEPTANCE.md`. Why things are the way they are: `docs/DECISIONS.md`.

## Current state (2026-11-19)
- M0 in progress: scaffold, research, engine and CSP spikes and docs are done. Next: public repo, first deploy of the placeholder, then M1.

## How to work here
- Node 24: in PowerShell `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 24`. In agent Bash shells, `cd` into the repo can fail because of the fnm hook, so use `git -C`.
- Playwright browsers are project-local: `PLAYWRIGHT_BROWSERS_PATH=0`.
- qpdf CLI for tests goes in `tools/qpdf/` (gitignored; Windows release zip 12.4.2).
- Deploy: `npm run deploy` (wrangler is authenticated locally).

## Known gaps
- See the milestone table in PLAN.md.
