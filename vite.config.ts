import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
        // Liberation Sans (GPL-2) is not shipped; pdf.js then draws non-embedded Arial/Helvetica with the system sans-serif (D22).
        if (/^LICENSE/.test(f) || /^LiberationSans-/.test(f) || (ext && !f.endsWith(ext))) continue;
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
    name: "mosspdf-pdfjs-data",
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

/** Emits licences.txt at the dist root: our own notices, then every third-party licence text (Apache-2.0 s4 and the MIT/BSD/ISC/IJG/zlib/OFL notice duties). Fails the build if a source is missing. */
function licencesTxt(): Plugin {
  const nm = (p: string) => `node_modules/${p}`;
  const P = `${nm("pdfjs-dist")}`;
  const sources: [string, string][] = [
    ["MossPDF: LICENSE", "LICENSE"], ["MossPDF: NOTICE.md", "NOTICE.md"], ["Third-party notices: THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
    ["pdfjs-dist (pdf.js)", `${P}/LICENSE`], ["pdf.js cmaps (Adobe)", `${P}/cmaps/LICENSE`], ["pdf.js standard fonts (Foxit)", `${P}/standard_fonts/LICENSE_FOXIT`],
    ["pdf.js wasm: JBIG2 (PDFium)", `${P}/wasm/LICENSE_JBIG2`], ["pdf.js wasm: JBIG2 wrapper", `${P}/wasm/LICENSE_PDFJS_JBIG2`],
    ["pdf.js wasm: OpenJPEG", `${P}/wasm/LICENSE_OPENJPEG`], ["pdf.js wasm: OpenJPEG wrapper", `${P}/wasm/LICENSE_PDFJS_OPENJPEG`],
    ["pdf.js wasm: qcms", `${P}/wasm/LICENSE_QCMS`], ["pdf.js wasm: qcms wrapper", `${P}/wasm/LICENSE_PDFJS_QCMS`],
    ["pdf.js wasm: QuickJS", `${P}/wasm/LICENSE_QUICKJS`], ["pdf.js wasm: QuickJS wrapper", `${P}/wasm/LICENSE_PDFJS_QUICKJS`],
    ["@cantoo/fontkit", nm("@cantoo/fontkit/LICENSE")], ["@cantoo/pdf-lib", nm("@cantoo/pdf-lib/LICENSE.md")], ["fflate", nm("fflate/LICENSE")],
    ["base64-js", nm("base64-js/LICENSE")], ["culori", nm("culori/LICENSE")], ["html-entities", nm("html-entities/LICENSE")],
    ["node-html-better-parser", nm("node-html-better-parser/LICENSE")], ["restructure", nm("restructure/LICENSE")],
    ["brotli.js", "licences/brotli-mit.txt"], ["dfa", "licences/dfa.txt"], ["tslib", nm("tslib/LICENSE.txt")],
    ["@neslinesli93/qpdf-wasm", nm("@neslinesli93/qpdf-wasm/LICENSE")], ["@jsquash/jpeg", nm("@jsquash/jpeg/LICENSE")],
    ["@jsquash/jpeg codec (MozJPEG, IJG, libjpeg-turbo)", nm("@jsquash/jpeg/codec/LICENSE.codec.md")], ["tesseract.js-core (and Tesseract)", nm("tesseract.js-core/LICENSE")],
    ["Tesseract language data (tessdata_best) and Apache-2.0 full text", "licences/Apache-2.0.txt"],
    ["OCR wasm: libpng", "licences/libpng.txt"], ["OCR wasm: libtiff", "licences/libtiff.txt"], ["OCR wasm: zlib", "licences/zlib.txt"],
    ["OCR wasm: libjpeg (Independent JPEG Group)", "licences/libjpeg-ijg.txt"], ["OCR wasm: libwebp", "licences/libwebp.txt"],
    ["OCR wasm: giflib", "licences/giflib.txt"], ["OCR wasm: Leptonica", "licences/leptonica.txt"],
    ["Pixelarticons (tool icons, MIT)", "licences/pixelarticons-mit.txt"],
    ["Fonts: SIL Open Font License 1.1 (Space Grotesk, Inter, Silkscreen, JetBrains Mono, Noto Sans, Caveat, Noto Sans SC/TC/JP/KR)", "src/fonts/OFL.txt"],
  ];
  return {
    name: "mosspdf-licences-txt",
    apply: "build",
    buildStart() {
      const rule = "=".repeat(78), NL = String.fromCharCode(10);
      const text = sources.map(([title, file]) => {
        if (!existsSync(file)) this.error(`licences.txt: missing licence source ${file}`);
        return [rule, title, `(${file})`, rule, "", readFileSync(file, "utf8").trim(), ""].join(NL);
      }).join(NL);
      this.emitFile({ type: "asset", fileName: "licences.txt", source: text });
    },
  };
}

/** Stamps public/sw.js (copied into dist) with the precache list of the finished build and a version derived from it. */
function swPrecache(): Plugin {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return {
    name: "mosspdf-sw-precache",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const dist = "dist";
      const files = walk(dist).map((f) => "/" + relative(dist, f).split("\\").join("/")).filter((f) => f !== "/sw.js" && f !== "/_headers" && f !== "/index.html" && !/^\/assets\/(tesseract-core|notosans(sc-gb2312|tc-big5|jp-jisx0208|kr-hangul)-400-normal|(eng|chi_sim|msa|tam)\.traineddata)-/.test(f)).sort(); // OCR engine and CJK fonts: cached on first use instead (D16, D24)
      const list = ["/", ...files];
      const hash = createHash("sha256").update(JSON.stringify(list)).update(readFileSync(join(dist, "index.html"))).digest("hex").slice(0, 10);
      const sw = readFileSync(join(dist, "sw.js"), "utf8").replace("__PRECACHE__", JSON.stringify(list)).replace("__VERSION__", `${pkg.version}-${hash}`);
      writeFileSync(join(dist, "sw.js"), sw);
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [pdfjsData(), licencesTxt(), swPrecache()],
  build: { assetsInlineLimit: 0 }, // CSP script-src 'self': nothing may be inlined
  worker: {
    format: "es",
    rollupOptions: { output: { entryFileNames: "assets/workers/[name]-[hash].js", chunkFileNames: "assets/workers/[name]-[hash].js", codeSplitting: false } },
  },
  test: { include: ["tests/**/*.test.ts"], globalSetup: ["tests/globalSetup.ts"], testTimeout: 60_000 },
});
