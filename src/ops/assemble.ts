// Page assembly (merge, split, extract, reorder, rotate, delete) via qpdf `--empty --pages`, then a pdf-lib metadata pass. See D10.
import { PDFDocument } from "@cantoo/pdf-lib";
import { prepare } from "./common";
import { checkAbort, classify, openPdf, type Opened } from "./open";
import { readOutlineItems, writeOutlineItems, type BookmarkItem } from "./outline";
import { parseRanges } from "./ranges";
import { PdfError, type Bytes, type Engines, type InFile, type OpOptions, type OpResult, type PageSpec, type SplitMode, type Warning } from "./types";

const MAX_TOTAL_BYTES = 700 * 1024 * 1024;
export const PRODUCER = "MossPDF by Vin's Atelier";
export const CREATOR = "MossPDF";

export function safeName(name: string, fallback: string): string {
  const base = name
    .replace(/\.pdf$/i, "")
    .replace(/[^\p{L}\p{N} _().-]+/gu, "_")
    .trim()
    .slice(0, 60);
  return (base || fallback) + ".pdf";
}
const stem = (n: string) => safeName(n, "document").slice(0, -4);

/** Consecutive runs become ranges: [1,2,3,7] -> "1-3,7". */
function rangeArg(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return out.join(",");
}

async function openUsed(files: InFile[], used: Set<number>, o: OpOptions, e: Engines, step: { n: number; total: number }) {
  const opened: Opened[] = [];
  for (const i of used) {
    opened[i] = await openPdf(files[i], e, o.signal);
    o.onProgress?.(++step.n, step.total);
  }
  return opened;
}

async function build(files: InFile[], opened: Opened[], pages: PageSpec[], name: string, o: OpOptions, e: Engines): Promise<OpResult> {
  const segs: { src: number; pages: number[] }[] = [];
  for (const p of pages) {
    const last = segs.at(-1);
    if (last && last.src === p.source) last.pages.push(p.page + 1);
    else segs.push({ src: p.source, pages: [p.page + 1] });
  }
  const byAngle = new Map<number, number[]>();
  pages.forEach((p, i) => p.rotate && byAngle.set(p.rotate, [...(byAngle.get(p.rotate) ?? []), i + 1]));
  const inputs: Record<string, Bytes> = {};
  for (const s of segs) inputs[`/in${s.src}.pdf`] = opened[s.src].bytes;
  const args = [
    "--empty",
    "--pages",
    ...segs.flatMap((s) => [`/in${s.src}.pdf`, ...(files[s.src].password ? [`--password=${files[s.src].password}`] : []), rangeArg(s.pages)]),
    "--",
    ...[...byAngle].map(([a, idx]) => `--rotate=+${a}:${rangeArg(idx)}`),
    "/out.pdf",
  ];
  checkAbort(o.signal);
  const r = await e.qpdf(args, inputs, ["/out.pdf"]);
  let bytes = r.files["/out.pdf"];
  if (!bytes || r.code === 2) throw classify(r.stderr, files[segs[0].src]);

  const warnings: Warning[] = [];
  const used = [...new Set(segs.map((s) => s.src))];
  for (const i of used) {
    const { info } = opened[i];
    const n = `"${files[i].name}"`;
    if (info.repaired) warnings.push({ code: "repaired", message: `${n} was damaged and has been repaired. Some content may be missing, so check the result.` });
    if (info.hasOutline) warnings.push({ code: "outline-dropped", message: `The bookmarks in ${n} can't be kept, so the new file has none.` });
    if (info.hasSignatures) warnings.push({ code: "signature-invalidated", message: `${n} is digitally signed. Changing its pages makes the signature invalid.` });
  }
  if (segs.filter((s) => opened[s.src].info.hasForms).length > 1) warnings.push({ code: "forms-renamed", message: "More than one source has form fields. Fields with the same name are renamed so they stay separate." });

  // Metadata: --empty leaves no Info, so only the credit needs writing. pdf-lib is the only engine here that sets Info cleanly.
  if (o.producerCredit) {
    checkAbort(o.signal);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    doc.setProducer(PRODUCER);
    doc.setCreator(CREATOR);
    bytes = await doc.save({ useObjectStreams: false });
  }
  return { bytes, name, warnings };
}

