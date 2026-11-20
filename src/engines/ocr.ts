// OCR: Tesseract (LSTM, English) driven directly through tesseract.js-core, not through the tesseract.js worker wrapper.
// Isomorphic like the other engines: the caller passes the .wasm and the gzipped language data as bytes, nothing is fetched.
import TesseractCore from "tesseract.js-core/tesseract-core-simd-lstm.js";
import type { Bytes } from "./jpeg";

export interface OcrWord {
  text: string;
  conf: number; // 0..100
  /** Pixel box in the image, origin top-left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Last word of its text line / paragraph. */
  eol: boolean;
  eop: boolean;
}
export interface Ocr {
  /** An encoded PNG/BMP/JPEG page image in, its words out in reading order. */
  recognize(image: Bytes): OcrWord[];
}

// Not Blob.stream(): WebKit loads that through a blob: URL, which the post-seal request check treats as a request.
async function gunzip(b: Bytes): Promise<Bytes> {
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b; // a server that already decoded it for us
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  void w.write(b as BufferSource).then(() => w.close(), () => undefined); // a bad stream rejects the read below
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

const WORD = 3; // RIL_WORD
const LINE = 2; // RIL_TEXTLINE
const PARA = 1; // RIL_PARA

export async function createOcr(wasm: Bytes, langGz: Bytes): Promise<Ocr> {
  const core = await TesseractCore({ wasmBinary: wasm, print() {}, printErr() {} });
  core.FS.writeFile("/eng.traineddata", await gunzip(langGz));
  const api = new core.TessBaseAPI();
  if (api.Init(null, "eng", 1) !== 0) throw new Error("The OCR language data could not be loaded.");
  return {
    recognize(image) {
      core.FS.writeFile("/input", image);
      try {
        if (api.SetImageFile(1, 0) !== 0 || api.Recognize(null) !== 0) throw new Error("This page could not be read.");
        const words: OcrWord[] = [];
        const it = api.GetIterator();
        // The iterator is null when the page has no text at all.
        if (!it || (it as unknown) === 0 || it.Empty?.(WORD)) return words;
        do {
          const text = it.GetUTF8Text(WORD)?.trim();
          if (!text) continue;
          const b = it.getBoundingBox(WORD);
          words.push({ text, conf: it.Confidence(WORD), x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, eol: !!it.IsAtFinalElement(LINE, WORD), eop: !!it.IsAtFinalElement(PARA, WORD) });
        } while (it.Next(WORD));
        return words;
      } finally {
        api.Clear();
        core.FS.unlink("/input");
      }
    },
  };
}
