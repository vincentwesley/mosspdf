import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createEngines } from "../../src/engines";
import type { InFile, OpOptions } from "../../src/ops/types";

const req = createRequire(import.meta.url);
const wasm = (p: string) => readFileSync(req.resolve(p));
export const engines = await createEngines({
  qpdf: wasm("@neslinesli93/qpdf-wasm/dist/qpdf.wasm"),
  jpegDec: wasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"),
  jpegEnc: wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"),
});
export const opts = (o: Partial<OpOptions> = {}): OpOptions => ({ producerCredit: true, ...o });

export const corpus = (name: string, extra: Partial<InFile> = {}): InFile => ({
  name: `${name}.pdf`,
  bytes: new Uint8Array(readFileSync(new URL(`../corpus/generated/${name}.pdf`, import.meta.url))),
  ...extra,
});
