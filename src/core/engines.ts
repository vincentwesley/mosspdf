// Engine registry for the seal: each entry loads its bytes and spawns its workers BEFORE the page is sealed.
import qpdfWasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import jpegDecUrl from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?url";
import jpegEncUrl from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url";
import unicodeFontUrl from "../fonts/notosans-unicode-400-normal.ttf?url";
import scFontUrl from "../fonts/notosanssc-gb2312-400-normal.ttf?url";
import tcFontUrl from "../fonts/notosanstc-big5-400-normal.ttf?url";
import jpFontUrl from "../fonts/notosansjp-jisx0208-400-normal.ttf?url";
import krFontUrl from "../fonts/notosanskr-hangul-400-normal.ttf?url";
import ocrWasmUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm?url";
import pdfjsDataUrl from "virtual:pdfjs-data";
import opsWorkerUrl from "../workers/ops.worker.ts?worker&url";
import ocrWorkerUrl from "../workers/ocr.worker.ts?worker&url";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?worker&url";
import type * as PdfJs from "pdfjs-dist/build/pdf.mjs";
import { chosenLangs, routeOf } from "./ocrlangs";
import { cjkLang, type Lang } from "./zhfont";
const CJK_URL: Record<Lang, string> = { sc: scFontUrl, tc: tcFontUrl, jp: jpFontUrl, kr: krFontUrl };
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
    // The same worker also needs the MozJPEG codecs (compress) and the Noto Sans subset for text beyond WinAnsi (D20); both are fetched here, before the seal.
    const [wasm, jpegDecWasm, jpegEncWasm, font] = await Promise.all([fetchBytes(qpdfWasmUrl), fetchBytes(jpegDecUrl), fetchBytes(jpegEncUrl), fetchBytes(unicodeFontUrl)]);
    const lang = cjkLang(), zhFont = lang ? await fetchBytes(CJK_URL[lang]) : undefined; // the one optional CJK font (D24, D30), only when chosen
    const worker = new Worker(scriptUrl(opsWorkerUrl), { type: "module" });
    opsRpc = new RpcClient(worker);
    await opsRpc.call("init", { qpdfWasm: wasm, jpegDecWasm, jpegEncWasm, font, zhFont }, { transfer: [wasm.buffer as ArrayBuffer, jpegDecWasm.buffer as ArrayBuffer, jpegEncWasm.buffer as ArrayBuffer, font.buffer as ArrayBuffer, ...(zhFont ? [zhFont.buffer as ArrayBuffer] : [])] });
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
    const port = new Worker(scriptUrl(pdfWorkerUrl), { type: "module" });
    // Firefox loads a worker's script (and checks worker-src) after `new Worker()` returns. pdf.js posts "ready" as soon as its worker runs;
    // wait for it so the script has been fetched before the seal lands (D14).
    const running = new Promise<void>((ok, fail) => {
      port.addEventListener("message", () => ok(), { once: true });
      port.addEventListener("error", () => fail(new Error("The PDF worker did not start.")), { once: true });
    });
    pdfWorker = new mod.PDFWorker({ port } as never);
    await running;
  },
});

// OCR (D16, D21): the engine (~3 MB) plus the chosen languages (1 to 3 MB each), so only a page that boots on #/ocr loads them, and only
// the languages in the route (or this viewer's last choice). A sealed page cannot start it later (no new worker, no fetch).
// Every installed @tesseract.js-data/<code> package is picked up here; a language only shows once it is also listed in core/ocrlangs.ts.
const LANG_URL: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>("/node_modules/@tesseract.js-data/*/4.0.0_best_int/*.traineddata.gz", { query: "?url", import: "default", eager: true })).map(([k, v]) => [/([^/]+)\.traineddata\.gz$/.exec(k)![1], v]));
export let ocrRpc: RpcClient | undefined;
/** The language codes the loaded OCR engine was started with. */
export let ocrLangs: string[] = [];
// The route the page booted on, read now: the engines load after the tool code has painted (D39), and the user may have moved on by then.
const bootHash = location.hash, bootRoute = routeOf(bootHash);
registerEngine({
  name: "ocr",
  async load() {
    if (bootRoute !== "ocr") return;
    const codes = chosenLangs(bootHash);
    const [wasm, ...gzs] = await Promise.all([fetchBytes(ocrWasmUrl), ...codes.map((c) => fetchBytes(LANG_URL[c]))]);
    const langs = codes.map((code, i) => ({ code, gz: gzs[i] }));
    const rpc = new RpcClient(new Worker(scriptUrl(ocrWorkerUrl), { type: "module" }));
    // Like the ops worker: init only returns once the worker script is running, i.e. before the seal (D14).
    await rpc.call("init", { wasm, langs }, { transfer: [wasm.buffer as ArrayBuffer, ...langs.map((l) => l.gz.buffer as ArrayBuffer)] });
    ocrRpc = rpc;
    ocrLangs = codes;
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
