/* global window, document, performance, PerformanceObserver, setInterval, setTimeout */
// Browser perf probe (headless Chromium): open + organize/merge/compress/edit/remove-blank on a ~100 MB 500-page image PDF and a 1000-page text PDF.
// Usage: PH_PORT=4873 node scripts/perf-browser.mjs [scenario-substring]   (needs `npm run build` first; PH_PERF_DIR keeps the fixtures between runs)
// Prints a markdown table: time to file meta, first thumbnail/page, longest main-thread task, total long-task time, peak JS heap (main thread only), op time.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { randomFillSync } from "node:crypto";
import { PDFDocument } from "@cantoo/pdf-lib";
import { chromium } from "@playwright/test";

const PORT = Number(process.env.PH_PORT ?? 4873);
const dir = process.env.PH_PERF_DIR ?? join(tmpdir(), "mosspdf-perf-browser");
mkdirSync(dir, { recursive: true });
const only = process.argv[2] ?? "";
const budgets = JSON.parse(readFileSync("tests/perf.budgets.json", "utf8"))["A-PERF-1"]; // per scenario: metaMs, firstMs, opMs, longTaskMs, heapMB; any miss exits 1

/** 500 pages cycling over 33 distinct 1000x1000 RGB noise images: ~100 MB, worst case for compress. */
async function bigImagePdf(file) {
  const doc = await PDFDocument.create();
  const refs = [];
  for (let i = 0; i < 33; i++) {
    const raw = Buffer.alloc(1000 * 1000 * 3);
    randomFillSync(raw);
    refs.push(doc.context.register(doc.context.stream(deflateSync(raw, { level: 1 }), { Type: "XObject", Subtype: "Image", Width: 1000, Height: 1000, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode" })));
  }
  for (let i = 0; i < 500; i++) {
    const page = doc.addPage([600, 600]);
    const name = page.node.newXObject("Im", refs[i % refs.length]);
    page.node.addContentStream(doc.context.register(doc.context.stream(`q 600 0 0 600 0 0 cm /${name.decodeText()} Do Q`)));
  }
  writeFileSync(file, await doc.save({ useObjectStreams: false }));
}
const big = join(dir, "big-500p-100mb.pdf");
if (!existsSync(big)) await bigImagePdf(big);
const text = resolve("tests/corpus/generated/text-1000p.pdf");

const probe = () => {
  const w = window;
  w.__m = { long: 0, longTotal: 0, heap: 0, t0: performance.now() };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { w.__m.long = Math.max(w.__m.long, e.duration); w.__m.longTotal += e.duration; } }).observe({ entryTypes: ["longtask"] });
  setInterval(() => { w.__m.heap = Math.max(w.__m.heap, performance.memory?.usedJSHeapSize ?? 0); }, 100);
};

const scenarios = [
  { id: "organize1000", name: "open organize, 1000-page text", route: "organize", files: [text], first: ".pg.is-drawn" },
  { id: "organize100mb", name: "open organize, 500-page 100 MB", route: "organize", files: [big], first: ".pg.is-drawn" },
  { id: "merge100mb", name: "merge, 100 MB + 1000-page text", route: "merge", files: [big, text], run: true },
  { id: "compress100mb", name: "compress, 100 MB", route: "compress", files: [big], run: true },
  { id: "edit100mb", name: "edit, open 100 MB", route: "edit", files: [big], first: ".vw__page.is-drawn" },
  { id: "removeBlank500", name: "remove-blank, scan 500 pages", route: "remove-blank", files: [big], run: true },
];

const server = spawn(process.execPath, ["serve.mjs", "--port", String(PORT)], { cwd: "dist", stdio: "ignore" });
copyFileSync("scripts/serve.mjs", "dist/serve.mjs");
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const rows = [];
try {
  for (const s of scenarios.filter((x) => x.name.includes(only))) {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.addInitScript(probe);
    await page.goto(`http://127.0.0.1:${PORT}/#/${s.route}`);
    await page.waitForFunction(() => window.__phSealed === true || document.querySelector('[data-testid="file-input"]'), undefined, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await page.getByTestId("file-input").setInputFiles(s.files);
    const row = { name: s.name };
    const since = () => Date.now() - t0;
    try {
      await page.locator('[data-testid="file-meta"]').first().waitFor({ timeout: 300_000 });
      row.meta = since();
      if (s.first) { await page.locator(s.first).first().waitFor({ timeout: 300_000 }); row.first = since(); }
      if (s.route === "remove-blank") { // the scan starts on load: time it
        await page.waitForFunction(() => /will be removed|No blank pages|Every page looks blank|could not be checked/.test(document.body.innerText), undefined, { timeout: 900_000 });
        row.op = since() - row.meta;
      } else if (s.run) {
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid="file-row"][data-status="ready"]').length >= n, s.files.length, { timeout: 300_000 });
        await page.waitForFunction(() => !document.querySelector('[data-testid="primary-action"]')?.disabled, undefined, { timeout: 300_000 });
        const t1 = Date.now();
        await page.getByTestId("primary-action").click();
        await page.locator('[data-testid="result-row"], [data-testid="job-error"]:not(:empty), [data-testid="mem-warning"]:not([hidden])').first().waitFor({ timeout: 900_000 });
        row.op = Date.now() - t1;
        row.err = (await page.getByTestId("job-error").textContent())?.slice(0, 80) || (await page.getByTestId("mem-warning").isVisible() ? "mem-warning shown" : "");
      }
    } catch (e) { row.err = String(e.message).split("\n")[0]; }
    const m = await page.evaluate(() => window.__m);
    const b = budgets[s.id] ?? {};
    const over = [["meta", row.meta, b.metaMs], ["first", row.first, b.firstMs], ["op", row.op, b.opMs], ["longTask", m.long, b.longTaskMs], ["heap", m.heap / 1048576, b.heapMB]].filter(([, v, max]) => max && v > max).map(([k, v, max]) => `${k} ${Math.round(v)} > ${max}`);
    if (over.length) row.err = `OVER BUDGET: ${over.join(", ")}`;
    if (!row.meta) row.err ||= "no file meta";
    Object.assign(row, { long: Math.round(m.long), longTotal: Math.round(m.longTotal), heapMB: Math.round(m.heap / 1048576) });
    rows.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log("\n| Scenario | file meta (ms) | first page (ms) | op (ms) | longest task (ms) | long-task total (ms) | main heap peak (MB) | note |\n|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.name} | ${r.meta ?? ""} | ${r.first ?? ""} | ${r.op ?? ""} | ${r.long} | ${r.longTotal} | ${r.heapMB} | ${r.err ?? ""} |`);
