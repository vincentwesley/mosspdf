// Ops worker: self-contained bundle (assets/workers/), served with connect-src 'none'. WASM arrives by message.
import { serve, Transfer, type Ctx } from "../core/rpc";
import { addPageNumbers, assemble, compress, imagesToPdf, inspect, merge, readMetadata, split, watermark, writeMetadata } from "../ops";
import type { CompressLevel, ImageInput, ImagesToPdfOptions, MetadataEdit, PageNumberOptions, WatermarkOptions } from "../ops";
import { addTextLayer, cleanCopy, protect, repair, safetyScan, unprotect } from "../ops";
import type { OcrPage } from "../ops";
import { compareReport, createForm, editPages, fillForm, readForm, stampPage } from "../ops";
import type { ReportData } from "../core/compare";
import type { CreateFormInput, EditInput, FormValues, StampInput } from "../ops";
import { redact, accessibilityCheck, rotatePages, cropPages, flatten, nupPages, addBlankPages } from "../ops";
import { readOutline, setOutline, extractImages } from "../ops";
import type { ExtractImagesOptions } from "../ops";
import type { BookmarkItem } from "../ops";
import type { RotateOptions, CropOptions, FlattenOptions, NupOptions, AddPagesOptions } from "../ops";
import type { RedactInput } from "../ops";
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

// Edit PDF
const edit = {
  editPages: async ({ file, input, o }: { file: InFile; input: EditInput; o: { producerCredit: boolean } }, ctx: Ctx) => out(await editPages(file, input, opts(o, ctx), eng())),
};

const forms = {
  createForm: async ({ file, input, o }: { file: InFile; input: CreateFormInput; o: { producerCredit: boolean } }, ctx: Ctx) => out(await createForm(file, input, opts(o, ctx), eng())),
};

// M7 (compare)
const m7 = {
  compareReport: async ({ report, o }: { report: ReportData; o: O }, ctx: Ctx) => out(await compareReport(report, opts(o, ctx))),
};

// M6 op (redaction)
const m6 = {
  redact: async ({ file, input, o }: { file: InFile; input: RedactInput; o: { producerCredit: boolean } }, ctx: Ctx) => out(await redact(file, input, opts(o, ctx), eng())),
};

serve({
  accessibilityCheck: ({ file }: { file: InFile }) => accessibilityCheck(file, eng()),
  rotatePages: async ({ file, options, o }: { file: InFile; options: RotateOptions; o: O }, ctx) => out(await rotatePages(file, options, opts(o, ctx), eng())),
  cropPages: async ({ file, options, o }: { file: InFile; options: CropOptions; o: O }, ctx) => out(await cropPages(file, options, opts(o, ctx), eng())),
  flatten: async ({ file, options, o }: { file: InFile; options: FlattenOptions; o: O }, ctx) => out(await flatten(file, options, opts(o, ctx), eng())),
  nupPages: async ({ file, options, o }: { file: InFile; options: NupOptions; o: O }, ctx) => out(await nupPages(file, options, opts(o, ctx), eng())),
  addBlankPages: async ({ file, options, o }: { file: InFile; options: AddPagesOptions; o: O }, ctx) => out(await addBlankPages(file, options, opts(o, ctx), eng())),
  readOutline: ({ file }: { file: InFile }, ctx) => readOutline(file, { signal: ctx.signal }, eng()),
  setOutline: async ({ file, items, o }: { file: InFile; items: BookmarkItem[]; o: O }, ctx) => out(await setOutline(file, { items }, opts(o, ctx), eng())),
  extractImages: async ({ file, options, o }: { file: InFile; options: ExtractImagesOptions; o: O }, ctx) => out(await extractImages(file, options, opts(o, ctx), eng())),
  ...m7,
  ...edit,
  ...forms,
  ...m6,
  ...m4,
  ...m3,
  init: async ({ qpdfWasm, jpegDecWasm, jpegEncWasm, font, zhFont }: { qpdfWasm: Uint8Array; jpegDecWasm: Uint8Array; jpegEncWasm: Uint8Array; font: Uint8Array; zhFont?: Uint8Array }) => {
    engines = await createEngines({ qpdf: qpdfWasm, jpegDec: jpegDecWasm, jpegEnc: jpegEncWasm, font, zhFont });
    return true;
  },
  inspect: ({ file }: { file: InFile }) => inspect(file, eng()),
  merge: async ({ files, o, bookmarks }: { files: InFile[]; o: O; bookmarks?: boolean }, ctx) => out(await merge(files, opts(o, ctx), eng(), { bookmarks })),
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
