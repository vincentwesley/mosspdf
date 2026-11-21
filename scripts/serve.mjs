// Pagehold local server: Node 18+ stdlib only, offline, 127.0.0.1 only. Usage: node serve.mjs [--port 8080]
import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".gz": "application/gzip", ".pdf": "application/pdf", ".traineddata": "application/octet-stream",
};

// Cloudflare _headers: unindented line = path pattern (`*` wildcard), indented "Name: value" = header.
// Matching rules merge; a header repeated across rules is joined with ",".
function loadRules() {
  let txt = "";
  try { txt = readFileSync(join(root, "_headers"), "utf8"); } catch { /* no _headers: serve without */ }
  const rules = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const h = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (h && rules.length) rules[rules.length - 1].headers.push([h[1], h[2].trim()]);
    else if (!/^\s/.test(line)) rules.push({ re: new RegExp("^" + line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"), headers: [] });
  }
  return rules;
}
const rules = loadRules();

function headersFor(path) {
  const out = {};
  for (const r of rules) if (r.re.test(path)) for (const [k, v] of r.headers) out[k] = k in out ? `${out[k]},${v}` : v;
  return out;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function send(req, res, status, path, file) {
  const headers = headersFor(path);
  if (file) { headers["Content-Type"] = MIME[extname(file).toLowerCase()] ?? "application/octet-stream"; headers["Content-Length"] = statSync(file).size; }
  res.writeHead(status, headers);
  if (file && req.method !== "HEAD") createReadStream(file).pipe(res);
  else res.end();
}

function send404(req, res, path) {
  const p404 = join(root, "404.html");
  send(req, res, 404, path, isFile(p404) ? p404 : undefined);
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
  let path;
  try { path = decodeURIComponent(req.url.split(/[?#]/)[0]); } catch { res.writeHead(400); return res.end("Bad request"); }
  if (path.includes("\0") || path.includes("\\")) { res.writeHead(400); return res.end("Bad request"); }
  const abs = resolve(root, "." + path);
  if (abs !== root && !abs.startsWith(root + sep)) return send404(req, res, path);
  const rel = abs.slice(root.length + 1);
  if (rel === "_headers" || rel.startsWith(".")) return send404(req, res, path);
  // Like Cloudflare html_handling: / -> index.html, /x -> x.html, /x/ -> x/index.html. No directory listing.
  const file = [abs, abs + ".html", join(abs, "index.html")].find(isFile);
  if (!file) return send404(req, res, path);
  send(req, res, 200, path, file);
});

const i = process.argv.indexOf("--port");
const port = i > 0 ? Number(process.argv[i + 1]) : 8080;
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("Invalid --port"); process.exit(1); }
server.on("error", (e) => { console.error(e.code === "EADDRINUSE" ? `Port ${port} is in use. Try: node serve.mjs --port ${port + 1}` : e.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log(`Pagehold running at http://127.0.0.1:${server.address().port}/  (Ctrl+C to stop)`));
