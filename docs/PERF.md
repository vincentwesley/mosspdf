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
