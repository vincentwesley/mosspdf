# Legal review

A plain checklist of the legal and licensing points for MossPDF, as of 2026-11-20. It is an engineering review, not legal advice. Items that need the owner's decision are marked **Owner**.

## Licences

- MossPDF's own code: MIT, `Copyright (c) 2026 Vin's Atelier` (the owner chose this line for this project).
- The logo and the credits art are all rights reserved (`NOTICE.md`), not MIT.
- Every shipped third-party item is listed in `THIRD_PARTY_NOTICES.md` with its licence. `npm run licences` fails the build if a production dependency is not allowlisted and named there.
- Licences in the build: Apache-2.0, MIT, ISC, BSD-2/3-Clause, 0BSD, Zlib, IJG, SIL OFL 1.1. All of them allow commercial and non-commercial use, with attribution.
- No AGPL or GPL code is linked: MuPDF and Ghostscript were rejected for this reason (RESEARCH §8).
- **Done:** Liberation Sans (GPL-2) is no longer shipped; the build contains no GPL material (D22).

## What the app claims, and whether it holds

| Claim | Basis | Limit stated in the app |
|---|---|---|
| Files never leave the device | Header CSP allows only this site; the page seals itself with a stricter CSP after loading; engine workers have no network; e2e tests fail on any request after the seal | The privacy panel lists every request, and the how-to-check guide explains how to verify |
| Redaction removes text for good | Affected pages are rebuilt as pictures; text, metadata, annotations, attachments and matching bookmarks are removed; a leak scan blocks saving | "Check before sharing": open the result and search for a redacted word. The app says automatic search can miss items and tells the user to review the boxes and check the result |
| Signatures | A picture of a signature only | Always shown: "not a certified digital signature, and some organisations require one" (RESEARCH §9: Singapore ETA, eIDAS) |
| Remove password | Only with the correct password (owner password to lift restrictions) | Never cracks or bypasses protection (D13). No DRM removal |
| Clean copy to share | Removes scripts, actions, attachments, metadata, annotation authors, unsafe links | Redaction stays a separate, manual step; warnings are shown if anything risky remains |
| Accessibility check | Basic structural checks | "Not a PDF/UA certification" |
| OCR | Tesseract (English, Chinese (Simplified), Malay, Tamil) | The app says results can contain mistakes and should be checked |

## Privacy (PDPA, GDPR)

- The operator collects no personal data: there are no accounts, analytics, cookies, server logs of file contents or third-party hosts.
- Cloudflare serves the static files. Its standard request logs (IP, user agent) apply to page loads, as for any website. The privacy page says so.
- The browser's local storage holds only the theme, the logo form, recently used tools, the OCR languages chosen and a small counter for the logo tip. Files are never stored. Signatures and initials are never stored unless you choose "Keep on this device"; you can forget them any time.

## Names and marks

- "MossPDF" is the current name. The product was renamed on 2026-11-21 because another app uses its earlier name (D1, D23); "Paper Desk" was rejected earlier because an existing iPad app uses it. A basic web and app-store search found no PDF product with this name. This is not a formal trademark clearance. **Owner:** run one before any commercial use.
- Competitor names in `docs/COMPARISON.md` are used only to describe them factually.

## Test material

- IRS Form W-9 (US federal work, public domain) is downloaded only on demand for tests and is not committed.
- Every other fixture is self-generated (CC0). There is no real personal data: NRIC numbers in tests are made up and only checksum-valid.

## Warranty

The README and LICENSE state "provided as is, no warranty". The app repeats the limits next to the tools where they matter: redaction, signatures and the accessibility check.

## 2026-11-21 audit

- Added `licences.txt` (linked in the footer and the privacy page) and a Terms section on the privacy page.
- Softened claims: "stay on this device", "remove text, not just cover it", OCR and redaction accuracy warnings, signature and photo wording, seal log "that the browser reports".
- Liberation Sans dropped (D22), so no GPL material ships.
- Export rules: the encryption is open-source AES, publicly available. **Owner:** may send the courtesy notice to BIS/NSA.
