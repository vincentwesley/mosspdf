# Engine spike (2026-11-19)

All run headless in Node 24 (Windows), no browser needed: both wasm modules load in Node. Spike code is local only (`spikes/engines/`, gitignored); qpdf 12.4.2 mingw64 CLI in `tools/qpdf/` (sha256 verified) used as the independent verifier. Timings are Node, not browser; re-measure in Chromium before setting budgets.

## Versions and licences (pinned devDependencies)

| Package | Version | Licence | Notes |
|---|---|---|---|
| @embedpdf/pdfium | 2.15.1 | MIT (CloudPDF, Ji Chang) | Wasm bundles PDFium = Apache-2.0 + Google BSD-style notice; ships `LICENSE` and `LICENSE.pdfium`. Both must travel in THIRD_PARTY_NOTICES |
| @cantoo/pdf-lib | 2.11.1 | MIT (Andrew Dillon) | fork of pdf-lib with encryption |
| pdfjs-dist | 6.5.438 | Apache-2.0 | |
| @neslinesli93/qpdf-wasm | 0.3.1 | ISC (package) | wraps qpdf (Apache-2.0 / Artistic-2.0); **bundled qpdf is 12.2.0, not 12.4.2** |

## Sizes and init (Node)

| Asset | Raw | gzip | brotli | Init |
|---|---|---|---|---|
| pdfium.wasm | 4.65 MB | 2.15 MB | 1.65 MB | 30-70 ms (`init` + `PDFiumExt_Init`) |
| qpdf.wasm | 1.33 MB | 0.45 MB | 0.36 MB | 10-30 ms per instance (+ qpdf.js 43 KB) |

## Redaction with PDFium: WORKS

API (typed in `dist/vendor/functions.d.ts`, no doc comments; signatures inferred and confirmed by output):
1. `FPDF_LoadMemDocument(ptr, len, pw)`, `FPDF_LoadPage`.
2. Locate: `FPDFText_LoadPage`, `FPDFText_FindStart(tp, utf16Ptr, 0, 0)`, `FPDFText_FindNext`, `FPDFText_GetSchResultIndex` (+ needle length), union of `FPDFText_GetCharBox(tp, i, &l,&r,&b,&t)` (doubles).
3. `EPDFText_RedactInRect(page, FS_RECTF*{left,top,right,bottom as floats}, recurse: bool, drawBlackBoxes: bool)` returns true. The 4th arg is the black box (confirmed by diff); the 3rd made no visible difference on simple text.
4. **`FPDFPage_GenerateContent(page)` is mandatory** before saving, otherwise the edit is silently lost (pdf.js still shows all text).
5. Save: `PDFiumExt_OpenFileWriter` / `PDFiumExt_SaveAsCopy(doc, w)` / `GetFileWriterSize` / `GetFileWriterData(w, buf, n)` / `CloseFileWriter`.
6. `EPDFPage_ApplyRedactions(page)` returned false: not needed, RedactInRect applies immediately (it is for REDACT annotations). `EPDFText_RedactInQuads` exists for rotated text.

| Check (2-page fixture, then 300-page) | Result |
|---|---|
| pdf.js getTextContent: "9123 4567", "S1234567D" absent; "keep this line" and the email present | pass (page text becomes `Call` / `NRIC` / `again`); 300pg: 0 pages contain needles |
| qpdf `--qdf --object-streams=disable` raw search "9123", "4567", "S1234567D" as ASCII, UTF-16LE/BE, hex, hex-UTF-16 | all absent (on a no-metadata fixture; see Metadata) |
| `qpdf --check` | pass (2 and 300 pages) |
| Stays vector / selectable | yes: content stream rewritten, text split into `(Call ) Tj`, rest untouched; no rasterisation |
| Black box | yes with 4th arg true: `q x y w h re f Q` (black fill) appended; false removes text and leaves a gap |
| Granularity | whole matched glyphs removed, neighbours kept; 1pt padding used |

Not tested: rotated pages, non-Latin/CID fonts, text inside Form XObjects/annotations, images (text API does not touch them), fonts left embedded, matches across line breaks.

### Metadata (separate)
- PDFium: `EPDF_SetMetaText(doc, key, utf16Ptr)` blanks Info entries (Title/Author/Subject/Keywords verified). `EPDF_GetMetaKeyCount` returned 0 on a pdf-lib file (do not rely on it). **No XMP API: the XMP stream survived and still contained "S1234567D".**
- pdf-lib: `setTitle('')` etc. + `catalog.delete(PDFName.of('Metadata'))` + `context.delete(ref)`, save with `useObjectStreams:false`: Info and XMP gone, no needle left. qpdf warns the xref size is off by the deleted object (harmless; a qpdf rewrite normalises). So pdf-lib (or qpdf) owns metadata scrubbing, run after redaction, then a final qpdf `--check`.

