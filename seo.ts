// Build-time static pages for search engines and first-timers: /tools/<id>/, /help/, sitemap.xml, robots.txt (used by vite.config.ts, tested in tests/seo.test.ts).
// Plain HTML, no JS: only the theme-init script and one ld+json data block. Every page passes the same strict CSP as the app.
import { TOOLS, toolById, type ToolMeta } from "./src/tools/index";

export const ORIGIN = "https://mosspdf.pages.dev";
const PRIVATE = "Runs in your browser; files never leave your device.";
const ISSUES = "https://github.com/vincentwesley/mosspdf/issues";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Schema.org data shared by the home page and every tool page. */
export const ldJson = (name: string, url: string, description: string) =>
  JSON.stringify({
    "@context": "https://schema.org", "@type": "SoftwareApplication", name, url, description,
    applicationCategory: "BusinessApplication", operatingSystem: "Any (web browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "Vin's Atelier", url: "https://vwesley.dev", founder: { "@type": "Person", name: "Vincent Wesley", alternateName: "Vin" } },
  }).replace(/</g, "\\u003c");

interface Page { title: string; description: string; path: string; body: string; ld?: string }

function shell(css: string[], p: Page): string {
  const url = ORIGIN + p.path;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="author" content="Vin, Vin's Atelier">
<meta name="theme-color" content="#11150e">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MossPDF">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/icons/icon-512.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
${css.map((c) => `<link rel="stylesheet" href="${c}">`).join("\n")}
<script src="/theme-init.js"></script>
${p.ld ? `<script type="application/ld+json">${p.ld}</script>\n` : ""}</head>
<body>
<a class="hs-skip" href="#main">Skip to content</a>
<header class="top"><a class="wordmark" href="/" aria-label="MossPDF, home">MossPDF</a></header>
<main id="main" class="sp">
${p.body}
</main>
<footer class="sp sp--foot"><nav aria-label="Footer"><a href="/">All tools</a> <a href="/help/">Help</a> <a href="/#/privacy">Privacy and terms</a> <a href="/licences.txt">Licences</a></nav>
<p>Copyright 2026 Vin's Atelier. Designed and built by Vin.</p></footer>
</body>
</html>
`;
}

export function toolPage(css: string[], t: ToolMeta, how?: string): { path: string; html: string } {
  const path = `/tools/${t.id}/`;
  const related = (t.next ?? []).map(toolById).filter((r): r is ToolMeta => !!r && r.id !== t.id);
  const title = `${t.title} — free, private PDF tool | MossPDF`;
  const description = `${t.blurb} ${PRIVATE}`;
  const body = `<h1>${esc(t.title)}</h1>
<p class="sp__lede">${esc(how ?? t.blurb)}</p>
<p><a class="hs-btn hs-btn--primary sp__cta" href="/#/${t.id}">Open ${esc(t.title)}</a></p>
<h2>How it works</h2>
<ol>
<li>Open ${esc(t.title)} and add your file. Drop it on the page or pick it from your device.</li>
<li>${esc(how ?? t.blurb)}</li>
<li>Download the result. Nothing is uploaded, so there are no accounts, limits or watermarks.</li>
</ol>
<p>${PRIVATE} Need a hand? See the <a href="/help/">help page</a>.</p>${related.length ? `
<h2>Often used next</h2>
<ul>
${related.map((r) => `<li><a href="/tools/${r.id}/">${esc(r.title)}</a>: ${esc(r.blurb)}</li>`).join("\n")}
</ul>` : ""}`;
  return { path, html: shell(css, { title, description, path, body, ld: ldJson(`${t.title} | MossPDF`, ORIGIN + path, description) }) };
}

const FAQ: [string, string][] = [
  ["Are my files uploaded?", "No. MossPDF does every job inside your browser and seals the page against the network after it loads. To check, tap the seal badge at the top of the app: it shows the network requests the page has made, and none carry your files."],
  ["Does it work offline?", "Yes. Open MossPDF once, then install it from your browser (Install app, or Add to Home Screen on a phone). After that it opens and works with no connection."],
  ["What are the limits?", "There is no file count or size cap from us, but your device decides how much it can hold. Very big files (hundreds of megabytes) can run out of memory, especially on phones. MossPDF shows a memory warning before that happens. If it does, split the file first or close other tabs."],
  ["Why is something not supported?", "PDF/A conversion and certificate (digital ID) signing are not available. Both need heavy engines or a server. Editing existing text in Tamil is not supported either, because complex scripts cannot be re-shaped reliably. OCR can still read English, Chinese (Simplified), Malay and Tamil."],
  ["Which browsers work?", "Current Chrome, Edge, Firefox and Safari, on desktop and phones. Older browsers may miss features the tools need."],
  ["How do I report a problem?", `Open an issue on GitHub: ${ISSUES}. Please never attach private files. Describe the tool, what you did and what you saw.`],
  ["Licences and terms", "MossPDF is open source under the MIT licence. Terms and privacy notes are in the app; third-party licences are listed in licences.txt."],
];

export function helpPage(css: string[]): { path: string; html: string } {
  const path = "/help/";
  const body = `<h1>Help</h1>
<p class="sp__lede">Short answers for first-time visitors. ${PRIVATE}</p>
<p><a class="hs-btn hs-btn--primary sp__cta" href="/">Open MossPDF</a></p>
${FAQ.map(([q, a]) => `<h2>${esc(q)}</h2>\n<p>${esc(a).replace(ISSUES, `<a href="${ISSUES}" rel="noopener">${ISSUES}</a>`)}</p>`).join("\n")}
<p><a href="/#/privacy">Privacy and terms</a> · <a href="/licences.txt">Licences</a> · <a href="${ISSUES}" rel="noopener">GitHub issues</a></p>`;
  return { path, html: shell(css, { title: "Help — free, private PDF tools | MossPDF", description: `Answers about privacy, offline use, limits and browsers. ${PRIVATE}`, path, body }) };
}

/** Every generated page plus sitemap.xml and robots.txt, keyed by dist-relative file name. */
export function seoFiles(css: string[], hows: Record<string, string> = {}): Record<string, string> {
  const pages = [...TOOLS.map((t) => toolPage(css, t, hows[t.id])), helpPage(css)];
  const out: Record<string, string> = {};
  for (const p of pages) out[`${p.path.slice(1)}index.html`] = p.html;
  const urls = ["/", ...pages.map((p) => p.path)];
  out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${ORIGIN}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  out["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;
  return out;
}
