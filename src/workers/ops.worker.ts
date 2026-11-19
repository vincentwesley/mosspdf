// Ops worker: self-contained bundle (assets/workers/), served with connect-src 'none'. WASM arrives by message.
import { serve, Transfer } from "../core/rpc";
import { assemble, inspect, merge, split } from "../ops";
import { createEngines } from "../engines";
import type { Engines, InFile, OpOptions, OpResult, PageSpec, SplitMode } from "../ops/types";

let engines: Engines | undefined;
const eng = () => {
  if (!engines) throw new Error("Engines are not ready yet.");
  return engines;
};
const opts = (o: { producerCredit: boolean }, ctx: { signal: AbortSignal; progress: OpOptions["onProgress"] }): OpOptions => ({ producerCredit: o.producerCredit, signal: ctx.signal, onProgress: ctx.progress });
const out = (r: OpResult | OpResult[]) => new Transfer(r, [r].flat().map((x) => x.bytes.buffer as ArrayBuffer));

serve({
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
