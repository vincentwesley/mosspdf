# Handover

Resume here. Plan: `docs/PLAN.md`. Checks: `docs/ACCEPTANCE.md`. Why things are the way they are: `docs/DECISIONS.md`. Session notes: `docs/next-session.md`.

## Current state (2026-11-21, evening)
- Repo https://github.com/vincentwesley/mosspdf (public). Live: https://mosspdf.pages.dev
- v1.5.0 live (2026-11-23): Edit PDF (D27), Rotate, Crop, PDF to text (D28), choice cards + result preview. v1.4.0 (2026-11-21): design pass with tool icons and category chips (D26), optional Chinese text (D24), tool code split out of main (D25), compact Sign on phones. v1.3.0 (D23): legal audit (Liberation Sans dropped D22, licences.txt, Terms, softened claims) and rename to MossPDF. v1.2.1 cut scan memory. v1.1.0 added Unicode text (Latin-ext, Vietnamese, Greek, Cyrillic; D20); v1.2.0 added OCR in Chinese, Malay and Tamil plus a glyphless hidden text layer (D21). v1.0.0: M0-M9 done. All 26 tools, 3 workflows, palette, batch. Release zip on GitHub Releases (`npm run release`, runs offline with `node serve.mjs`).
- History: M1 (PR #2), M2+M3 (#3), UX batch (#4), M5 OCR (#5), M4 fill + sign (#6), M7 compare (#7), M6 redact + photo (#8), M8 power features (#9), M9 polish + release (#10), Unicode text (#11), OCR languages (#12), scan memory (#13), legal audit + rename (#14), Pages deploy (#15), v1.4.0 (#16), v1.5.0 (#17). CI green on 5 browser projects each time; live smoke after each deploy.

## 1. Done in v1.0.0
- Tools: merge, split, organize, extract, images to PDF, PDF to images, compress, page numbers, watermark, metadata, add/remove password (correct password only), safety scan + cleaned copy, repair, fill, sign, OCR (English), redact (SG NRIC/FIN, phones, emails, addresses), photo clean, compare, accessibility check.
- Workflows: Small enough to email, Clean copy to share, Job application pack. Command palette (Ctrl/Cmd+K), shortcuts (?), batch with zip output.
- Privacy: header CSP + seal after preload, request log, no storage of files or signatures; privacy page names Cloudflare's request logs.
- Docs: USABILITY (3 personas, fixes), PERF (large files), LEGAL-REVIEW, COMPARISON, DECISIONS D1-D19.

## 2. Needs the owner (never blocks; see NEEDS-VIN.md)
1. Formal trademark check on "MossPDF" before commercial use.
2. Optional EAR courtesy notice; delete the two redirect Workers when old links no longer matter.

## 3. Next most valuable ideas (ranked)
1. **Repair memory**: about 3x the file size (qpdf output in MEMFS, no streaming in this build).
2. **Traditional Chinese / Japanese / Korean text**: same switch pattern as D24, one font each (2-4 MB). Tamil needs shaping pdf-lib lacks: keep refusing.
3. **More tools**: PDF to PDF/A, flatten forms and annotations, remove blank pages, reorder by drag across files (iLovePDF parity, all client-side).

## How to work here
- Node 24: in PowerShell `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 24`.
- Playwright browsers are project-local: `PLAYWRIGHT_BROWSERS_PATH=0`.
- qpdf CLI for tests goes in `tools/qpdf/` (gitignored; Windows release zip 12.4.2).
- Deploy: `npm run deploy`, then `npm run smoke:prod` (wrangler is authenticated locally).
- Release: `npm run build && npm run release`, then `gh release create vX.Y.Z release/mosspdf-vX.Y.Z.zip`.
