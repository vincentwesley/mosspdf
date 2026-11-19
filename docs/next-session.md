> Update at the end of any session that changed state. Keep it lean.

Continue work on **Pagehold** (repo `vincentwesley/pagehold`, not deployed yet).
Scaffolded 2026-11-19 from the vite-ts starter + house kit; check and build green. Only do what the owner asks.

## Before anything
1. Work in `C:\Coding Projects\pagehold`; read this file and `docs/PLAN.md`.
2. `npm ci --ignore-scripts`, then `npm run check`.

## How to work here
- Local commits only unless the owner says push. Identity: `vincentwesley` noreply.
- Deploys run locally: `npm run build && npx wrangler deploy` (no deploy workflow).
- Checks: `npm run check` (typecheck + lint + unit + build); `npm run test:e2e` at milestones.

## Current state
- Placeholder page only ("Pagehold: private PDF tools, coming soon"), credits card + draggable logo in the footer. Strict CSP with COOP/COEP in `public/_headers`.

## Known gaps / ideas
1. Fill `docs/PLAN.md`, `ACCEPTANCE.md`, `RESEARCH.md`; no tools built yet.
2. Report outcomes in a line or two.

## M1 part B (branch m1-ui)
- Shell, home, tool views (merge/split/organize/extract), seal (`src/core/seal.ts`, engines in `src/core/engines.ts`), privacy dialog/page, PWA (`public/sw.js`, stamped at build by `vite.config.ts`).
- `src/ops/index.ts` + `src/ops/types.ts` are TEMPORARY stubs; the m1-ops merge replaces them. Then: import `createEngines`/`Engines` from `../engines/qpdf` in `src/workers/ops.worker.ts`, check the `SplitMode` shape, and import `parseRanges` from a leaf module so ops code stays out of the main bundle.
- Workers load via `?worker&url` + Trusted Types policy `pagehold` (`src/core/tt.ts`); header has `trusted-types pagehold`, `style-src 'self'`.
- pdf.js data (cmaps, fonts, wasm) is packed into one asset and served from memory (`MemoryDataFactory`); all of it is preloaded before the seal (about 2.8 MB).