function validate(files: InFile[], pages: PageSpec[]) {
  if (!files.length) throw new PdfError("unsupported", "Add at least one PDF first.");
  if (!pages.length) throw new PdfError("unsupported", "No pages are selected. Pick at least one page.");
  if (files.reduce((s, f) => s + f.bytes.length, 0) > MAX_TOTAL_BYTES) throw new PdfError("too-large", "These files are too big to handle together in the browser. Try fewer or smaller files.");
}

function checkBounds(files: InFile[], opened: Opened[], pages: PageSpec[]) {
  for (const p of pages) {
    const n = opened[p.source]?.info.pageCount;
    if (n === undefined || p.page < 0 || p.page >= n) {
      const f = files[p.source];
      throw new PdfError("unsupported", `Page ${p.page + 1} doesn't exist in "${f?.name}"${n === undefined ? "." : `, which has ${n} page${n === 1 ? "" : "s"}.`}`, f?.name);
    }
  }
}

export async function assemble(files: InFile[], pages: PageSpec[], name: string, o: OpOptions, e: Engines): Promise<OpResult> {
  validate(files, pages);
  const used = new Set(pages.map((p) => p.source));
  const step = { n: 0, total: used.size + 1 };
  const opened = await openUsed(files, used, o, e, step);
  checkBounds(files, opened, pages);
  const res = await build(files, opened, pages, safeName(name, "document"), o, e);
  o.onProgress?.(step.total, step.total);
  return res;
}

/** One top-level bookmark per file, with that file's own bookmarks nested under it (pages remapped). Encrypted or unreadable outlines keep the "dropped" warning. */
async function addFileBookmarks(res: OpResult, files: InFile[], opened: Opened[]) {
  const items: BookmarkItem[] = [];
  const lost: string[] = [];
  let offset = 0;
  for (const [i, f] of files.entries()) {
    const { info, bytes } = opened[i];
    items.push({ title: f.name.replace(/\.pdf$/i, ""), page: offset + 1, level: 0 });
    if (info.hasOutline) {
      try {
        if (info.encrypted) throw new Error("encrypted");
        const sub = readOutlineItems(await PDFDocument.load(bytes, { updateMetadata: false }));
        for (const it of sub.items) items.push({ title: it.title, page: it.page && it.page + offset, level: it.level + 1 });
      } catch {
        lost.push(f.name);
      }
    }
    offset += info.pageCount;
  }
  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  writeOutlineItems(doc, items);
  res.bytes = await doc.save({ useObjectStreams: false });
  res.warnings = res.warnings.filter((w) => w.code !== "outline-dropped");
  for (const n of lost) res.warnings.push({ code: "outline-dropped", message: `The bookmarks inside "${n}" can't be kept. The new file has one bookmark for the file itself.` });
}

export async function merge(files: InFile[], o: OpOptions, e: Engines, mo: { bookmarks?: boolean } = {}): Promise<OpResult> {
  if (!files.length) throw new PdfError("unsupported", "Add at least one PDF first.");
  const used = new Set(files.keys());
  const step = { n: 0, total: used.size + 1 };
  const opened = await openUsed(files, used, o, e, step);
  const pages = opened.flatMap((op, source) => Array.from({ length: op.info.pageCount }, (_, page): PageSpec => ({ source, page, rotate: 0 })));
  validate(files, pages);
  const res = await build(files, opened, pages, "merged.pdf", o, e);
  if (mo.bookmarks) await addFileBookmarks(res, files, opened);
  o.onProgress?.(step.total, step.total);
  return res;
}

