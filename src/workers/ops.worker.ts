// Ops worker: self-contained bundle (assets/workers/), served with connect-src 'none'. WASM arrives by message.
import { serve, Transfer, type Ctx } from "../core/rpc";
import { assemble, inspect, merge, split } from "../ops";
import { cleanCopy, protect, repair, safetyScan, unprotect } from "../ops";
import type { CleanOptions, ProtectOptions, UnprotectOptions } from "../ops/types-m3";
import { createEngines } from "../engines";
import type { Engines, InFile, OpOptions, OpResult, PageSpec, SplitMode } from "../ops/types";

let engines: Engines | undefined;
const eng = () => {
  if (!engines) throw new Error("Engines are not ready yet.");
  return engines;
};
const opts = (o: { producerCredit: boolean }, ctx: { signal: AbortSignal; progress: OpOptions["onProgress"] }): OpOptions => ({ producerCredit: o.producerCredit, signal: ctx.signal, onProgress: ctx.progress });
const out = (r: OpResult | OpResult[]) => new Transfer(r, [r].flat().map((x) => x.bytes.buffer as ArrayBuffer));

// M3 ops (passwords, safety, repair)
const m3 = {
  protect: async ({ file, p, o }: { file: InFile; p: ProtectOptions; o: { producerCredit: boolean } }, ctx: Ctx) => out(await protect(file, p, opts(o, ctx), eng())),
  unprotect: async ({ file, p, o }: { file: InFile; p: UnprotectOptions; o: { producerCredit: boolean } }, ctx: Ctx) => out(await unprotect(file, p, opts(o, ctx), eng())),
  safetyScan: ({ file }: { file: InFile }) => safetyScan(file, eng()),
  cleanCopy: async ({ file, c, o }: { file: InFile; c: CleanOptions; o: { producerCredit: boolean } }, ctx: Ctx) => out(await cleanCopy(file, c, opts(o, ctx), eng())),
  repair: async ({ file, o }: { file: InFile; o: { producerCredit: boolean } }, ctx: Ctx) => out(await repair(file, opts(o, ctx), eng())),
};

serve({
  ...m3,
  init: async ({ qpdfWasm }: { qpdfWasm: Uint8Array }) => {
    engines = await createEngines({ qpdf: qpdfWasm });
    return true;
  },
  inspect: ({ file }: { file: InFile }) => inspect(file, eng()),
  merge: async ({ files, o }: { files: InFile[]; o: { producerCredit: boolean } }, ctx) => out(await merge(files, opts(o, ctx), eng())),
  assemble: async ({ files, pages, name, o }: { files: InFile[]; pages: PageSpec[]; name: string; o: { producerCredit: boolean } }, ctx) =>
    out(await assemble(files, pages, name, opts(o, ctx), eng())),
  split: async ({ file, mode, o }: { file: InFile; mode: SplitMode; o: { producerCredit: boolean } }, ctx) => out(await split(file, mode, opts(o, ctx), eng())),
});
