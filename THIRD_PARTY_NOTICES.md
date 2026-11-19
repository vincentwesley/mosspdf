# Third-party notices

List every third-party asset (code, fonts, images, icons, datasets) with author, licence and source.

Bundled fonts (`fonts/`), all under the SIL Open Font License 1.1, full text in `fonts/OFL.txt`:
- Space Grotesk
- Inter
- Silkscreen
- JetBrains Mono

| Item | Author | Licence | Source |
|------|--------|---------|--------|
| {{ITEM}} | {{AUTHOR}} | {{LICENCE}} | {{URL}} |

Test corpus (not shipped in the build):
- `tests/corpus/external/irs-fw9.pdf`: IRS Form W-9, Internal Revenue Service, public domain (US federal work, 17 USC 105), https://www.irs.gov/pub/irs-pdf/fw9.pdf. Downloaded on demand by `scripts/corpus.mjs --external`, not committed.
- `tests/corpus/generated/*`: self-generated, CC0 (see `tests/corpus/README.md`).
- qpdf CLI 12.4.2 (Apache-2.0), used by tests only, not committed. `@neslinesli93/qpdf-wasm` (ISC, wraps qpdf, Apache-2.0) and `@cantoo/pdf-lib` (MIT) ship in the app.
