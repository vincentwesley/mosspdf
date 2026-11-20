// Redaction (D17). The pages that have something to remove are rebuilt as one picture each (drawn by the caller with the black boxes already
// painted in), so the covered text and shapes no longer exist in the file. An invisible text layer of the words OUTSIDE the boxes is added
// back (same layer as OCR). Then everything that can carry the data elsewhere is dropped (Info, XMP, annotations, forms, attachments,
// scripts, outline titles that contain it, structure tree) and qpdf rewrites the whole file, which also drops the old page objects.
// Finally the output is scanned for every redacted string; if one is still there nothing is returned.
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, type PDFObject } from "@cantoo/pdf-lib";
import type { OcrWord } from "../engines/ocr";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { checkAbort } from "./open";
import { drawLayer } from "./ocr";
import { toUser, view } from "./stamp";
import { PdfError, type Bytes, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export interface RedactPage {
  /** 0-based. */
  page: number;
  /** The page as it is to look: JPEG, black boxes included. */
  jpeg: Bytes;
  /** Size of the words' coordinate space (any unit; words are scaled to the page), origin top left. */
  width: number;
  height: number;
  /** The words that stay searchable: already without the ones under a box. */
  words: OcrWord[];
}
export interface RedactInput {
  pages: RedactPage[];
  /** Strings that were removed: checked for in outline titles and in the finished file. */
  needles: string[];
  /** How many items were redacted (for the note). */
  items: number;
}

const N = (s: string) => PDFName.of(s);
const PAGE_KEYS = ["Annots", "Thumb", "AA", "B", "PieceInfo", "Metadata", "StructParents", "Group", "Tabs", "Trans", "Dur", "VP", "SeparationInfo", "ID", "PZ"];
const CATALOG_KEYS = ["OpenAction", "AA", "AcroForm", "StructTreeRoot", "MarkInfo", "PieceInfo", "Metadata", "AF", "Perms", "Threads", "SpiderInfo", "OutputIntents"];

const norm = (s: string) => s.toLowerCase();
/** The ways a string can sit in a PDF (plain, UTF-16BE, and both as hex), all lower case. */
function forms(s: string): string[] {
  const n = norm(s);
  const a = [...n].map((c) => c.charCodeAt(0));
  const hex = (xs: number[], w: number) => xs.map((x) => x.toString(16).padStart(w, "0")).join("");
  return [n, String.fromCharCode(...a.flatMap((c) => [c >> 8, c & 255])), hex(a, 2), hex(a, 4)];
}

async function leaks(bytes: Bytes, needles: string[], e: Engines): Promise<string[]> {
  const r = await e.qpdf(["--qdf", "--object-streams=disable", "/in.pdf", "/out.pdf"], { "/in.pdf": bytes }, ["/out.pdf"]);
  let hay = new TextDecoder("latin1").decode(r.files["/out.pdf"] ?? bytes);
  hay = hay.replace(/\/DCTDecode[\s\S]*?endstream/g, ""); // picture data is random bytes: skipping it avoids chance matches of short strings
  hay = norm(hay);
  return needles.filter((n) => n.trim() && forms(n).some((f) => hay.includes(f)));
}

/** Outline entries whose title contains a redacted string get the title "[redacted]". */
function scrubOutline(doc: PDFDocument, needles: string[]): void {
  const lc = needles.map(norm).filter(Boolean);
  const seen = new Set<PDFDict>();
  const walk = (item: PDFObject | undefined) => {
    for (let d = item && doc.context.lookup(item); d instanceof PDFDict && !seen.has(d); d = doc.context.lookup(d.get(N("Next")))) {
      seen.add(d);
      const t = d.lookup(N("Title"));
      if ((t instanceof PDFString || t instanceof PDFHexString) && lc.some((n) => norm(t.decodeText()).includes(n))) d.set(N("Title"), PDFHexString.fromText("[redacted]"));
      walk(d.get(N("First")));
    }
  };
  const root = doc.catalog.lookup(N("Outlines"));
  if (root instanceof PDFDict) walk(root.get(N("First")));
}

export async function redact(file: InFile, input: RedactInput, o: OpOptions, e: Engines): Promise<OpResult> {
  if (!input.pages.length) throw new PdfError("unsupported", "Nothing is selected to redact.", file.name);
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const pages = doc.getPages();

  for (const [k, pg] of input.pages.entries()) {
    checkAbort(o.signal);
    const page = pages[pg.page];
    if (!page) throw new PdfError("unsupported", `Page ${pg.page + 1} doesn't exist in "${file.name}".`, file.name);
    const v = view(page);
    const img = await doc.embedJpg(pg.jpeg);
    const [ox, oy] = toUser(v, 0, 0), [xx, xy] = toUser(v, 1, 0), [yx, yy] = toUser(v, 0, 1);
    const cm = [(xx - ox) * v.w, (xy - oy) * v.w, (yx - ox) * v.h, (yy - oy) * v.h, ox, oy].map((n) => n.toFixed(4)).join(" ");
    const node = page.node;
    node.set(N("Contents"), doc.context.register(doc.context.stream(`q ${cm} cm /PHI Do Q`)));
    node.set(N("Resources"), doc.context.obj({ XObject: { PHI: img.ref } }));
    for (const key of PAGE_KEYS) node.delete(N(key));
    o.onProgress?.(k + 1, input.pages.length + 2);
  }
  await drawLayer(doc, input.pages.map((pg) => ({ page: pg.page, width: pg.width, height: pg.height, words: pg.words })), file, { producerCredit: false, signal: o.signal });

  // Everything else that can carry the data. Annotations go from every page (links included): an annotation can hold text, and the pages
  // that were not rebuilt still carry them otherwise.
  for (const pg of pages) pg.node.delete(N("Annots"));
  for (const key of CATALOG_KEYS) doc.catalog.delete(N(key));
  delete doc.context.trailerInfo.Info;
  const names = doc.catalog.lookup(N("Names"));
  if (names instanceof PDFDict) for (const key of ["EmbeddedFiles", "JavaScript", "AlternatePresentations", "Renditions"]) names.delete(N(key));
  scrubOutline(doc, input.needles);

  checkAbort(o.signal);
  const raw = await doc.save({ useObjectStreams: false });
  // The full rewrite: no incremental history, and only the objects that are still reachable (the old pages, fonts and images are gone).
  const r = await e.qpdf(["--object-streams=disable", "/in.pdf", "/out.pdf"], { "/in.pdf": raw }, ["/out.pdf"]);
  const bytes = r.files["/out.pdf"];
  if (!bytes || r.code === 2) throw new PdfError("corrupt", `"${file.name}" couldn't be redacted. The original is unchanged.`, file.name);
  o.onProgress?.(input.pages.length + 1, input.pages.length + 2);
  const left = await leaks(bytes, input.needles, e);
  if (left.length) throw new PdfError("corrupt", "The redacted copy was checked and still contained some of the text, so it was not saved. Try again, and tell us if it keeps happening.", file.name);
  o.onProgress?.(input.pages.length + 2, input.pages.length + 2);

  const n = input.pages.length;
  const note = `Redacted ${input.items} ${input.items === 1 ? "item" : "items"} on ${n} ${n === 1 ? "page" : "pages"}. ${n === 1 ? "That page is" : "Those pages are"} now ${n === 1 ? "an image" : "images"} with a hidden text layer, so text outside the boxes can still be searched and copied.`;
  return {
    bytes,
    name: safeName(file.name, "document").replace(/\.pdf$/i, "") + "-redacted.pdf",
    warnings: [...p.warnings, { code: "redacted", message: note }, { code: "redact-stripped", message: "Also removed from the whole file: document details (title, author, XMP), comments, links and form fields, attachments, scripts, and bookmark titles that contained a redacted word." }],
  };
}
