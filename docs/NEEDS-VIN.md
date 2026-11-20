# Needs Vin

Nothing blocks the project. Decisions only you can make, when convenient:

1. **Liberation Sans** (GPL-2 with font exception) ships inside pdf.js's data pack as a fallback font. Keep (default, common practice) or drop (some PDFs then render with a different fallback). See docs/DECISIONS.md D11 and docs/LEGAL-REVIEW.md.
2. **Trademark**: "Pagehold" passed a basic web and app-store search only. Run a formal check before any commercial use.
3. **Custom domain** (optional): add it in the Cloudflare dashboard → Workers → pagehold → Domains & Routes.
