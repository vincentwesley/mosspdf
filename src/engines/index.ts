import type { Engines } from "../ops/types";
import { createQpdf } from "./qpdf";

/** Browser: pass the preloaded wasm bytes. Node: read them from node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm. */
export const createEngines = (wasm: { qpdf: Uint8Array }): Engines => ({ qpdf: createQpdf(wasm.qpdf) });
