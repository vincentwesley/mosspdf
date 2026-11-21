# Third-party notices

Everything third-party that ships in the Pagehold build, with author, licence and source. `npm run licences` checks that every production dependency is allowlisted and named here.

## Code that ships in the app (production dependencies)

| Item | Author | Licence | Source |
|------|--------|---------|--------|
| pdfjs-dist 6.5.438 (pdf.js: rendering, thumbnails; also the pdf.js worker) | Mozilla and contributors | Apache-2.0 | https://github.com/mozilla/pdf.js |
| @cantoo/pdf-lib 2.11.1 (repair and metadata pass, runs in the ops worker only) | Cantoo (fork), Andrew Dillon (original pdf-lib) | MIT | https://github.com/cantoo-scribe/pdf-lib |
| @neslinesli93/qpdf-wasm 0.3.1 (qpdf compiled to WebAssembly: page assembly, inspection) | Tommaso Pifferi | ISC (wrapper); the bundled qpdf is Apache-2.0, Copyright Jay Berkenbilt | https://github.com/neslinesli93/qpdf-wasm, https://github.com/qpdf/qpdf |
| @jsquash/jpeg 1.6.0 (MozJPEG compiled to WebAssembly: image recompression in compress, ops worker only; its codec/LICENSE.codec.md covers MozJPEG, IJG and libjpeg-turbo terms: BSD-3-Clause, IJG, Zlib) | Jamie Sinclair (repackaged from Squoosh by Google) | Apache-2.0 | https://github.com/jamsinclair/jSquash |
| tesseract.js-core 7.0.0 (Tesseract OCR compiled to WebAssembly, SIMD + LSTM build; its JS glue is bundled into the OCR worker, the .wasm is loaded only on the OCR page; bundles Tesseract (Apache-2.0, Google and contributors) and Leptonica (BSD-2-Clause, Dan Bloomberg) among other libraries) | Jerome Wu and contributors | Apache-2.0 | https://github.com/naptha/tesseract.js-core, https://github.com/tesseract-ocr/tesseract |
| @tesseract.js-data/eng 1.0.0 (English language data, the 4.0.0_best_int model: tessdata_best, integer-quantised; shipped gzipped as `assets/eng.traineddata-*.gz`, OCR page only) | tesseract.js contributors (data from the Tesseract project, Google and contributors) | MIT (package); the model is Apache-2.0 | https://github.com/naptha/tessdata, https://github.com/tesseract-ocr/tessdata_best |
| @cantoo/fontkit 2.0.12 (embeds the Unicode text font in stamps, fill, sign, OCR layer and report; ops worker only) | Devon Govett and contributors (Cantoo fork) | MIT | https://github.com/cantoo-scribe/fontkit |
| brotli 1.3.3, dfa 1.2.0, restructure 3.0.2 (dependencies of @cantoo/fontkit) | Devon Govett | MIT | https://github.com/devongovett/brotli.js, https://github.com/devongovett/dfa, https://github.com/devongovett/restructure |
| base64-js 1.5.1 (dependency of @cantoo/fontkit) | T. Jameson Little | MIT | https://github.com/beatgammit/base64-js |
| fflate 0.8.3 (zip downloads in the app; also a dependency of @cantoo/pdf-lib) | Arjun Barrett | MIT | https://github.com/101arrowz/fflate |
| culori 4.0.2 (dependency of @cantoo/pdf-lib) | Dan Burzo | MIT | https://github.com/Evercoder/culori |
| html-entities 2.6.0 (dependency of @cantoo/pdf-lib) | Marat Dulin | MIT | https://github.com/mdevils/html-entities |
| node-html-better-parser 1.5.9 (dependency of @cantoo/pdf-lib) | Xiaoyi Shi and contributors | MIT | https://github.com/Rexxars/node-html-better-parser |
| tslib 2.8.1 (dependency of @cantoo/pdf-lib) | Microsoft | 0BSD | https://github.com/Microsoft/tslib |