## Encryption (AES-256, user pw `u`, owner `o`): all three WORK

| Tool | API | qpdf `--show-encryption` | pdf.js with pw | Time 2pg / 300pg |
|---|---|---|---|---|
| @cantoo/pdf-lib | `doc.encrypt({userPassword, ownerPassword})` (default AES-256) then `save()` | R=6, AESv3 streams/strings/file | opens; wrong/none gives `PasswordException` | 20 ms / 530 ms (load+enc+save) |
| PDFium | `EPDF_SetEncryption(doc, 'u', 'o', -4)` (last arg = permission bits, -4 = all) then save | R=6, AESv3 | same | 12 ms / 63 ms (open+enc+save) |
| qpdf-wasm | `--encrypt u o 256 -- in out` | R=6, AESv3 | same | 21 ms / 139 ms |

Decrypt, every encrypted output x every tool (9 combos): all pass. pdf-lib `PDFDocument.load(b,{password})` + save; PDFium `FPDF_LoadMemDocument(..., pw)` + `EPDF_RemoveEncryption(doc)` + save; qpdf `--password=u --decrypt`. Output is unencrypted with text intact. Wrong password fails cleanly in all: pdf-lib throws "Password incorrect", PDFium returns a null doc with `FPDF_GetLastError()==4` (password), qpdf exit 2 "invalid password".

## qpdf-wasm: WORKS in Node (browser/worker untested)

| Operation | Args | Result |
|---|---|---|
| version | `--version` | 12.2.0 |
| check | `--check /in.pdf` | exit 0, text on stdout |
| json | `--json=2 --json-key=qpdf [--json-key=encrypt]` | full object table; on a fixture with `/OpenAction`, a JS action and page `/AA`, output contains `"/OpenAction"`, `/JavaScript`, `"/JS"`, `"/AA"`, so scanning is feasible. Plain `--json` omits objects |
| linearize | `--linearize in out` | valid; `--show-linearization` ok; `--check` pass |
| object streams | `--object-streams=generate in out` | valid; `--check` pass |

Per call: load 10-30 ms, run 3-40 ms on 2 pages; 300-page linearize 86 ms.

## Redact + encrypt at scale (Node)

| Fixture | Open | Search+redact+GenerateContent | Save | Encrypt PDFium | pdf-lib | qpdf-wasm |
|---|---|---|---|---|---|---|
| 2 pages, 3 hits | 9 ms | 54 ms | 5 ms | 32 ms | 48 ms | 76 ms (load 18) |
| 300 pages, 600 hits | 1 ms | 2040 ms (text search dominates) | 51 ms | 63 ms | 530 ms | 139 ms (load 24) |

Output shrank 637 KB to 259 KB on the 300-page file (PDFium rewrites the content streams).

## Gotchas
- qpdf-wasm in Node writes straight to `process.stdout`; `print`/`printErr` options were ignored. Capture by patching `process.stdout.write` around `callMain` (browser `print` untested). Use a fresh instance per call (`callMain` is one-shot; make `quit` throw). Module is CJS.
- qpdf-wasm is 12.2.0 vs the 12.4.2 CLI; behaviour matched in these tests.
- PDFium wrapper: strings to wasm are UTF-16 via `stringToUTF16`; rect is `FS_RECTF` (left, top, right, bottom) as 4 floats; char boxes are doubles. Free pointers in the real app (spike leaks).
- Redaction removes page text only; metadata, XMP, attachments, annotations, embedded fonts, bookmarks and form values need their own scrub. Keep a before/after qdf needle scan as the verification gate.
- In the browser, pdfium.wasm (4.65 MB) must be self-hosted; CSP needs `wasm-unsafe-eval`.

## Recommendation
- **Redaction: PDFium** (`EPDFText_RedactInRect` + `FPDFPage_GenerateContent`): true removal, vector kept. Verify every export with a qpdf-wasm `--qdf` raw scan for the needles (ASCII/UTF-16/hex) before offering the download.
- **Metadata scrub: pdf-lib** (Info + delete Metadata stream), then a qpdf-wasm rewrite.
- **Encryption: qpdf-wasm** (`--encrypt u o 256`), already loaded for check/linearize/JSON; PDFium is the fast fallback; pdf-lib works but is slowest. **Decrypt: qpdf-wasm** (clear exit codes).
- Lazy-load PDFium (1.65 MB brotli) only on the redact tool and qpdf-wasm (0.36 MB brotli) on check/encrypt/optimise.
- Still to do before building: Chromium/worker run, rotated pages, CID fonts, images, memory on a 100 MB PDF.
