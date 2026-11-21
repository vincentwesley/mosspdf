Pagehold - private PDF tools that run entirely in your browser.
This folder is a static build. Your files never leave your computer.

RUN IT
  1. Install Node.js 18 or newer (https://nodejs.org).
  2. In this folder run:   node serve.mjs
     (another port:        node serve.mjs --port 9000)
  3. Open the printed address (default http://127.0.0.1:8080/) in a current browser.

It works offline. serve.mjs only listens on 127.0.0.1 (this computer), serves this folder,
and applies the security headers from the _headers file.

OTHER WAYS
  Any static file server works, but the Pagehold seal (strict CSP, no network for the PDF
  workers) depends on the headers in _headers. Plain servers ignore that file, so prefer
  serve.mjs. Opening index.html straight from disk (file://) does not work.

Licence: MIT, see LICENSE. Third-party notices: THIRD_PARTY_NOTICES.md. Content and art: NOTICE.md.
Provided as is, without warranty of any kind.
