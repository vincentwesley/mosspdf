// Ops worker: self-contained bundle (assets/workers/), served with connect-src 'none'. WASM arrives by message.
import { serve, Transfer } from "../core/rpc";
import { addPageNumbers, assemble, compress, imagesToPdf, inspect, merge, readMetadata, split, watermark, writeMetadata } from "../ops";
import type { CompressLevel, ImageInput, ImagesToPdfOptions, MetadataEdit, PageNumberOptions, WatermarkOptions } from "../ops";
import { createEngines } from "../engines";
import type { Engines, InFile, OpOptions, OpResult, PageSpec, SplitMode } from "../ops/types";

let engines: Engines | undefined;
const eng = () => {
  if (!engines) throw new Error("Engines are not ready yet.");
  return engines;
};
const opts = (o: { producerCredit: boolean }, ctx: { signal: AbortSignal; progress: OpOptions["onProgress"] }): OpOptions => ({ producerCredit: o.producerCredit, signal: ctx.signal, onProgress: ctx.progress });
const out = <T extends OpResult | OpResult[]>(r: T) => new Transfer(r, [r].flat().map((x) => x.bytes.buffer as ArrayBuffer));
type O = { producerCredit: boolean };

serve({
  init: async ({ qpdfWasm, jpegDecWasm, jpegEncWasm }: { qpdfWasm: Uint8Array; jpegDecWasm: Uint8Array; jpegEncWasm: Uint8Array }) => {
    engines = await createEngines({ qpdf: qpdfWasm, jpegDec: jpegDecWasm, jpegEnc: jpegEncWasm });
    return true;
  },
  inspect: ({ file }: { file: InFile }) => inspect(file, eng()),
  merge: async ({ files, o }: { files: InFile[]; o: O }, ctx) => out(await merge(files, opts(o, ctx), eng())),
  assemble: async ({ files, pages, name, o }: { files: InFile[]; pages: PageSpec[]; name: string; o: O }, ctx) => out(await assemble(files, pages, name, opts(o, ctx), eng())),
  split: async ({ file, mode, o }: { file: InFile; mode: SplitMode; o: O }, ctx) => out(await split(file, mode, opts(o, ctx), eng())),
  imagesToPdf: async ({ images, options, o }: { images: ImageInput[]; options: ImagesToPdfOptions; o: O }, ctx) => out(await imagesToPdf(images, options, opts(o, ctx))),
  compress: async ({ file, level, o }: { file: InFile; level: CompressLevel; o: O }, ctx) => {
    const r = await compress(file, { level }, opts(o, ctx), eng());
    return new Transfer(r, [r.bytes.buffer as ArrayBuffer]);
  },
  addPageNumbers: async ({ file, options, o }: { file: InFile; options: PageNumberOptions; o: O }, ctx) => out(await addPageNumbers(file, options, opts(o, ctx), eng())),
  watermark: async ({ file, options, o }: { file: InFile; options: WatermarkOptions; o: O }, ctx) => out(await watermark(file, options, opts(o, ctx), eng())),
  readMetadata: ({ file }: { file: InFile }) => readMetadata(file, eng()),
  writeMetadata: async ({ file, edit, o }: { file: InFile; edit: MetadataEdit; o: O }, ctx) => out(await writeMetadata(file, edit, opts(o, ctx), eng())),
});
