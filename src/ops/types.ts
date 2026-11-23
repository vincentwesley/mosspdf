// Shared contract for page operations. Isomorphic: no DOM, runs in Node tests and in a browser Worker.
import type { Jpeg } from "../engines/jpeg";
import type { Qpdf } from "../engines/qpdf";

export type Bytes = Uint8Array;
/** Engines are injected so the browser can pass preloaded wasm bytes and Node can read them from node_modules. */
export interface Engines {
  qpdf: Qpdf;
  jpeg: Jpeg;
}
export interface InFile {
  name: string;
  bytes: Bytes;
  password?: string;
}
export interface OpOptions {
  producerCredit: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}
export type Warning = { code: "outline-dropped" | "signature-invalidated" | "repaired" | "forms-renamed" | "links-dropped" | "oversize" | string; message: string };
export interface OpResult {
  bytes: Bytes;
  name: string;
  warnings: Warning[];
}
export type PdfErrorCode = "not-pdf" | "empty" | "corrupt" | "encrypted" | "wrong-password" | "unsupported" | "too-large" | "cancelled";
export class PdfError extends Error {
  constructor(
    public code: PdfErrorCode,
    message: string,
    public fileName?: string,
  ) {
    super(message);
    this.name = "PdfError";
  }
}
export interface PageSpec {
  source: number; // index into files
  page: number; // 0-based
  rotate: 0 | 90 | 180 | 270; // added rotation
}
export interface Inspection {
  pageCount: number;
  encrypted: boolean;
  needsPassword: boolean;
  hasForms: boolean;
  hasXfa: boolean;
  hasSignatures: boolean;
  hasOutline: boolean;
  hasJavaScript: boolean;
  pageSizes: { w: number; h: number; rotate: number }[];
  title?: string;
  repaired: boolean;
}
export type SplitMode = { kind: "ranges"; ranges: string } | { kind: "every"; n: number } | { kind: "size"; maxBytes: number } | { kind: "bookmarks" };