/** A file name from a bookmark title: no path or reserved characters, at most 80 long, never empty. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not have
export const titleName = (t: string) => t.replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "") || "Untitled";

/** Top-level bookmarks with a page become parts: from their page to the page before the next one (0-based). Names are unique, case-insensitive. */
export function bookmarkParts(items: BookmarkItem[], count: number): { name: string; pages: number[] }[] {
  const tops = items.filter((it) => it.level === 0 && it.page !== null && it.page >= 1 && it.page <= count).sort((a, b) => a.page! - b.page!);
  const used = new Set<string>();
  const parts: { name: string; pages: number[] }[] = [];
  const first = (tops[0]?.page ?? 1) - 1; // pages before the first bookmark (cover, contents) get their own part
  if (first > 0) { used.add("start"); parts.push({ name: "Start", pages: Array.from({ length: first }, (_, k) => k) }); }
  tops.forEach((it, i) => {
    const start = it.page! - 1;
    const end = (tops[i + 1]?.page ?? count + 1) - 1; // exclusive; two bookmarks on one page leave the first empty, so it is skipped
    if (end <= start) return;
    const base = titleName(it.title);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    parts.push({ name, pages: Array.from({ length: end - start }, (_, k) => start + k) });
  });
  return parts;
}

export async function split(file: InFile, mode: SplitMode, o: OpOptions, e: Engines): Promise<OpResult[]> {
  validate([file], [{ source: 0, page: 0, rotate: 0 }]);
  const opened = [await openPdf(file, e, o.signal)];
  const count = opened[0].info.pageCount;
  const base = stem(file.name);
  const spec = (idx: number[]) => idx.map((page): PageSpec => ({ source: 0, page, rotate: 0 }));
  const label = (g: number[]) => (g.length === 1 ? `page-${g[0] + 1}` : `pages-${g[0] + 1}-${g.at(-1)! + 1}`);
  const out: OpResult[] = [];

  let groups: number[][] = [];
  if (mode.kind === "ranges") groups = parseRanges(mode.ranges, count);
  else if (mode.kind === "every") {
    if (!Number.isInteger(mode.n) || mode.n < 1) throw new PdfError("unsupported", "Enter how many pages each file should have (1 or more).");
    for (let i = 0; i < count; i += mode.n) groups.push(Array.from({ length: Math.min(mode.n, count - i) }, (_, k) => i + k));
  }
  if (mode.kind === "bookmarks") {
    const p = await prepare(file, o, e);
    const parts = bookmarkParts(readOutlineItems(await PDFDocument.load(p.bytes, { updateMetadata: false })).items, count);
    if (!parts.length) throw new PdfError("unsupported", `"${file.name}" has no top-level bookmarks that point to a page, so there is nothing to split by.`, file.name);
    for (const [i, g] of parts.entries()) {
      out.push(await build([file], opened, spec(g.pages), `${g.name}.pdf`, o, e));
      o.onProgress?.(i + 1, parts.length);
    }
    return out;
  }
  if (mode.kind !== "size") {
    for (const [i, g] of groups.entries()) {
      out.push(await build([file], opened, spec(g), `${base}-${label(g)}.pdf`, o, e));
      o.onProgress?.(i + 1, groups.length);
    }
    return out;
  }

  // Size mode: estimate pages per part from the average page size, then halve a part until it fits.
  // ponytail: average-size estimate + retry; exact bin packing only if parts often come out much smaller than the limit.
  if (!(mode.maxBytes > 0)) throw new PdfError("unsupported", "Enter a maximum file size greater than zero.");
  let n = Math.max(1, Math.floor(mode.maxBytes / (file.bytes.length / count)));
  for (let i = 0; i < count; ) {
    const take = Math.min(n, count - i);
    const idx = Array.from({ length: take }, (_, k) => i + k);
    const part = await build([file], opened, spec(idx), `${base}-part-${out.length + 1}.pdf`, o, e);
    if (part.bytes.length > mode.maxBytes && take > 1) {
      n = Math.ceil(take / 2);
      continue;
    }
    if (part.bytes.length > mode.maxBytes) part.warnings.push({ code: "oversize", message: `Page ${i + 1} alone is larger than the size limit, so it's kept in its own file.` });
    out.push(part);
    i += take;
    o.onProgress?.(i, count);
  }
  return out;
}
