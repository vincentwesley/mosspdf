import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const PDFJS = "node_modules/pdfjs-dist";
const VIRTUAL = "virtual:pdfjs-data";

/** Packs the pdf.js cmaps, standard fonts and wasm into ONE file so the seal can preload them with a single request.
 *  Layout: u32 header length, JSON header {"<kind>/<name>": [offset, length]}, then the bytes. */
function pdfjsData(): Plugin {
  const pack = () => {
    const parts: { key: string; buf: Buffer }[] = [];
    for (const [kind, dir, ext] of [["cMapUrl", "cmaps", ".bcmap"], ["standardFontDataUrl", "standard_fonts", ""], ["wasmUrl", "wasm", ".wasm"]] as const) {
      for (const f of readdirSync(join(PDFJS, dir)).sort()) {
        if (/^LICENSE/.test(f) || (ext && !f.endsWith(ext))) continue;
        parts.push({ key: `${kind}/${f}`, buf: readFileSync(join(PDFJS, dir, f)) });
      }
    }
    const index: Record<string, [number, number]> = {};
    let off = 0;
    for (const p of parts) { index[p.key] = [off, p.buf.length]; off += p.buf.length; }
    const head = Buffer.from(JSON.stringify(index));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(head.length);
    return Buffer.concat([len, head, ...parts.map((p) => p.buf)]);
  };
  let serve = false;
  return {
    name: "pagehold-pdfjs-data",
    configResolved: (c) => { serve = c.command === "serve"; },
    resolveId: (id) => (id === VIRTUAL ? "\0" + VIRTUAL : undefined),
    load(id) {
      if (id !== "\0" + VIRTUAL) return;
      if (serve) return `export default "/@pdfjs-data.bin";`;
      const ref = this.emitFile({ type: "asset", name: "pdfjs-data.bin", source: pack() });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    configureServer(s) {
      s.middlewares.use("/@pdfjs-data.bin", (_q, res) => { res.setHeader("Content-Type", "application/octet-stream"); res.end(pack()); });
    },
  };
}

/** Stamps public/sw.js (copied into dist) with the precache list of the finished build and a version derived from it. */
function swPrecache(): Plugin {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return {
    name: "pagehold-sw-precache",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const dist = "dist";
      const files = walk(dist).map((f) => "/" + relative(dist, f).split("\\").join("/")).filter((f) => f !== "/sw.js" && f !== "/_headers" && f !== "/index.html").sort();
      const list = ["/", ...files];
      const hash = createHash("sha256").update(JSON.stringify(list)).update(readFileSync(join(dist, "index.html"))).digest("hex").slice(0, 10);
      const sw = readFileSync(join(dist, "sw.js"), "utf8").replace("__PRECACHE__", JSON.stringify(list)).replace("__VERSION__", `${pkg.version}-${hash}`);
      writeFileSync(join(dist, "sw.js"), sw);
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [pdfjsData(), swPrecache()],
  build: { assetsInlineLimit: 0 }, // CSP script-src 'self': nothing may be inlined
  worker: {
    format: "es",
    rollupOptions: { output: { entryFileNames: "assets/workers/[name]-[hash].js", chunkFileNames: "assets/workers/[name]-[hash].js", codeSplitting: false } },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
