/* eslint-disable @typescript-eslint/no-unused-vars */
// TEMPORARY stub on @cantoo/pdf-lib so the UI runs; the m1-ops merge replaces this file.
// At merge: `createEngines`/`Engines` come from ../engines/qpdf (update the import in src/workers/ops.worker.ts).
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { PdfError, type InFile, type Inspection, type OpOptions, type OpResult, type PageSpec, type SplitMode } from "./types";

export type Engines = { qpdf: unknown };
export function createEngines(_o: { qpdfWasm: Uint8Array }): Engines {
  return { qpdf: _o };
}

const load = (f: InFile) =>
  PDFDocument.load(f.bytes, { ignoreEncryption: true, updateMetadata: false }).catch(() => {
    throw new PdfError("corrupt", "This file could not be read as a PDF.", f.name);
  });

export async function inspect(f: InFile, _e: Engines): Promise<Inspection> {
  if (!f.bytes.length) throw new PdfError("empty", "This file is empty.", f.name);
  const d = await load(f);
  const pages = d.getPages();
  return {
    pageCount: pages.length, encrypted: false, needsPassword: false, hasForms: false, hasXfa: false, hasSignatures: false,
    hasOutline: false, hasJavaScript: false, repaired: false,
    pageSizes: pages.map((p) => ({ w: p.getWidth(), h: p.getHeight(), rotate: p.getRotation().angle })),
  };
}

export async function assemble(files: InFile[], pages: PageSpec[], name: string, o: OpOptions, _e: Engines): Promise<OpResult> {
  const out = await PDFDocument.create();
  const docs = await Promise.all(files.map(load));
  for (const [i, p] of pages.entries()) {
    const [pg] = await out.copyPages(docs[p.source], [p.page - 1]);
    pg.setRotation(degrees((pg.getRotation().angle + p.rotate) % 360));
    out.addPage(pg);
    o.onProgress?.(i + 1, pages.length);
  }
  if (o.producerCredit) out.setProducer("Pagehold by Vin's Atelier");
  return { bytes: await out.save(), name, warnings: [] };
}

export async function merge(files: InFile[], o: OpOptions, e: Engines): Promise<OpResult> {
  const infos = await Promise.all(files.map((f) => load(f).then((d) => d.getPageCount())));
  const pages: PageSpec[] = infos.flatMap((n, source) => Array.from({ length: n }, (_, i) => ({ source, page: i + 1, rotate: 0 as const })));
  return assemble(files, pages, "merged.pdf", o, e);
}

export async function split(f: InFile, mode: SplitMode, o: OpOptions, e: Engines): Promise<OpResult[]> {
  const n = (await inspect(f, e)).pageCount;
  const groups = mode.kind === "ranges" ? mode.ranges
    : mode.kind === "every" ? Array.from({ length: Math.ceil(n / mode.n) }, (_, i) => range(i * mode.n + 1, Math.min(n, (i + 1) * mode.n)))
    : [range(1, n)];
  const base = f.name.replace(/\.pdf$/i, "");
  return Promise.all(groups.map((g, i) => assemble([f], g.map((p) => ({ source: 0, page: p, rotate: 0 as const })), `${base}-part-${i + 1}.pdf`, o, e)));
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** "1-3, 5, 8-" -> [[1,2,3],[5],[8..n]]. Throws Error with a plain message. */
export function parseRanges(input: string, pageCount: number): number[][] {
  const parts = input.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error("Type the pages you want, for example 1-3, 5.");
  return parts.map((p) => {
    const m = /^(\d*)(?:-(\d*))?$/.exec(p);
    if (!m || (!m[1] && !m[2])) throw new Error(`"${p}" is not a page or range.`);
    const a = m[1] ? +m[1] : 1;
    const b = m[2] === undefined ? a : m[2] ? +m[2] : pageCount;
    if (a < 1 || b > pageCount || a > b) throw new Error(`"${p}" is outside pages 1-${pageCount}.`);
    return range(a, b);
  });
}
