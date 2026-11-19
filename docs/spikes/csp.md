# CSP lockdown spike

Spike code (untracked, gitignored): `spikes/csp/` in the main checkout (`site/` = test app + the production `_headers` + a `/worker.js` rule, `run.mjs`, `nosw.mjs`). Tested with Playwright 1.65.1 (Chromium, Firefox, WebKit, headless) against `wrangler@4.165.0 dev`. Test origin was `http://127.0.0.1:8788`.

## Serving

`wrangler dev` with `assets.directory` DOES honour `_headers` (all headers, `Content-Type: application/wasm` too). Multiple matching rules are merged by comma-joining, so two `Content-Security-Policy` values are both enforced (intersection). That means a per-path rule can only tighten the global policy, never relax it. Wrangler's request log shows method and path only (no query string), so use unique paths for probes. Gotcha: wrangler 4.165 needs Node >= 22; set `WRANGLER_SEND_METRICS=false`, `XDG_CONFIG_HOME` and `WRANGLER_LOG_PATH` to keep it out of the user profile.

## Results (identical in Chromium, Firefox, WebKit unless a column differs)

| Question | Chromium | Firefox | WebKit |
|---|---|---|---|
| COOP same-origin + COEP require-corp gives `crossOriginIsolated`, `SharedArrayBuffer` | yes | yes | yes |
| Module worker from file, blob: worker, `new Worker` of both | work | work | work |
| `WebAssembly.instantiateStreaming(fetch('/add.wasm'))` in page (needs `application/wasm`, `connect-src 'self'`, `'wasm-unsafe-eval'`) | works | works | works |
| Same in a worker served with `connect-src 'none'` header | blocked (fetch) | blocked | blocked |
| Same in a blob: worker (inherits page CSP) | works | works | works |
| Wasm bytes posted to a `connect-src 'none'` worker, `WebAssembly.instantiate(bytes)` | works | works | works |
| Meta `connect-src 'none'`: later `fetch`, XHR, `fetch(blob:)` | blocked | blocked | blocked |
| `securitypolicyviolation` fired for blocked fetch/XHR/img/beacon/import | yes | yes | yes |
| `navigator.sendBeacon` return value after block | true (lies) | false | true (lies) |
| Meta `connect-src 'none'`: dynamic `import()`, `<script src>`, `new Worker(url)`, `new Worker(blob)` | all still work | same | same |
| Meta `connect-src 'none'`: new `<img src>` | not blocked (onerror only because the probe 404s; no violation) | same | same |
| Meta `default-src 'none'` (B): import(), script tag, img, all new workers (incl. blob) | blocked | blocked | blocked |
| B also breaks `WebAssembly.instantiate(bytes)` in the page (`script-src` loses `'wasm-unsafe-eval'`) | yes, CompileError | yes | yes |
| Policy C/D (below): page `WebAssembly.instantiate(bytes)` | works | works | works |
| Workers created BEFORE lockdown (blob worker, generic-header file worker): `fetch` and XHR to same origin after lockdown | NOT blocked (reached server) | NOT blocked | NOT blocked |
| Module worker whose script has `connect-src 'none'` header: fetch | blocked (before and after) | blocked | blocked |
| Blob worker created AFTER lockdown (policy A or D): its fetch | blocked (inherits lock) | blocked | blocked |
| `<a download href=blob:>` click after lockdown (A, B, C, D) | downloads | downloads (see gotcha) | downloads |

Violation directives seen: `connect-src` (fetch, XHR, beacon, blob fetch, wasm fetch), `script-src-elem` (script tag, import), `img-src`, `worker-src`, `script-src` (`wasm-eval`, only under B).

### Service worker

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| SW registers under COOP/COEP; page controlled after reload; still `crossOriginIsolated` | yes | yes | yes |
| After lockdown, page fetch of a precached URL | blocked, never reaches SW (CSP is checked first); violation fired | same | same |
| SW's own `fetch` to same origin | allowed (hit the server) | allowed | allowed |
| SW's own `fetch` to cross-origin | blocked by sw.js response CSP (`connect-src 'self'`) | blocked | blocked |
| Offline (`context.setOffline(true)`) reload, app fully loads from SW, `crossOriginIsolated`, workers, wasm all fine | yes | `NS_ERROR_OFFLINE` (Playwright emulation kills the navigation; not a real SW failure) | yes |
| Online reload of a SW-controlled page: server hits | none (not even sw.js) | `/sw.js` 304 + `/favicon.ico` | `/sw.js` 200 |

The SW update check of `/sw.js` is browser-initiated and always same-origin; it is the only expected network hit on reload. Because the SW itself can fetch same-origin after "lockdown", its policy must stay `connect-src 'self'` (needed for precache at install); it is same-origin only, so no third-party host can ever be contacted. A SW that never calls `fetch` outside install is a code-review item, not a CSP guarantee.

