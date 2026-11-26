/* MossPDF service worker. The build stamps PRECACHE and VERSION (vite.config.ts); never edit them here.
   Cache-first for build assets, network-first for the page, old caches dropped on activate. It only ever fetches this site. */
const PRECACHE = __PRECACHE__;
const VERSION = "__VERSION__";
const CACHE = "mosspdf-" + VERSION;

self.addEventListener("install", (e) => {
  // No skipWaiting here: the page decides when to switch (never during a job).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("mosspdf-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname === "/sw.js") return;
  if (req.mode === "navigate") {
    // network-first so a fresh deploy shows up; the cached copy keeps it working offline
    e.respondWith(fetch(req).then((r) => { if (r.ok && url.pathname === "/") caches.open(CACHE).then((c) => c.put("/", r.clone())); return r; }).catch(() => caches.match("/").then((r) => r || Response.error())));
    return;
  }
  // OCR engine files and the optional Chinese font (D24) are not precached (about 6 MB, D16): kept the first time OCR loads, so it then works offline.
  const keep = /\/assets\/(tesseract-core|notosanssc-gb2312-400-normal|(eng|chi_sim|msa|tam)\.traineddata)-/.test(url.pathname);
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (keep && r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(req, c)); } return r; })));
});
