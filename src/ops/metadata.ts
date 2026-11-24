// Document metadata: Info dictionary and XMP stay consistent. Also the producer credit every modifying op shares.
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "@cantoo/pdf-lib";
import { PRODUCER } from "./assemble";
import { prepare } from "./common";
import { checkAbort } from "./open";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";
import { xmpGet, xmpSet, type XmpKey } from "./xmp";

export interface Metadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  created?: string; // ISO 8601
  modified?: string;
  hasXmp: boolean;
}
/** undefined = leave as is, "" = remove the field. removeAll drops Info and XMP entirely (and adds no credit). */
export interface MetadataEdit {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  removeAll?: boolean;
}

const META = PDFName.of("Metadata");

function xmpRef(doc: PDFDocument): PDFRef | undefined {
  const r = doc.catalog.get(META);
  return r instanceof PDFRef && doc.context.lookup(r) instanceof PDFRawStream ? r : undefined;
}
function readXmp(doc: PDFDocument, ref: PDFRef): string {
  const s = doc.context.lookup(ref) as PDFRawStream;
  return new TextDecoder().decode(s.dict.has(PDFName.of("Filter")) ? decodePDFRawStream(s).decode() : s.getContents());
}
function setXmp(doc: PDFDocument, fields: [XmpKey, string | null][]) {
  const ref = xmpRef(doc);
  if (!ref) return;
  let xml = readXmp(doc, ref);
  for (const [k, v] of fields) xml = xmpSet(xml, k, v);
  doc.context.assign(ref, doc.context.stream(new TextEncoder().encode(xml), { Type: "Metadata", Subtype: "XML" }));
}

/** Producer credit for ops that modify an existing file (Creator belongs to the author's program, so it is left alone). */
export function applyCredit(doc: PDFDocument) {
  doc.setProducer(PRODUCER);
  setXmp(doc, [["pdf:Producer", PRODUCER]]);
}

export async function readMetadata(file: InFile, e: Engines): Promise<Metadata> {
  const p = await prepare(file, {}, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  const ref = xmpRef(doc);
  const xml = ref ? readXmp(doc, ref) : "";
  const pick = (v: string | undefined, k: XmpKey) => v ?? (xml ? xmpGet(xml, k) : undefined);
  return {
    title: pick(doc.getTitle(), "dc:title"),
    author: pick(doc.getAuthor(), "dc:creator"),
    subject: pick(doc.getSubject(), "dc:description"),
    keywords: pick(doc.getKeywords(), "pdf:Keywords"),
    creator: pick(doc.getCreator(), "xmp:CreatorTool"),
    producer: pick(doc.getProducer(), "pdf:Producer"),
    created: doc.getCreationDate()?.toISOString(),
    modified: doc.getModificationDate()?.toISOString(),
    hasXmp: !!ref,
  };
}

export async function writeMetadata(file: InFile, edit: MetadataEdit, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false });
  checkAbort(o.signal);
  let bytes: Uint8Array;
  if (edit.removeAll) {
    delete doc.context.trailerInfo.Info;
    doc.catalog.delete(META);
    bytes = await doc.save({ useObjectStreams: false });
    // The old Info and XMP objects are still in pdf-lib's output as orphans; a qpdf rewrite drops them.
    const r = await e.qpdf(["/in.pdf", "/out.pdf"], { "/in.pdf": bytes }, ["/out.pdf"]);
    if (!r.files["/out.pdf"] || r.code === 2) throw new PdfError("corrupt", `"${file.name}" couldn't be cleaned. Your original is unchanged. Try Repair first, then try again.`, file.name);
    bytes = r.files["/out.pdf"];
  } else {
    const fields: [keyof MetadataEdit, XmpKey, (v: string) => void, string][] = [
      ["title", "dc:title", (v) => doc.setTitle(v), "Title"],
      ["author", "dc:creator", (v) => doc.setAuthor(v), "Author"],
      ["subject", "dc:description", (v) => doc.setSubject(v), "Subject"],
      ["keywords", "pdf:Keywords", (v) => doc.setKeywords([v]), "Keywords"],
    ];
    const x: [XmpKey, string | null][] = [];
    for (const [k, q, set, key] of fields) {
      const v = edit[k] as string | undefined;
      if (v === undefined) continue;
      if (v === "") doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)?.delete(PDFName.of(key));
      else set(v);
      x.push([q, v || null]);
    }
    setXmp(doc, x);
    if (o.producerCredit) applyCredit(doc);
    bytes = await doc.save({ useObjectStreams: false });
  }
  return { bytes, name: file.name, warnings: p.warnings };
}