## Recommended policies

**Header (`public/_headers`)**: the existing `/*` policy works as is (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ... connect-src 'self'; worker-src 'self' blob:` with COOP/COEP/CORP). Add one rule so engine workers have no network at all from their first instruction (merged with `/*`, so it only tightens):

```
/assets/workers/*
  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'
```

(Adjust the path to wherever Vite emits worker chunks; the spike used `/worker.js`.) Such workers cannot `fetch` the wasm: load it in the main thread before lockdown and `postMessage` the bytes (tested) or the compiled `WebAssembly.Module` (structured-cloneable, not tested here).

**Lockdown meta** (appended to `<head>` once the app, its wasm bytes and its workers are ready):

```
default-src 'none'; script-src 'wasm-unsafe-eval'; worker-src blob:; form-action 'none'; base-uri 'none'
```

(policy D). Use `worker-src 'none'` instead (policy C; drop `worker-src blob:`) if all workers are spawned before lockdown. Do not use plain `default-src 'none'` (B) or `connect-src 'none'` alone (A: leaves import(), script tags and new workers open). Meta CSP cannot carry `frame-ancestors`; the header already does. Blocked under C/D in all three browsers: fetch, XHR, beacon, cross-origin, img, script tag, dynamic import, `new Worker(url)`, fetch of blob: URLs. Blob downloads keep working (navigation/download is not governed by these directives).

## Gotchas

- Workers created before lockdown are not affected by the meta: blob workers and file workers with only the global header still `fetch`/XHR same-origin afterwards (confirmed server-side). Fix: header `connect-src 'none'` on worker scripts, and/or create workers after lockdown (blob workers then inherit the lock under policy D).
- A `connect-src 'none'` worker script header blocks `instantiateStreaming(fetch())` inside it; ship bytes in.
- `fetch(blobUrl)` is blocked after lockdown: read Blobs with `blob.arrayBuffer()`; build download URLs from Blobs only.
- Meta policies accumulate and can only tighten; apply once, never expect to relax.
- `sendBeacon` returns true in Chromium/WebKit even when CSP drops it; rely on `securitypolicyviolation`.
- Firefox gave the download the name `out.pdf` when the blob type was `application/pdf` and the `download` attribute was `out.txt` (extension follows MIME); set matching type and filename.
- `page.setOffline` in Firefox fails SW-controlled navigations (`NS_ERROR_OFFLINE`); verify Firefox offline with server-side logs of an online reload instead.

## Measurement

(a) Playwright "no request reached the network after ready":
- Best: `context.route('**/*', r => { hits.push(url); r.continue(); })` on a context with `serviceWorkers: 'block'`. Verified in all three browsers: it records only requests that really leave the browser. With policy C and fetch/img/XHR/import/cross-origin probes it saw nothing, while a deliberate leak (pre-created blob worker fetch) was recorded in all three.
- `page.on('request')` and `context.on('request')` are NOT reliable in Chromium: they also fire for CSP-blocked requests (then `requestfailed`), giving false positives. Firefox/WebKit only fire for real requests.
- With a SW active, `route` is unreliable: Chromium sees the SW's network fallthrough, Firefox and WebKit see nothing; `context.on('request')` shows SW-originated fetches only in Chromium; `response.fromServiceWorker()` is true for SW-answered responses (cache hit or network fallthrough, cannot tell which). CDP `Network.requestWillBeSent` (Chromium only) does not show the SW's own requests or CSP-blocked ones.
- Ground truth for SW scenarios: server-side request log (wrangler dev stdout, or a counting Node static server) over an online reload. Use unique probe paths.
- Suggested test split: (1) no-SW context + `route` + lockdown probes, all 3 browsers; (2) SW test: register, reload, `setOffline(true)` reload (Chromium, WebKit) and server-log diff on online reload (all); (3) negative control that deliberately leaks, so the detector is proven.

(b) In-app panel:
- `PerformanceObserver({type:'resource', buffered:true})` lists successful page-initiated requests incl. SW-served ones (`transferSize` 0; `workerStart > 0` marks SW involvement in Chromium/WebKit, always 0 in Firefox, so not portable). CSP-blocked requests create no entry. Worker-initiated requests do not appear in the page's observer.
- `document.addEventListener('securitypolicyviolation')` reports every blocked attempt from the page (directive + blockedURI), including after lockdown. Violations inside workers are not delivered to the document.
- Panel = "requests attempted" from PerformanceObserver (should stay empty after ready) + "blocked" from violations, with the caveat that worker traffic is covered by the worker header CSP, not observable.

