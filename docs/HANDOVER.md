# Handover

Resume here. Plan: `docs/PLAN.md`. Checks: `docs/ACCEPTANCE.md`. Why things are the way they are: `docs/DECISIONS.md`. Session notes: `docs/next-session.md`.

## Current state (2026-11-21, evening)
- Repo https://github.com/vincentwesley/pagehold (public). Live: https://pagehold.vwesley.workers.dev
- v1.2.0 live (deployed 79e1a848). v1.1.0 added Unicode text (Latin-ext, Vietnamese, Greek, Cyrillic; D20); v1.2.0 added OCR in Chinese, Malay and Tamil plus a glyphless hidden text layer (D21). v1.0.0: M0-M9 done. All 26 tools, 3 workflows, palette, batch. Release zip on GitHub Releases (`npm run release`, runs offline with `node serve.mjs`).
- History: M1 (PR #2), M2+M3 (#3), UX batch (#4), M5 OCR (#5), M4 fill + sign (#6), M7 compare (#7), M6 redact + photo (#8), M8 power features (#9), M9 polish + release (#10), Unicode text (#11), OCR languages (#12). CI green on 5 browser projects each time; live smoke after each deploy.

## 1. Done in v1.0.0
- Tools: merge, split, organize, extract, images to PDF, PDF to images, compress, page numbers, watermark, metadata, add/remove password (correct password only), safety scan + cleaned copy, repair, fill, sign, OCR (English), redact (SG NRIC/FIN, phones, emails, addresses), photo clean, compare, accessibility check.
- Workflows: Small enough to email, Safe to share, Job application pack. Command palette (Ctrl/Cmd+K), shortcuts (?), batch with zip output.
- Privacy: header CSP + seal after preload, request log, no storage of files or signatures; privacy page names Cloudflare's request logs.
- Docs: USABILITY (3 personas, fixes), PERF (large files), LEGAL-REVIEW, COMPARISON, DECISIONS D1-D19.

## 2. Needs the owner (never blocks; see NEEDS-VIN.md)
1. Liberation Sans keep or drop (D11).
2. Formal trademark check on "Pagehold" before commercial use.
3. Optional custom domain (Cloudflare dashboard → Workers → pagehold → Domains & Routes).

## 3. Next most valuable ideas (ranked)
1. **Repair memory**: scan fixed in v1.2.1 (+69 MB at 193 MB); repair still about 3x (qpdf output in MEMFS, no streaming in this build).
2. **Split tool code into chunks preloaded before the seal**: main bundle is 62 KB gzip (budget 64).
3. **CI-only mobile-safari CSP report** on compare intake: test still `fixme`; log violation details in a CI run.
4. **Chinese text in fill and stamps** (route-loaded CJK font subset, about 1-1.5 MB, like OCR languages). Tamil needs shaping that pdf-lib lacks: keep refusing.
5. **Sign**: the page is long on phones (USABILITY P1-6 is improved by scroll-to-placed; a compact single-page mode would help more).

## How to work here
- Node 24: in PowerShell `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 24`.
- Playwright browsers are project-local: `PLAYWRIGHT_BROWSERS_PATH=0`.
- qpdf CLI for tests goes in `tools/qpdf/` (gitignored; Windows release zip 12.4.2).
- Deploy: `npm run deploy`, then `npm run smoke:prod` (wrangler is authenticated locally).
- Release: `npm run build && npm run release`, then `gh release create vX.Y.Z release/pagehold-vX.Y.Z.zip`.
