// Ops worker: self-contained bundle (assets/workers/), served with connect-src 'none'. WASM arrives by message.
import { serve, Transfer, type Ctx } from "../core/rpc";
import { addPageNumbers, assemble, compress, imagesToPdf, inspect, merge, readMetadata, split, watermark, writeMetadata } from "../ops";
import type { CompressLevel, ImageInput, ImagesToPdfOptions, MetadataEdit, PageNumberOptions, WatermarkOptions } from "../ops";
import { addTextLayer, cleanCopy, protect, repair, safetyScan, unprotect } from "../ops";
import type { OcrPage } from "../ops";
import { fillForm, readForm, stampPage } from "../ops";
import type { FormValues, StampInput } from "../ops";
import type { CleanOptions, ProtectOptions, UnprotectOptions } from "../ops/types-m3";
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

// M3 ops (passwords, safety, repair)
const m3 = {
  protect: async ({ file, p, o }: { file: InFile; p: ProtectOptions; o: { producerCredit: boolean } }, ctx: Ctx) => out(await protect(file, p, opts(o, ctx), eng())),
  unprotect: async ({ file, p, o }: { file: InFile; p: UnprotectOptions; o: { producerCredit: boolean } }, ctx: Ctx) => out(await unprotect(file, p, opts(o, ctx), eng())),
  safetyScan: ({ file }: { file: InFile }) => safetyScan(file, eng()),
  cleanCopy: async ({ file, c, o }: { file: InFile; c: CleanOptions; o: { producerCredit: boolean } }, ctx: Ctx) => out(await cleanCopy(file, c, opts(o, ctx), eng())),
  repair: async ({ file, o }: { file: InFile; o: { producerCredit: boolean } }, ctx: Ctx) => out(await repair(file, opts(o, ctx), eng())),
  addTextLayer: async ({ file, pages, o }: { file: InFile; pages: OcrPage[]; o: { producerCredit: boolean } }, ctx: Ctx) => out(await addTextLayer(file, pages, opts(o, ctx), eng())),
};

// M4 ops (fill forms, sign)
const m4 = {
  readForm: ({ file }: { file: InFile }) => readForm(file, {}, eng()),
  fillForm: async ({ file, values, flatten, o }: { file: InFile; values: FormValues; flatten: boolean; o: { producerCredit: boolean } }, ctx: Ctx) => out(await fillForm(file, values, { flatten }, opts(o, ctx), eng())),
  stampPage: async ({ file, input, o }: { file: InFile; input: StampInput; o: { producerCredit: boolean } }, ctx: Ctx) => out(await stampPage(file, input, opts(o, ctx), eng())),
};

serve({
  ...m4,
  ...m3,
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
