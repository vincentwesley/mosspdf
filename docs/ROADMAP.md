# Roadmap to MossPDF 2.0

> The target: **the free, private alternative to iLovePDF.** Every common PDF job, done on the device, nothing uploaded, works offline, clear enough for anyone, solid on a phone. Version 2.0 is the "finished and polished" release. Point releases (1.9, 1.10 ...) get there.

## Where we are (v1.8.0)
- 40 tools and 3 workflows. Covered: organize, convert (Word, Excel, text, images), edit, fill and sign, OCR, redact, compare, protect.
- Privacy model is done: the page seals itself, there are no uploads and no trackers, and it works offline.
- Missing: the polish a first-time visitor notices (speed on big files, help, onboarding, consistency), a "workspace" feel (files that follow you between tools), and a few big expected features.

## What "2.0 done" means
1. **Clear:** someone who has never seen the site finishes any common job without help. Every tool gets one obvious action, plain words, and a result card that suggests the next step.
2. **Fast:** a 100 MB / 500-page file opens in seconds on a mid-range phone, and nothing freezes the page. The perf budgets in `docs/PERF.md` hold.
3. **Accessible:** WCAG 2.2 AA on every tool: keyboard only, screen reader, 200% zoom and reduced motion.
4. **Trustworthy:** honest limits in the UI, no data leaves the device (tested), licences are clean, and the legal pages are reviewed.
5. **Reliable:** CI is green with no flaky tests, local e2e never hangs, and there are no known data-loss bugs.
6. **Findable:** each tool has its own link and page title, there is a help page and a comparison page, and launch assets exist.

## Milestones

### v1.9 Quality pass (trust and polish) — shipped 1.9.0
- A full a11y audit (axe, keyboard walk-through, screen-reader labels) of all 40 tools, with fixes.
- Consistency sweep: the same intake, options, action bar and result card everywhere. The same error wording. Empty states.
- Onboarding: first-visit hints on home (drop or paste, nothing uploaded) and a short "how it works" line per tool.
- Large files: profile open and render on 100 MB+ files, lazy thumbnails, cancel everywhere, and memory warnings before the browser tab crashes.
- Test health: find the cause of the local e2e hangs, fix the flaky logo test, and give every e2e run a time cap.

### v1.10 Workspace — shipped 1.10.0
- Files stay loaded when you move between tools ("Continue with" already chains one result). Add a visible file tray.
- Merge and organize: drag pages across files in one grid. Undo in Organize.
- Batch mode on every tool where it makes sense.
- Saved custom workflows: chain your own steps and keep them on this device.

### v1.11 Conversions
- PDF to Word: keep pictures, and detect bold and italic from font data.
- PDF to PowerPoint, with each page as a slide.
- PDF to Markdown or HTML.
- Images to PDF: HEIC input only if a permissively licensed decoder exists. libheif is LGPL, so check first.
- Scan pipeline: deskew, crop to the page and contrast, then OCR in one flow. More OCR languages, loaded on demand.

### v1.12 Fill and sign, done properly
- Create form fields: text, checkbox, date and signature boxes.
- Saved signatures and initials kept on this device, opt-in, with one-click clear.
- Certificate (digital) signing with a user-supplied .p12 file, if pkijs (BSD) holds up. Needs a full security review.

### v2.0 Launch polish
- A page per tool with its own title and description, for search. A help page with an FAQ. Refresh COMPARISON.md.
- Final design review at 375, 768 and 1280 px, in dark and light. Lighthouse 95+ on every page.
- Fresh-clone acceptance run, final legal review, a launch video (`brag`) and README media.

## Not doing (and why)
- **Server features** (cloud storage, accounts, e-sign workflows with email): they break the "nothing leaves the device" promise.
- **PDF/A:** there is no permissively licensed in-browser path. Ghostscript and MuPDF are AGPL/GPL. Revisit if one appears.
- **Tamil text in edits:** pdf-lib lacks shaping. OCR for Tamil works.
- **AI features that need a hosted model.**

## Owner decisions (never block; see NEEDS-VIN.md)
- Custom domain before 2.0, if you want one.
- Formal trademark check on "MossPDF".
- UI languages: English only, or also Chinese, Malay or Tamil for the interface. This is a scope call for v2.0.
- Certificate signing (v1.12): worth the security surface, or skip?
