# Paper Desk

Private PDF tools, coming soon. Everything runs entirely in the browser.

```bash
npm install --ignore-scripts
npm run dev        # local dev server
npm run check      # typecheck + lint + unit + build
npm run test:e2e   # Playwright (headless)
```

## Deploy
Cloudflare Workers static assets, deployed locally: `npm run build && npx wrangler deploy`.

## Secrets and network
No secrets, no network calls; runs entirely in the browser. Files never leave your device. Only the theme and logo size choices are stored in `localStorage`.

Provided as is, no warranty.

## Credits
Designed and built by Vin, Vin's Atelier (https://vwesley.dev). Logo by @portus_workstation / @wason25_pz (Instagram); the logo is all rights reserved (see NOTICE.md), not covered by the MIT licence.
