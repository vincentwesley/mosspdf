# Needs Vin

Nothing blocks the project. Decisions only you can make, when convenient:

1. **Trademark**: "MossPDF" passed a web, app-store, pages.dev and domain screen only (2026-11-21). Run a formal check (USPTO, EUIPO, IPOS, classes 9 and 42) before any commercial use.
2. **Encryption notice** (optional, US EAR 742.15(b)): the public repo contains standard AES via qpdf. A one-time courtesy email to crypt@bis.doc.gov and enc@nsa.gov with the repo URL covers it; check the current addresses first.
3. **Old addresses**: The old workers.dev address and mosspdf.vwesley.workers.dev are tiny Workers that 301 to https://mosspdf.pages.dev. Delete them in the Cloudflare dashboard (Workers & Pages) whenever old links no longer matter.
- Certificate (digital) signing with your own .p12: skipped by default in v1.12. Say if you want it (pkijs, BSD; needs a full security review).
- **v2.0.0 release** (from your PC): merged and deployed already, live smoke green. Left: `npm run release`, `git tag -a v2.0.0 -m v2.0.0` + push the tag, `gh release create v2.0.0 release/mosspdf-v2.0.0.zip --notes-file <CHANGELOG 2.0.0 section>`. Optional: submit https://mosspdf.pages.dev/sitemap.xml in Google Search Console and Bing Webmaster Tools.
- **Launch video** (`brag`): not made in the cloud session; record one from your machine if you want it for the README.
