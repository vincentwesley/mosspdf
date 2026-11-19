// TEMPORARY stub: the m1-ops merge replaces this file with the real contract.
export type Bytes = Uint8Array;
export interface InFile { name: string; bytes: Bytes; password?: string }
export interface OpOptions { producerCredit: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
export interface OpResult { bytes: Bytes; name: string; warnings: { code: string; message: string }[] }
export type PdfErrorCode = "not-pdf" | "empty" | "corrupt" | "encrypted" | "wrong-password" | "unsupported" | "too-large" | "cancelled";
export class PdfError extends Error {
  constructor(public code: PdfErrorCode, message: string, public fileName?: string) {
    super(message);
    this.name = "PdfError";
  }
}
export interface PageSpec { source: number; page: number; rotate: 0 | 90 | 180 | 270 }
export interface Inspection {
  pageCount: number; encrypted: boolean; needsPassword: boolean; hasForms: boolean; hasXfa: boolean;
  hasSignatures: boolean; hasOutline: boolean; hasJavaScript: boolean;
  pageSizes: { w: number; h: number; rotate: number }[]; title?: string; repaired: boolean;
}
// ASSUMED shape (UI side): m1-ops may name these differently; adjust the call in src/workers/ops.worker.ts.
export type SplitMode =
  | { kind: "ranges"; ranges: number[][] }
  | { kind: "every"; n: number }
  | { kind: "size"; maxBytes: number };
