# Large-file performance (Node)

Run: `PH_PERF=1 npx vitest run tests/perf.large.test.ts` (about 4 minutes; skipped without `PH_PERF`). Real WASM engines in Node 24, one op at a time. Peak RSS is sampled every 20 ms from a worker thread (process-wide, includes the Node/vitest baseline of roughly 300 to 450 MB, and the generated inputs held in memory). Pass = under 30 s and under 2 GB.

Machine: 16 GB Windows laptop, 2026-11-21. Not a browser: browser numbers differ (workers, wasm memory cap, no shared heap).

Inputs: (a) 500-page text PDF, 1 MB; (b) 40 pages, each one 1300x1300 RGB random-noise image, 193 MB.

| Op | Input | Time | Peak RSS | Pass |
|---|---|---|---|---|
| merge (a + a, 1000 pages) | a x2 | 3.3 s | 660 MB | yes |
| split every 50 (10 files) | a | 3.0 s | 549 MB | yes |
| organize/extract pages 100-300 (`assemble`) | a | 1.1 s | 567 MB | yes |
| page numbers | a | 2.0 s | 549 MB | yes |
| pdf.js text extraction, all pages | a | 3.0 s | 530 MB | yes |
| compress, balanced | b | 64.9 s | 818 MB | NO (> 30 s) |
| repair (qpdf rewrite) | b | 1.6 s | 1298 MB | yes |
| safety scan | b | 1.1 s | 1882 MB | yes (close to 2 GB) |

No text-extraction op exists in `src/ops`; the row uses pdf.js `getTextContent` directly.

An earlier run with a 458 MB variant of (b): compress 144 s, repair 6.6 s at 2.65 GB, safety scan 4.2 s at 3.07 GB. So roughly 2 to 3x the input size in RSS for repair and scan.

## Scan/repair memory pass (2026-11-21)
`PH_PERF=1 PH_ONLY=scan|repair npx vitest run tests/perf.scan.test.ts` (one op per process, 193 MB noise file, RSS delta over the pre-op baseline of about 480 MB).

| Op | Before | After | Change |
|---|---|---|---|
| safety scan | +593 MB (3.1x file) | +69 MB | `countObjStm` decoded the whole file to one latin1 string; now 8 MB chunks. qpdf inputs are borrowed, not copied (below). |
| repair | +772 MB (4.0x) | +578 MB (3.0x) | qpdf inputs borrowed. |

- `src/engines/qpdf.ts`: `FS.writeFile(..., { Cb: true })` is Emscripten's `canOwn` (key minified in qpdf-wasm 0.3.1, pinned): the virtual file borrows the caller's buffer, saving one input-sized copy per qpdf call. Inputs are only ever read.
- Scan already used `--json` without stream data (default `--json-stream-data=none`), so no stream bytes reach JS.
- Left: repair still holds qpdf's output in MEMFS (grows by 12.5% steps, so about 2x transiently) plus the `FS.readFile` copy. Avoiding that needs a streaming output, not possible with this qpdf build's minified FS.

## Findings
- No crashes or failures.
- Compress on a 193 MB image-heavy file takes 65 s (scales linearly, 144 s at 458 MB). Time is the per-image inflate, downsample and JPEG re-encode in `recompressImages`; the noise input is a worst case (large, incompressible). Memory is fine (818 MB). Not a small fix.
- Safety scan and repair hold roughly 10x the file size in RSS at 193 MB (qpdf wasm copy in and out plus JS copies). A 458 MB file exceeds 2 GB, which is near the practical wasm/tab ceiling in browsers.
- Text-only 500-page ops are comfortably fast.

## Suggestions
- Compress: report progress per image (it already has `onProgress`); consider a "may take a minute" notice above about 50 MB, and keep it in the worker so the UI stays responsive.
- Cap or warn on inputs above about 250 MB (there is a `too-large` error code) since repair/scan RSS passes 2 GB beyond that.
- Safety scan only needs structure, not stream data: scanning without copying the full buffer into qpdf (or using `--json` on the inspected object tree) would cut RSS.
- Verify the browser equivalents in Playwright separately (these figures are Node only).

## Browser pass (v1.9, 2026-11-24)
`npm run build && PH_PORT=4873 npm run perf:browser [scenario]` (`scripts/perf-browser.mjs`): headless Chromium against `dist`, fixtures built in the OS temp dir (not the repo). Inputs: (c) 500 pages cycling over 33 distinct 1000x1000 RGB noise images, 95 MB; (d) `text-1000p.pdf` from the corpus. Long tasks = `PerformanceObserver("longtask")`; heap = `performance.memory.usedJSHeapSize` on the main thread only (the ops worker and pdf.js worker are not in it). 16 GB Windows laptop, one run each, so expect roughly +-40% noise between runs. Budgets (about 2x) are in `tests/perf.budgets.json` under `A-PERF-1`; any miss exits 1.

