// OCR worker: a self-contained bundle (the Tesseract glue is compiled into it, so no importScripts or eval happens after the seal).
// Created before the seal, only when the page boots on #/ocr (D16). The .wasm and language data arrive by message.
import { serve } from "../core/rpc";
import { createOcr, type Ocr } from "../engines/ocr";

let ocr: Ocr | undefined;
// Cancel is cooperative: one page is a single synchronous wasm call, so the caller checks its abort flag between pages. The worker is never terminated (a new one could not be created after the seal).
serve({
  init: async ({ wasm, langs }: { wasm: Uint8Array; langs: { code: string; gz: Uint8Array }[] }) => {
    ocr = await createOcr(wasm, langs);
    return true;
  },
  page: ({ image }: { image: Uint8Array }) => {
    if (!ocr) throw new Error("The OCR engine is not ready yet.");
    return ocr.recognize(image);
  },
});
