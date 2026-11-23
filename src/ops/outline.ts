// Bookmarks (the /Outlines tree): read into a flat list with levels, write a fresh tree. Also used by Merge for one bookmark per file.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from "@cantoo/pdf-lib";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export const MAX_LEVEL = 2;
/** A bookmark in reading order. `page` is 1-based, null when the destination is unknown. `level` 0 is top level. */
export interface BookmarkItem {
  title: string;
  page: number | null;
  level: number;
}
export interface OutlineInfo {
  items: BookmarkItem[];
  pageCount: number;
}

const MAX_ITEMS = 20000;
const N = PDFName.of;

const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : "");

/** Named destinations: /Names /Dests name tree, or the old /Dests dictionary. Returns the destination array. */
function namedDest(doc: PDFDocument, name: string): PDFArray | undefined {
  const cat = doc.catalog;
  const asDest = (v: PDFObject | undefined): PDFArray | undefined => {
    const x = v && doc.context.lookup(v);
    if (x instanceof PDFArray) return x;
    return x instanceof PDFDict ? doc.context.lookupMaybe(x.get(N("D")), PDFArray) : undefined;
  };
  const old = cat.lookupMaybe(N("Dests"), PDFDict);
  const hit = old && asDest(old.get(N(name)));
  if (hit) return hit;
  const walk = (node: PDFDict | undefined, depth: number): PDFArray | undefined => {
    if (!node || depth > 12) return undefined;
    const names = node.lookupMaybe(N("Names"), PDFArray);
    if (names) for (let i = 0; i + 1 < names.size(); i += 2) if (text(names.lookup(i)) === name) return asDest(names.get(i + 1));
    const kids = node.lookupMaybe(N("Kids"), PDFArray);
    for (let i = 0; kids && i < kids.size(); i++) {
      const r = walk(kids.lookupMaybe(i, PDFDict), depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  return walk(cat.lookupMaybe(N("Names"), PDFDict)?.lookupMaybe(N("Dests"), PDFDict), 0);
}

export function readOutlineItems(doc: PDFDocument): OutlineInfo {
  const pages = doc.getPages();
  const index = new Map<PDFRef, number>();
  pages.forEach((p, i) => index.set(p.ref, i));
  const items: BookmarkItem[] = [];
  const pageOf = (item: PDFDict): number | null => {
    let d: PDFObject | undefined = item.lookup(N("Dest"));
    if (!d) {
      const a = item.lookupMaybe(N("A"), PDFDict);
      if (a?.lookup(N("S")) === N("GoTo")) d = a.lookup(N("D"));
    }
    if (d instanceof PDFName) d = namedDest(doc, d.decodeText());
    else if (d instanceof PDFString || d instanceof PDFHexString) d = namedDest(doc, d.decodeText());
    const first = d instanceof PDFArray ? d.get(0) : undefined;
    if (first instanceof PDFRef) {
      const i = index.get(first);
      return i === undefined ? null : i + 1;
    }
    return null;
  };
  const seen = new Set<PDFDict>();
  const walk = (first: PDFDict | undefined, level: number) => {
    for (let it = first; it && !seen.has(it) && items.length < MAX_ITEMS; it = it.lookupMaybe(N("Next"), PDFDict)) {
      seen.add(it);
      items.push({ title: text(it.lookup(N("Title"))), page: pageOf(it), level: Math.min(level, MAX_LEVEL) });
      walk(it.lookupMaybe(N("First"), PDFDict), level + 1);
    }
  };
  walk(doc.catalog.lookupMaybe(N("Outlines"), PDFDict)?.lookupMaybe(N("First"), PDFDict), 0);
  return { items, pageCount: pages.length };
}

const pdfTitle = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s));

/** Replaces the outline with `items`. A level can be at most one deeper than the item before it. No items removes the outline. */
export function writeOutlineItems(doc: PDFDocument, items: BookmarkItem[]) {
  const cat = doc.catalog;
  const pages = doc.getPages();
  cat.delete(N("Outlines"));
  if (!items.length) {
    if (cat.lookup(N("PageMode")) === N("UseOutlines")) cat.delete(N("PageMode"));
    return;
  }
  const ctx = doc.context;
  const fixed: BookmarkItem[] = [];
  for (const it of items) fixed.push({ ...it, level: fixed.length ? Math.max(0, Math.min(it.level, 1 + fixed.at(-1)!.level)) : 0 });
  items = fixed;
  const dicts = items.map(() => ctx.obj({}) as PDFDict);
  const refs = dicts.map((d) => ctx.register(d));
  const rootDict = ctx.obj({ Type: "Outlines" }) as PDFDict;
  const root = ctx.register(rootDict);
  const kids: number[][] = items.map(() => []);
  const top: number[] = [];
  const stack: number[] = [];
  items.forEach((it, i) => {
    stack.length = it.level;
    const parent = stack.at(-1);
    (parent === undefined ? top : kids[parent]).push(i);
    stack.push(i);
  });
  const total = (i: number): number => kids[i].reduce((s, k) => s + 1 + total(k), 0);
  const link = (list: number[], parent: PDFRef) =>
    list.forEach((i, k) => {
      const it = items[i];
      const d = dicts[i];
      d.set(N("Title"), pdfTitle(it.title));
      d.set(N("Parent"), parent);
      if (k > 0) d.set(N("Prev"), refs[list[k - 1]]);
      if (k < list.length - 1) d.set(N("Next"), refs[list[k + 1]]);
      if (kids[i].length) {
        d.set(N("First"), refs[kids[i][0]]);
        d.set(N("Last"), refs[kids[i].at(-1)!]);
        d.set(N("Count"), PDFNumber.of(total(i)));
        link(kids[i], refs[i]);
      }
      if (it.page !== null) {
        if (!Number.isInteger(it.page) || it.page < 1 || it.page > pages.length) throw new PdfError("unsupported", `The bookmark "${it.title}" points to page ${it.page}, but the file has ${pages.length} page${pages.length === 1 ? "" : "s"}.`);
        d.set(N("Dest"), ctx.obj([pages[it.page - 1].ref, N("XYZ"), null, null, null]));
      }
    });
  link(top, root);
  rootDict.set(N("First"), refs[top[0]]);
  rootDict.set(N("Last"), refs[top.at(-1)!]);
  rootDict.set(N("Count"), PDFNumber.of(items.length));
  cat.set(N("Outlines"), root);
  cat.set(N("PageMode"), N("UseOutlines"));
}

export async function readOutline(file: InFile, o: Pick<OpOptions, "signal">, e: Engines): Promise<OutlineInfo> {
  const p = await prepare(file, o, e);
  return readOutlineItems(await PDFDocument.load(p.bytes, { updateMetadata: false }));
}

export async function setOutline(file: InFile, opts: { items: BookmarkItem[] }, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const items = opts.items.map((it) => ({ title: it.title.trim().slice(0, 500) || "Untitled", page: it.page, level: Math.max(0, Math.floor(it.level) || 0) }));
  writeOutlineItems(doc, items);
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), name: file.name, warnings: p.warnings };
}