| Scenario | File meta | First page drawn | Op | Longest task | Heap peak |
|---|---|---|---|---|---|
| organize, 1000-page text (d) | 0.1 s | 3.7 to 6.8 s | | 126 to 172 ms | 9 MB |
| organize, 500-page 95 MB (c) | 0.4 to 2.4 s | 2.5 to 4.8 s | | 115 to 177 ms | 102 MB |
| merge (c + d, 1500 pages) | 0.4 s | | 4.5 to 8.6 s | 325 to 472 ms | 201 MB |
| compress balanced (c) | 0.2 to 0.9 s | | 36 to 47 s | 109 to 134 ms | 116 MB |
| edit, open (c) | 0.3 to 1.1 s | 0.6 to 1.2 s | | 107 to 189 ms | 103 MB |
| remove-blank scan, 500 pages (c) | 0.1 to 0.4 s | | 10 to 20 s | 0 to 112 ms | 111 MB |

Ranges are two runs (the first before any change, the second after the memory guard; no render-path code changed). Nothing freezes: the longest main-thread task is under 0.5 s everywhere. Single cold run of organize: cards built by 0.3 s (text) or 1.1 s (95 MB, the worker `inspect` copy), first thumbnail 2.4 to 2.7 s.

What was already right (no change needed): thumbnails and the Fill/Edit page viewer draw only on screen (IntersectionObserver, 500 to 600 px buffer), release canvases when they leave, cancel queued renders, and run at most 2 at a time. Results come back from the worker as transferred buffers. Every long loop (worker ops via `checkAbort`, pdf.js tool loops via `ctx.o.signal`, remove-blank via its own `stop`) already honours Cancel.

Costs left, by size:
- Compress is 36 to 47 s on 95 MB of incompressible noise (worker, progress shown, Cancel works); see the Node table above.
- Each thumbnail costs about 150 to 400 ms of pdf.js time. For non-embedded Helvetica/Arial pages part of it is the missing Liberation Sans data (not shipped on purpose, D22).
- Opening a document copies the file twice on the main thread (`inspect` message to the ops worker, `bytes.slice()` for pdf.js, which takes ownership): peak main heap is about 1x the file for organize, 2x for merge of two files. The store must keep its own bytes, so this cannot be a transfer.
- `content-visibility: auto` was not added to page cards: it implies paint containment, which would clip the card's outer `box-shadow` frame.

### Memory guard
`src/core/memguard.ts`: before an op runs, `estimateNeed` = input bytes x factor (compress 5, repair 4, safety scan 4, ocr 4, everything else 3, from the RSS multiples above). If the file is 50 MB or more and the estimate is over the tab budget (a quarter of `navigator.deviceMemory`, or 1.5 GB when the browser does not say), the action bar shows a plain warning with a "Try anyway" button instead of running. It never blocks. Tests: `tests/core/memguard.test.ts`, `e2e/memguard.spec.ts`.

## Lighthouse (v2.0, 2026-11-26)
Lighthouse 12.8 in headless Chromium against `dist/` served by `wrangler dev` (production `_headers`, so the real CSP), default simulated throttling. Mobile = Moto G Power profile on slow 4G; desktop = `--preset=desktop`. Target: 95+ in every category.

Two fixes got there (first run in brackets):
- **CLS**: `#app` is empty until the first view renders, so the footer started in view and then jumped (0.16 mobile, 0.26 desktop). The empty `#app` now reserves a full viewport: CLS 0.001.
- **LCP on tool pages**: the tool code and the multi-MB engines (qpdf, pdf.js, fonts) started downloading together, so on a slow link the tool view waited for bandwidth (simulated LCP 19 s on `/#/merge` mobile; observed locally 0.2 s). The seal now loads the tool code first, lets the view paint, then the engines (`first` flag on an engine entry). The seal lands at about the same time.

| Page | Device | Performance | Accessibility | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|---|
| `/` | mobile | 96 (92) | 100 | 100 | 100 (91) | 2.4 s | 0.001 |
| `/` | desktop | 100 (86) | 100 | 100 | 100 (91) | 0.5 s | 0.001 |
| `/#/merge` | mobile | 96 (72) | 100 | 100 | 100 (91) | 2.3 s | 0.001 |
| `/#/merge` | desktop | 100 (98) | 100 | 100 | 100 (91) | 0.6 s | 0.038 |

SEO was 91 only for a missing robots.txt, which the static pages work (branch `seo`) adds; the SEO column is from the merged build (see the `v200` table below once filled).
