// Opening and inspecting a PDF: error classification, repair fallback and qpdf JSON reading.
import { PDFArray, PDFDocument, PDFName, PDFStream } from "@cantoo/pdf-lib";
import { PdfError, type Bytes, type Engines, type InFile, type Inspection } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- qpdf JSON v2 is untyped */
type J = any;

export interface Opened {
  bytes: Bytes; // possibly repaired
  info: Inspection;
}

export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new PdfError("cancelled", "Cancelled. Nothing was changed.");
}

const hasHeader = (b: Bytes) => new TextDecoder("latin1").decode(b.subarray(0, 1024)).includes("%PDF-");

function pwArgs(f: InFile) {
  return f.password ? [`--password=${f.password}`] : [];
}

/** Maps qpdf stderr to the error a non-technical user can act on. */
export function classify(stderr: string, f: InFile): PdfError {
  if (/invalid password/i.test(stderr)) {
    return f.password
      ? new PdfError("wrong-password", `That password doesn't open "${f.name}". Check it and try again.`, f.name)
      : new PdfError("encrypted", `"${f.name}" is password-protected. Enter its password to continue.`, f.name);
  }
  if (/memory|alloc|enlarge/i.test(stderr)) return new PdfError("too-large", `"${f.name}" is too big to handle in this browser. Try splitting it first or closing other tabs.`, f.name);
  if (/unsupported|not supported/i.test(stderr)) return new PdfError("unsupported", `"${f.name}" uses a feature MossPDF can't handle yet.`, f.name);
  return new PdfError("corrupt", `"${f.name}" looks damaged and couldn't be repaired. Try re-downloading or re-exporting it from the original program.`, f.name);
}

async function tryInspect(bytes: Bytes, f: InFile, e: Engines) {
  const r = await e.qpdf(["--json=2", "--json-key=qpdf", "--json-key=pages", "--json-key=encrypt", ...pwArgs(f), "/f.pdf"], { "/f.pdf": bytes });
  if (r.code >= 2 && !r.stdout.startsWith("{")) return { err: r.stderr };
  try {
    return { json: JSON.parse(r.stdout) as J, warned: r.code === 3 && /damaged|reconstruct/i.test(r.stderr) };
  } catch {
    return { err: r.stderr || "unreadable" };
  }
}

/** pdf-lib is lenient where this qpdf build can't rebuild a broken xref: load + save writes a fresh one. */
async function repair(bytes: Bytes, f: InFile): Promise<Bytes> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    // A cut-off stream leaves a non-stream in /Contents; drop it so the page is simply blank.
    for (const page of doc.getPages()) {
      const c = page.node.get(PDFName.of("Contents"));
      const items = (c instanceof PDFArray ? c.asArray() : c ? [c] : []).filter((x) => doc.context.lookup(x) instanceof PDFStream);
      page.node.set(PDFName.of("Contents"), doc.context.obj(items));
    }
    return await doc.save({ useObjectStreams: false });
  } catch {
    throw classify("damaged", f);
  }
}

export async function openPdf(f: InFile, e: Engines, signal?: AbortSignal): Promise<Opened> {
  if (f.bytes.length === 0) throw new PdfError("empty", `"${f.name}" is empty (0 bytes). Pick the right file and try again.`, f.name);
  if (!hasHeader(f.bytes)) throw new PdfError("not-pdf", `"${f.name}" isn't a PDF, even though its name says so. Open the original file, or re-save it as a PDF.`, f.name);
  checkAbort(signal);
  let bytes = f.bytes;
  let a = await tryInspect(bytes, f, e);
  let repaired = false;
  if ("err" in a && !/invalid password|memory|alloc/i.test(a.err!)) {
    bytes = await repair(f.bytes, f);
    repaired = true;
    a = await tryInspect(bytes, f, e);
  }
  if ("err" in a) throw classify(a.err!, f);
  return { bytes, info: readInfo(a.json, repaired || !!a.warned) };
}

export async function inspect(f: InFile, e: Engines): Promise<Inspection> {
  try {
    return (await openPdf(f, e)).info;
  } catch (err) {
    if (err instanceof PdfError && err.code === "encrypted") {
      return { pageCount: 0, encrypted: true, needsPassword: true, hasForms: false, hasXfa: false, hasSignatures: false, hasOutline: false, hasJavaScript: false, pageSizes: [], repaired: false };
    }
    throw err;
  }
}

function readInfo(j: J, repaired: boolean): Inspection {
  const objs: J = j.qpdf[1];
  const get = (ref: string): J => {
    const o = objs[`obj:${ref}`];
    return o?.value ?? o?.stream?.dict ?? {};
  };
  const root = get(objs.trailer.value["/Root"]);
  const acro = typeof root["/AcroForm"] === "string" ? get(root["/AcroForm"]) : (root["/AcroForm"] ?? {});
  let hasSignatures = false;
  let hasJavaScript = false;
  for (const k in objs) {
    const d = objs[k]?.value ?? objs[k]?.stream?.dict;
    if (!d || typeof d !== "object") continue;
    if (d["/FT"] === "/Sig") hasSignatures = true;
    if (d["/S"] === "/JavaScript" || d["/JS"] !== undefined) hasJavaScript = true;
  }
  const inherited = (page: J, key: string): J => {
    for (let d = page, i = 0; d && i < 64; i++) {
      if (d[key] !== undefined) return typeof d[key] === "string" && /^\d+ 0 R$/.test(d[key]) ? get(d[key]) : d[key];
      d = d["/Parent"] ? get(d["/Parent"]) : undefined;
    }
    return undefined;
  };
  const pageSizes = (j.pages as J[]).map((p) => {
    const page = get(p.object);
    const box = (inherited(page, "/MediaBox") as number[] | undefined)?.map((n) => (typeof n === "number" ? n : 0)) ?? [0, 0, 612, 792];
    const rot = Number(inherited(page, "/Rotate") ?? 0);
    return { w: Math.abs(box[2] - box[0]), h: Math.abs(box[3] - box[1]), rotate: ((rot % 360) + 360) % 360 };
  });
  const infoRef = objs.trailer.value["/Info"];
  const t = infoRef ? get(infoRef)["/Title"] : undefined;
  return {
    pageCount: pageSizes.length,
    encrypted: !!j.encrypt?.encrypted,
    needsPassword: false,
    hasForms: acro["/Fields"] !== undefined && (typeof acro["/Fields"] !== "object" || acro["/Fields"].length > 0),
    hasXfa: acro["/XFA"] !== undefined,
    hasSignatures,
    hasOutline: root["/Outlines"] !== undefined,
    hasJavaScript: hasJavaScript || (root["/OpenAction"] !== undefined && JSON.stringify(root["/OpenAction"]).includes("JavaScript")),
    pageSizes,
    title: typeof t === "string" && t.startsWith("u:") && t.length > 2 ? t.slice(2) : undefined,
    repaired,
  };
}
