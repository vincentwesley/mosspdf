import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createEngines } from "../../src/engines";
import type { InFile, OpOptions } from "../../src/ops/types";

export const engines = createEngines({ qpdf: readFileSync(createRequire(import.meta.url).resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm")) });
export const opts = (o: Partial<OpOptions> = {}): OpOptions => ({ producerCredit: true, ...o });

export const corpus = (name: string, extra: Partial<InFile> = {}): InFile => ({
  name: `${name}.pdf`,
  bytes: new Uint8Array(readFileSync(new URL(`../corpus/generated/${name}.pdf`, import.meta.url))),
  ...extra,
});
