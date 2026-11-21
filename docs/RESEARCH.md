# Research

Living notes. Every claim links to its source. Revisit when a hard problem comes up instead of guessing.

## 1. Competitors (2026-11-19)

| Tool | Processing | Free limits / paywall | Licence |
|---|---|---|---|
| iLovePDF | Upload to server | Hourly task + 25 MB caps reported; OCR paid ([Capterra](https://www.capterra.com/p/173963/iLovePDF/reviews/)) | Proprietary |
| Smallpdf | Upload | Daily task cap; card required for trial ([report](https://www.sikayetvar.com/en/smallpdf-us/smallpdf-trial-requires-credit-card-even-though-i-only-wanted-to-test-it-how-can-i-try-tools-without-entering-card-details-q-25535)) | Proprietary |
| Adobe Acrobat online | Upload | One task signed-out, then account; 100 MB cap; password removal paid ([Adobe FAQ](https://helpx.adobe.com/document-cloud/faq/free-online-pdf.html)) | Proprietary |
| PDF24 | Upload (online), Windows desktop app | Free, no stated caps ([site](https://www.pdf24.org/en/)) | Proprietary |
| Sejda | Upload | Hourly/page limits ([pricing](https://www.sejda.com/pricing)) | Proprietary |
| Stirling-PDF | Self-hosted server (Docker) | Free self-host up to 5 users ([v2.0.0](https://newreleases.io/project/github/Stirling-Tools/Stirling-PDF/release/v2.0.0)); ~97k stars ([GitHub](https://github.com/Stirling-Tools/Stirling-PDF)) | Open-core; licence to confirm from LICENSE |
| BentoPDF | Client-side, but loads WASM from jsDelivr CDN at runtime ([GitHub](https://github.com/alam00000/bentopdf)) | Free | AGPL-3.0 (we can't reuse its code) |
| PDFgear, Xodo | Desktop/app; Xodo free tier is view/annotate only | — | Proprietary |

Takeaways: the market splits into "upload to us" (caps, paywalls, accounts) and "run a server yourself" (Stirling). Browser-only tools exist but either phone home to a CDN (BentoPDF) or are AGPL. MossPDF's position: browser-only **and** provably no network, permissive licence, no caps.

## 2. User pain points (ranked)

1. Uploading private files ([privacy-tool roundup](https://www.wildandfreetools.com/blog/best-pdf-encryption-tools-free-reddit-2026/)).
2. Task, page and size caps that hit mid-task ([Capterra Smallpdf](https://www.capterra.com/p/172606/Smallpdf/reviews/)).
3. Core features paywalled (OCR, batch, strong compression, password removal).
4. Account and card walls; billing complaints.
5. Redaction that only draws boxes ([DEV](https://dev.to/haruodev/the-black-box-in-your-pdf-is-a-shape-not-a-delete-key-1nc3); glyph-position leaks, [PoPETs 2023](https://petsymposium.org/popets/2023/popets-2023-0069.php); [Apple Discussions](https://discussions.apple.com/thread/254765555)).
6. Stirling-PDF bugs: merge duplicates signature entries ([#435](https://github.com/Stirling-Tools/Stirling-PDF/issues/435)); content hidden behind form fields ([#483](https://www.goodfirstissue.org/Stirling-Tools/Stirling-PDF/issues/483)).
7. OCR quality and wrong-language defaults ([OCRmyPDF docs](https://ocrmypdf.readthedocs.io/en/latest/introduction.html)).
8. Browser-only tools are slow on huge files and download heavy WASM ([DEV](https://dev.to/hwlsniper/i-built-a-pdf-toolbox-that-never-uploads-your-files-heres-how-57bm)).

Gaps: local fill-and-sign for Singapore government forms (e.g. MOM Form 12 tells users to use Acrobat Reader, [form](https://mom.gov.sg/-/media/mom/documents/services-forms/passes/dpform12.pdf)); verifiable redaction with a post-check; offline OCR.

To do (M9, for COMPARISON.md): live headless walkthroughs of iLovePDF, Smallpdf, PDF24, Stirling demo on the same tasks, counting steps; verbatim Reddit/HN quotes.

## 3. Design patterns

Adopt: drop zone with visible click fallback, drag-over feedback, file chips with remove, limits and "what happens next" shown up front, keyboard alternatives to drag ([Filestack](https://blog.filestack.com/upload-ui-components-drag-drop-progress-preview/), [SaaS UI](https://www.saasui.design/blog/saas-file-upload-ux-patterns), [Eleken](https://www.eleken.co/blog-posts/drag-and-drop-ui)). Avoid: caps mid-task, card gates, account walls, upsell popups.

## 4. Redaction

- Covering is not redacting; remove the data from the file ([NSA I333-015R-2005](https://www.ca7.uscourts.gov/assets/pdf/nsa-redact.pdf); hidden data/metadata follow-up [I733-028R-2008](https://webarchive.library.unt.edu/eot2008/20080916073959/http://www.nsa.gov/snac/support/I733-028R-2008.pdf)).
- Failures: Manafort 2019 ([ABA](https://www.americanbar.org/groups/judicial/publications/judges_journal/2019/spring/embarrassing-redaction-failures/)), DOJ Epstein releases Dec 2025 ([report](https://gvwire.com/2025/12/24/redacted-material-in-some-epstein-files-is-easily-recovered/)), Meta and Jones Day filings ([Redactable](https://redactable.com/blog/meta-redaction-failure)).
- Correct removal covers glyphs, images under the box and vector paths ([PyMuPDF apply_redactions issue](https://github.com/pymupdf/PyMuPDF/issues/4698), [PDF-XChange](https://sdkhelp.pdf-xchange.com/view/PXV:op_document_redact)), plus metadata/XMP, annotations, form values, attachments, outlines, optional content, structure-tree alt text and incremental-update history (our checklist; verify each by test).
- Glyph positions and widths can leak removed text even after deletion (PoPETs 2023 above), so the output must not keep the original glyph spacing around removed words.
- Verify with a second extractor plus raw-stream search, not just a text search in a viewer.

## 5. Singapore identifiers

- NRIC/FIN prefixes S, T (citizens/PR, before/after 2000), F, G (foreigners before 2000 / 2000–2021), M (from 1 Jan 2022) ([Wikipedia](https://en.wikipedia.org/wiki/National_Registration_Identity_Card), [ICA](https://www.ica.gov.sg/news-and-publications/newsroom/media-release/new-m-fin-series-to-be-introduced-from-1-january-2022)).
- Check digit for S/T/F/G: weights 2,7,6,5,4,3,2, mod 11, offset 4 for T/G ([Ngiam](https://www.ngiam.net/NRIC/outlinee.htm)); M-series algorithm not published, so M is format-matched only. Microsoft Purview uses the same pattern with a checksum ([Purview](https://learn.microsoft.com/en-us/purview/sit-defn-singapore-national-registration-identity-card-number)).
- Phones: +65 + 8 digits; 6 fixed, 8/9 mobile, 3 VoIP, 1800 toll-free ([Wikipedia](https://en.wikipedia.org/wiki/Telephone_numbers_in_Singapore)).
- Postal code: 6 digits ([NLB](https://eresources.nlb.gov.sg/infopedia/articles/SIP_1006_2010-05-27.html)); unit "#xx-xx", "Blk" ([format guide](https://parcelpath.com/international-shipping/destinations/asia/singapore/singapore-address-format/)).

## 6. Risky PDF contents

pdfid flags /JS, /JavaScript, /AA, /OpenAction, /Launch, /EmbeddedFile, /AcroForm, /XFA, plus /RichMedia, /ObjStm, /JBIG2Decode ([Stevens tools](https://blog.didierstevens.com/programs/pdf-tools/), [Access Now guide](https://communitydocs.accessnow.org/363-Analysing_Suspicious_PDF_files.html)). /AA and /OpenAction run on open. Hits are not proof of malice ([false positives](https://blog.didierstevens.com/2013/06/10/pdfid-false-positives)), so the scan explains "what this can do" rather than "this is malware". We also flag /SubmitForm, /ImportData, /URI, /GoToR, /GoToE (from PDF 2.0 ISO 32000-2 action types).

## 7. No-network CSP

- All enforced policies apply; a meta policy can only narrow ([CSP3](https://www.w3.org/TR/CSP3/)). `frame-ancestors`, `report-uri`, `sandbox` are ignored in meta, so headers matter (Cloudflare Workers can send them; GitHub Pages cannot).
- Dynamically inserted meta CSP: not specified clearly; must be tested per browser (spike).
- COOP same-origin + COEP require-corp give `crossOriginIsolated` ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy)).
- Evidence for users: `PerformanceResourceTiming` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)) and `securitypolicyviolation` events.

## 8. Libraries (checked 2026-11-19)

| Need | Pick | Licence | Notes |
|---|---|---|---|
| Render, text positions | pdfjs-dist 6.5.x | Apache-2.0 | Self-host cmaps, standard_fonts, wasm; needs `'wasm-unsafe-eval'` |
| Edit, forms, encrypt | @cantoo/pdf-lib 2.11.x | MIT | Active fork: AES-256 encrypt/decrypt, flatten, incremental save. Upstream pdf-lib stale since 2021 |
| Redact, structure, encrypt | @embedpdf/pdfium 2.15.x | MIT wrapper + BSD PDFium | `EPDFText_RedactInRect`, `EPDFPage_ApplyRedactions`, `EPDF_SetEncryption`; 4.4 MB wasm. Spike first |
| Check/repair/linearize | @neslinesli93/qpdf-wasm 0.3.1 | ISC wrapper, qpdf Apache-2.0 | qpdf 11.7.0, 1.3 MB; `--check`, `--json`, `--encrypt`, `--decrypt` |
| OCR | tesseract.js 7 | Apache-2.0 | `pdf: true` output; self-host core + `eng` `4.0.0_best_int` (2.95 MB gz, Apache-2.0); no PDF input (render with pdf.js first) |
| JPEG encode | @jsquash/jpeg | Apache-2.0 | MozJPEG; re-encode strips EXIF |
| HEIC | native decode only | — | libheif is LGPL-3.0 (heic2any bundles it); skipped |
| Faces | @mediapipe/tasks-vision + BlazeFace short-range | Apache-2.0 | Self-host model; verify model card licence |
| Diff | diff (jsdiff) 9 | BSD-3-Clause | |
| Avoid | mupdf, Ghostscript | AGPL | Would force AGPL |

Tests: fast-check (MIT), @axe-core/playwright (MPL-2.0, dev only), qpdf CLI 12.4.2 ([release](https://github.com/qpdf/qpdf/releases/tag/v12.4.2), Windows zip into `tools/`; apt in CI).

## 9. Signatures

Drawn/typed marks are simple electronic signatures at most; validity depends on the recipient and the law (Singapore ETA s.8 [summary](https://www.jonesday.com/en/insights/2021/02/singapores-electronic-transactions-act-expanded); eIDAS Art. 3(10) [summary](https://economie.fgov.be/en/themes/online/e-commerce/electronic-signature-and-other)). Never call them digital, certified or qualified signatures.

## 10. WCAG 2.2 AA items that bite here

2.5.7 dragging alternative (reorder by buttons/keys), 2.5.8 target size 24px (house rule is 48px on mobile), 2.4.11 focus not obscured (sticky bars), 3.3.7 redundant entry ([W3C Understanding docs](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)).

## 11. Name

"PaperDesk" is a live iPad note app that imports PDFs ([App Store](https://apps.apple.com/us/app/paperdesk/id367563434)); see DECISIONS D1.

## 12. UX teardown and brainstorm (2026-11-20)

Sources: iLovePDF sign and tools pages, Smallpdf sign, PDF24 home, BentoPDF review (itsfoss.com/bentopdf), Capterra/G2/Trustpilot reviews of Smallpdf and iLovePDF, a self-audit of MossPDF's code and screenshots. Reddit was not reachable; complaint evidence is secondhand.

What users complain about elsewhere: task caps, ads that misfire, watermarks on free output, upload to servers, login or upgrade walls at download, slow OCR, poor compression quality. What they praise: free with no account, ease of use, local processing, offline after first load.

Nobody checked combines size before/after, a preview and a next step on the result screen. Few tools fill existing form fields well.

Accepted (ranked):
1. Result card with size before → after and change, "Start over", and "Use in another tool" (hands the output to the next tool without a download).
2. Home search and "Recently used" (local to the browser, nothing leaves it).
3. Undo for Clear all and file removal; "Remove files that can't be opened".
4. Sign: draw / type / upload, initials, date with format choice, free text, place on this page or all pages, keyboard move and resize (iLovePDF has the most complete flow; we match it without accounts).
5. Fill existing AcroForm fields in place on the page, with a plain field list fallback for phones.
6. OCR output as a searchable PDF and as plain text.
7. Command palette and single-key shortcuts (M8).
8. Ready-made workflows (M8).

Rejected:
- QR handoff to sign on a phone (iLovePDF): needs a server relay; breaks "nothing leaves the device".
- Cloud import (Drive, Dropbox): network, and a privacy risk.
- Saving signatures between visits: convenient but sensitive; not stored at all (D15).
- Accounts, caps, watermarks, upsells: never.