`@napi-rs/canvas` 1.1.1 and its platform packages (`@napi-rs/canvas-android-arm64`, `@napi-rs/canvas-darwin-arm64`, `@napi-rs/canvas-darwin-x64`, `@napi-rs/canvas-linux-arm-gnueabihf`, `@napi-rs/canvas-linux-arm64-gnu`, `@napi-rs/canvas-linux-arm64-musl`, `@napi-rs/canvas-linux-riscv64-gnu`, `@napi-rs/canvas-linux-x64-gnu`, `@napi-rs/canvas-linux-x64-musl`, `@napi-rs/canvas-win32-arm64-msvc`, `@napi-rs/canvas-win32-x64-msvc`) are optional dependencies of pdfjs-dist, MIT, Brooooooklyn (https://github.com/Brooooooklyn/canvas). They are only used by Node tests and are not in the browser build.

## Data bundled with pdf.js (packed into `assets/pdfjs-data-*.bin`, from pdfjs-dist)

pdf.js itself is Apache-2.0. These binary files come with their own licences, shipped in the pdfjs-dist package (`cmaps/LICENSE`, `standard_fonts/LICENSE_*`, `wasm/LICENSE_*`):

| Item | Author | Licence | Source |
|------|--------|---------|--------|
| `cmaps/*.bcmap` (Adobe CJK character maps) | Adobe Systems Incorporated | BSD-3-Clause (Adobe, 1990-2009) | https://github.com/mozilla/pdf.js/tree/master/external/bcmaps |
| `standard_fonts/Foxit*.pfb` (substitutes for the 14 standard PDF fonts) | Foxit Software, PDFium authors | BSD-3-Clause (PDFium, 2014) | https://github.com/mozilla/pdf.js/tree/master/external/standard_fonts |
| `standard_fonts/LiberationSans-*.ttf` (fallback for non-embedded Arial-like fonts) | Red Hat, Inc. (Liberation fonts 1.x) | GNU GPL v2 with the Liberation font exception: documents that embed the font are not covered by the GPL. The fonts are shipped unmodified as data and are not linked into Pagehold's code. | https://github.com/mozilla/pdf.js/tree/master/external/standard_fonts |
| `wasm/jbig2.wasm` (JBIG2 image decoder) | PDFium authors, Mozilla | BSD-3-Clause | https://pdfium.googlesource.com/pdfium/ |
| `wasm/openjpeg.wasm` (JPEG 2000 decoder) | OpenJPEG contributors, Mozilla | BSD-2-Clause | https://github.com/uclouvain/openjpeg |
| `wasm/qcms_bg.wasm` (colour management) | Mozilla (qcms) | MIT | https://github.com/FirefoxGraphics/qcms |
| `wasm/quickjs-eval.wasm` (JavaScript in PDF forms; not used by the M1 tools) | Fabrice Bellard, Charlie Gordon | MIT | https://bellard.org/quickjs/ |

## Fonts (`src/fonts/`)

All under the SIL Open Font License 1.1, full text in `src/fonts/OFL.txt` (it travels with the fonts):
- Space Grotesk (The Space Grotesk Project Authors)
- Inter (The Inter Project Authors)
- Silkscreen (The Silkscreen Project Authors)
- JetBrains Mono (The JetBrains Mono Project Authors)
- Noto Sans, subset (The Noto Project Authors; `src/fonts/notosans-unicode-400-normal.ttf`, Latin, Latin Extended, Vietnamese, Greek and Cyrillic cut from NotoSans-Regular of the `@expo-google-fonts/noto-sans` 0.4.2 package with `pyftsubset`; drawn into PDFs by stamps, fill, sign, OCR layer and report when text goes beyond WinAnsi, D20)
- Caveat (The Caveat Project Authors; the typed-signature handwriting in Sign, from the Fontsource package build https://fontsource.org/fonts/caveat)

## Art and brand

- The house credits card art (`creator.webp`) and the logo are the owner's own and the commissioned logo; all rights reserved, not MIT (see `NOTICE.md`, `src/credits/PROVENANCE.md`).
- The page-grid and file icons (`src/ui/icons.ts`) are simple strokes drawn for this project. No Pixelarticons, Kenney or other third-party icon or art packs are shipped.

## Test and tooling only (not shipped)

- `tests/corpus/external/irs-fw9.pdf`: IRS Form W-9, Internal Revenue Service, public domain (US federal work, 17 USC 105), https://www.irs.gov/pub/irs-pdf/fw9.pdf. Downloaded on demand by `scripts/corpus.mjs --external`, not committed.
- `tests/corpus/generated/*`: self-generated, CC0 (see `tests/corpus/README.md`).
- qpdf CLI 12.4.2 (Apache-2.0), used by tests as an independent verifier, not committed.
- Dev dependencies (Vite, Vitest, Playwright, axe-core, fast-check, ESLint, TypeScript, wrangler, knip) are MIT, Apache-2.0 or ISC and are not part of the build output.
