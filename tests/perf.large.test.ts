// Large-file perf check. Skipped unless PH_PERF=1:  PH_PERF=1 npx vitest run tests/perf.large.test.ts
// Writes docs/PERF.raw.json (delete after copying numbers into docs/PERF.md).
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomFillSync } from "node:crypto";
import { Worker } from "node:worker_threads";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, afterAll } from "vitest";
import { addPageNumbers, compress, merge, repair, safetyScan, split } from "../src/ops";
import { assemble } from "../src/ops/assemble";
import { engines, opts } from "./helpers/env";
import type { InFile } from "../src/ops/types";

const run = process.env.PH_PERF === "1";
const dir = run ? mkdtempSync(join(tmpdir(), "pagehold-perf-")) : "";
const rows: { op: string; input: string; ms: number; rssMB: number; ok: boolean; note: string }[] = [];
const mb = (n: number) => Math.round(n / 1048576);

/** Samples process RSS from a worker thread so it keeps ticking while wasm blocks the main thread. */
function sampler() {
  const sab = new SharedArrayBuffer(8);
  const peak = new Float64Array(sab);
  const w = new Worker(`const {workerData:p}=require("worker_threads");setInterval(()=>{const r=process.memoryUsage.rss();if(r>p[0])p[0]=r},20)`, { eval: true, workerData: peak });
  peak[0] = process.memoryUsage.rss();
  return async () => { peak[0] = Math.max(peak[0], process.memoryUsage.rss()); await w.terminate(); return peak[0]; };
}

async function measure<T>(op: string, input: string, fn: () => Promise<T>, note: (r: T) => string = () => "", limitMs = 30_000): Promise<T> {
  global.gc?.();
  const stop = sampler();
  const t = performance.now();
  let r!: T;
  let ok = true;
  let n: string;
  try { r = await fn(); n = note(r); } catch (e) { ok = false; n = `FAILED: ${(e as Error).message}`; }
  const ms = Math.round(performance.now() - t);
  const rss = await stop();
  rows.push({ op, input, ms, rssMB: mb(rss), ok: ok && ms < limitMs && rss < 2 * 1024 ** 3, note: n });
  return r;
}

const bytesOf = (name: string): InFile => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) });

async function textPdf(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    for (let l = 0; l < 40; l++) p.drawText(`Page ${i + 1} line ${l + 1}: the quick brown fox jumps over the lazy dog`, { x: 50, y: 750 - l * 18, size: 11, font });
  }
  return doc.save();
}

async function noisePdf(pages: number, side: number) {
  const doc = await PDFDocument.create();
  const raw = new Uint8Array(side * side * 3);
  for (let i = 0; i < pages; i++) {
    randomFillSync(raw);
    // Stored uncompressed would be trivially big; Flate on noise stays ~100% so size is the same either way.
    const stream = doc.context.flateStream(raw, { Type: "XObject", Subtype: "Image", Width: side, Height: side, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });
    const page = doc.addPage([612, 792]);
    const name = page.node.newXObject("Im0", doc.context.register(stream));
    page.node.addContentStream(doc.context.register(doc.context.stream(`q 612 0 0 792 0 0 cm /${name.decodeText()} Do Q`)));
  }
  return doc.save({ useObjectStreams: false });
}

describe.skipIf(!run)("large-file perf (PH_PERF=1)", () => {
  afterAll(() => {
    if (!run) return;
    writeFileSync(new URL("../docs/PERF.raw.json", import.meta.url), JSON.stringify(rows, null, 1));
    rmSync(dir, { recursive: true, force: true });
    console.table(rows);
  });

  it("generates inputs", async () => {
    writeFileSync(join(dir, "text500.pdf"), await textPdf(500));
    writeFileSync(join(dir, "big.pdf"), await noisePdf(40, 1300)); // 1300x1300x3 = 5 MB/page, ~200 MB total
    console.log("text500", mb(statSync(join(dir, "text500.pdf")).size), "MB; big", mb(statSync(join(dir, "big.pdf")).size), "MB");
  }, 600_000);

  it("ops", async () => {
    const a = bytesOf("text500.pdf");
    const b = bytesOf("big.pdf");
    const sz = (x: InFile) => `${mb(x.bytes.length)} MB`;
    const A = `500p text (${sz(a)})`;
    const B = `40p noise (${sz(b)})`;

    await measure("merge", `${A} x2`, () => merge([a, a], opts(), engines), (r) => `${mb(r.bytes.length)} MB out`);
    await measure("split every 50", A, () => split(a, { kind: "every", n: 50 }, opts(), engines), (r) => `${r.length} files`);
    await measure("organize/extract pages 100-300", A, () => assemble([a], Array.from({ length: 201 }, (_, i) => ({ source: 0, page: 99 + i, rotate: 0 as const })), "x.pdf", opts(), engines), (r) => `${mb(r.bytes.length)} MB out`);
    await measure("page numbers", A, () => addPageNumbers(a, { position: "bottom-center", format: "{n} of {total}" }, opts(), engines), (r) => `${mb(r.bytes.length)} MB out`);
    await measure("pdf.js text extraction (all pages)", A, async () => {
      const task = pdfjs.getDocument({ data: a.bytes.slice(), useSystemFonts: true } as never);
      const doc = await task.promise;
      let chars = 0;
      for (let i = 1; i <= doc.numPages; i++) chars += (await (await doc.getPage(i)).getTextContent()).items.length;
      await task.destroy();
      return chars;
    }, (c) => `${c} text items`);
    await measure("compress balanced", B, () => compress(b, { level: "balanced" }, opts(), engines), (r) => `${mb(r.bytes.length)} MB out`);
    await measure("repair (qpdf rewrite)", B, () => repair(b, opts(), engines), (r) => `${mb(r.bytes.length)} MB out`);
    await measure("safety scan", B, () => safetyScan(b, engines), (r) => `${(r as { findings?: unknown[] }).findings?.length ?? "?"} findings`);
    expect(rows.filter((r) => r.note.startsWith("FAILED"))).toEqual([]);
  }, 1_800_000);
});
