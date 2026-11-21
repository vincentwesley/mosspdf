import { setUnicodeFont } from "../ops/ufont";
import type { Engines } from "../ops/types";
import { createJpeg } from "./jpeg";
import { createQpdf } from "./qpdf";

/** Browser: pass the preloaded wasm bytes. Node: read them from node_modules (see tests/helpers/env.ts). */
export const createEngines = async (wasm: { qpdf: Uint8Array; jpegDec: Uint8Array; jpegEnc: Uint8Array; font?: Uint8Array }): Promise<Engines> => {
  setUnicodeFont(wasm.font);
  return {
  qpdf: createQpdf(wasm.qpdf),
  jpeg: await createJpeg({ dec: wasm.jpegDec, enc: wasm.jpegEnc }),
  };
};
