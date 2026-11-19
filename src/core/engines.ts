// Engine registry for the seal: each entry loads its bytes and spawns its workers BEFORE the page is sealed.
import qpdfWasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import jpegDecUrl from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?url";
import jpegEncUrl from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url";
import pdfjsDataUrl from "virtual:pdfjs-data";
import opsWorkerUrl from "../workers/ops.worker.ts?worker&url";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?worker&url";
import type * as PdfJs from "pdfjs-dist/build/pdf.mjs";
import { RpcClient } from "./rpc";
import { fetchBytes, registerEngine } from "./seal";
import { scriptUrl } from "./tt";

export let opsRpc: RpcClient;
export let pdfjs: typeof PdfJs;
export let pdfWorker: PdfJs.PDFWorker;
/** pdf.js binary data (cmaps, standard fonts, wasm), by "<kind>/<filename>". */
export const pdfjsData = new Map<string, Uint8Array>();

registerEngine({
  name: "qpdf",
  async load() {
    // The same worker also needs the MozJPEG codecs (compress); both are fetched here, before the seal.
    const [wasm, jpegDecWasm, jpegEncWasm] = await Promise.all([fetchBytes(qpdfWasmUrl), fetchBytes(jpegDecUrl), fetchBytes(jpegEncUrl)]);
    const worker = new Worker(scriptUrl(opsWorkerUrl), { type: "module" });
    opsRpc = new RpcClient(worker);
    await opsRpc.call("init", { qpdfWasm: wasm, jpegDecWasm, jpegEncWasm }, { transfer: [wasm.buffer as ArrayBuffer, jpegDecWasm.buffer as ArrayBuffer, jpegEncWasm.buffer as ArrayBuffer] });
  },
});

registerEngine({
  name: "pdfjs",
  async load() {
    const [mod, packed] = await Promise.all([import("pdfjs-dist/build/pdf.mjs"), fetchBytes(pdfjsDataUrl)]);
    const hlen = new DataView(packed.buffer, packed.byteOffset).getUint32(0, true);
    const index = JSON.parse(new TextDecoder().decode(packed.subarray(4, 4 + hlen))) as Record<string, [number, number]>;
    for (const [k, [o, l]] of Object.entries(index)) pdfjsData.set(k, packed.subarray(4 + hlen + o, 4 + hlen + o + l));
    pdfjs = mod;
    pdfWorker = new mod.PDFWorker({ port: new Worker(scriptUrl(pdfWorkerUrl), { type: "module" }) } as never);
  },
});

// Offline support. Registered before the seal because the browser fetches sw.js under the page's worker-src.
registerEngine({
  name: "service-worker",
  async load() {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const { watchUpdates } = await import("../ui/sw-update");
    await watchUpdates().catch(() => undefined);
  },
});
