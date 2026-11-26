# MossPDF compared with popular PDF tools

MossPDF column updated for v2.0 (2026-11-26): 36 tools and 4 workflows. Competitor columns are based on each tool's public pages and reviews, checked 2026-11-20 (RESEARCH §12). Other products change often, so treat their columns as a snapshot. "Server" means files are uploaded for processing.

| | MossPDF | iLovePDF | Smallpdf | PDF24 Tools (online) | Stirling-PDF | BentoPDF |
|---|---|---|---|---|---|---|
| Where files are processed | In your browser; page sealed against the network | Server | Server | Server | Your own server (self-hosted) | In your browser |
| Account needed | No | No for basics | No for basics | No | No (you host it) | No |
| Free limits or paywalls | None | Task and size limits; Premium tier | Daily task limits; Pro tier | Free | Free (self-hosted) | Free |
| Ads | None | Yes | No ads reported, upsells | Yes | None | None |
| Works offline | Yes (installable app) | No | No | Desktop app only | Only on your network | Yes, after first load |
| Proof that nothing is uploaded | Request log and seal, checkable in DevTools | No | No | No | N/A | Stated, no in-app log |
| Merge, split, organize, compress, convert | Yes | Yes | Yes | Yes | Yes | Yes |
| PDF to Word, Excel, PowerPoint | Yes, in the browser (Word keeps text, pictures, bold and italic; PowerPoint pages are pictures) | Yes (server) | Yes (server) | Yes (server) | Yes | Yes |
| PDF to Markdown or text | Yes | Not checked | Not checked | Not checked | Not checked | Not checked |
| Edit PDF (add text, pictures, shapes) | Yes, with undo | Yes | Yes | Yes | Not checked | Not checked |
| Create fillable forms | Yes (text, checkbox, date, dropdown, signature area) | Not checked | Not checked | Not checked | Not checked | Not checked |
| Bookmarks editor | Yes | Not checked | Not checked | Not checked | Not checked | Not checked |
| Own reusable workflows | Yes (2-5 steps, saved on the device) | Not checked | Not checked | Not checked | Yes (pipelines) | Not checked |
| Batch (many files at once) | Yes, 17 tools | Not checked | Not checked | Not checked | Not checked | Not checked |
| Fill existing form fields | Yes, on the page and in a list | Separate form tool | Separate form filler | Yes | Yes | Yes |
| Sign (draw, type, upload) | Yes, plus initials, date and text, on one page or every page; keep signatures on the device if you opt in | Yes, plus a stamp and multi-signer (Premium) | Yes | Yes | Yes | Yes |
| Remove text, not just cover it | Yes: pages rebuilt, metadata and attachments removed, leak scan | Paid tier | Limited | Yes | Yes | Yes |
| SG NRIC/FIN, phone and address detection | Yes | No | No | No | No | No |
| OCR | Yes, 17 languages loaded on demand, with scan clean-up | Yes | Pro | Yes | Yes | Yes |
| Compare two versions | Yes: text, side by side, pixel overlay, report | Yes | Pro | Yes | Yes | Not seen |
| Safety scan and cleaned copy | Yes | No | No | No | Partial (sanitise) | Not seen |
| Photo metadata (EXIF/GPS) removal | Yes | No | No | No | Partial | Not seen |
| Result card with size change and "use in another tool" | Yes | Partial | Partial | No | No | Size change on compress |
| Open source | Yes (MIT) | No | No | No | Yes | Yes |

Competitor columns reflect their public pages as checked on 2026-11-20 and may have changed; "No" means not stated there. "Not checked" marks rows added in v2.0 that were not re-researched for that product.

## Where MossPDF is ahead

- **Privacy you can check:** most "local" tools only say so. MossPDF seals the page and shows a request log.
- **Singapore details:** NRIC/FIN detection with checksum, SG phone formats and addresses in redaction.
- **Safety:** a scan for risky PDF parts with a cleaned copy, and a "Clean copy to share" workflow.
- **No task limits, ads, accounts or watermarks** (your device's memory is the only cap).
- **Conversions without a server:** PDF to Word, Excel, PowerPoint and Markdown all run in the browser.

## Where others are ahead

- **Breadth:** Stirling-PDF and BentoPDF still have more tools (Office or HTML to PDF, PDF/A, and others). MossPDF converts from PDF but not into PDF from Office files, because that needs large engines or a server, and has no PDF/A (no permissively licensed in-browser engine).
- **Layout-faithful conversion:** server tools keep more layout in Word and real editable text in PowerPoint.
- **OCR languages:** 17; server tools offer more.
- **Multi-signer flows:** iLovePDF supports them, but it needs accounts and a server.
- **Desktop apps:** PDF24 has one. MossPDF installs as a web app instead.
