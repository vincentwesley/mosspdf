// Narrow perf: scan + repair on the ~200 MB noise file. PH_PERF=1 npx vitest run tests/perf.scan.test.ts
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomFillSync } from "node:crypto";
import { Worker } from "node:worker_threads";
import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, it } from "vitest";
import { repair, safetyScan } from "../src/ops";
import { engines, opts } from "./helpers/env";

const run = process.env.PH_PERF === "1";
const mb = (n: number) => Math.round(n / 1048576);
function sampler() {
  const peak = new Float64Array(new SharedArrayBuffer(8));
  const w = new Worker(`const {workerData:p}=require("worker_threads");setInterval(()=>{const r=process.memoryUsage.rss();if(r>p[0])p[0]=r},10)`, { eval: true, workerData: peak });
  return async () => { peak[0] = Math.max(peak[0], process.memoryUsage.rss()); await w.terminate(); return peak[0]; };
}
describe.skipIf(!run)("scan/repair memory", () => {
  it("measures", async () => {
    const f = join(process.env.PH_PERF_DIR ?? tmpdir(), "ph-scan-big.pdf");
    if (!existsSync(f)) {
      const doc = await PDFDocument.create();
      const raw = new Uint8Array(1300 * 1300 * 3);
      for (let i = 0; i < 40; i++) {
        randomFillSync(raw);
        const s = doc.context.flateStream(raw, { Type: "XObject", Subtype: "Image", Width: 1300, Height: 1300, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });
        const p = doc.addPage([612, 792]);
        const n = p.node.newXObject("Im0", doc.context.register(s));
        p.node.addContentStream(doc.context.register(doc.context.stream(`q 612 0 0 792 0 0 cm /${n.decodeText()} Do Q`)));
      }
      writeFileSync(f, await doc.save({ useObjectStreams: false }));
    }
    const b = { name: "big.pdf", bytes: new Uint8Array(readFileSync(f)) };
    for (const [name, fn] of ([["scan", () => safetyScan(b, engines)], ["repair", () => repair(b, opts(), engines)]] as const).filter(([n]) => !process.env.PH_ONLY || n === process.env.PH_ONLY)) {
      global.gc?.();
      const base = process.memoryUsage.rss();
      const stop = sampler();
      const t = performance.now();
      await fn();
      const ms = Math.round(performance.now() - t);
      const peak = await stop();
      console.log(`RESULT ${name} ${mb(b.bytes.length)}MB in, base ${mb(base)}, peak ${mb(peak)}, delta ${mb(peak - base)} MB, ${ms} ms`);
    }
  }, 900_000);
});
