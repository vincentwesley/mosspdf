// Safety scan and cleaned copy. The scan reads qpdf's JSON dump (which already flattens object streams and decrypts with the
// supplied password) and reports risky elements in plain language. It describes what an element CAN do, never what a file is.
// The clean copy edits with pdf-lib, then qpdf re-writes it (drops orphaned objects, no object streams) and re-scans it.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFObject } from "@cantoo/pdf-lib";
import { safeName } from "./assemble";
import { checkAbort, classify, openPdf } from "./open";
import { isSafeLink } from "../core/links";
import { authorise } from "./protect";
import { PdfError, type Bytes, type Engines, type InFile, type OpOptions, type Warning } from "./types";
import type { CleanOptions, CleanResult, SafetyItem, SafetyKind, SafetyReport, Severity } from "./types-m3";

/* eslint-disable @typescript-eslint/no-explicit-any -- qpdf JSON v2 is untyped */
type J = any;

const INFO: Record<SafetyKind, [Severity, string]> = {
  javascript: ["high", "A script that runs inside the PDF viewer. It can change what you see, open web pages, or send form contents somewhere when the file opens or a field changes."],
  "open-action": ["medium", "Something the viewer does by itself as soon as the file is opened, such as jumping to a page or running an action."],
  "additional-actions": ["medium", "Triggers that run actions on events such as a page opening, the mouse moving over a field, or a field being left."],
  launch: ["high", "Asks the viewer to open or run another file or program on your computer. Most viewers ask first, but not all do."],
  "embedded-file": ["high", "A file stored inside the PDF that is not shown on the pages. It can be of any type, and it only does something if someone opens it later."],
  "file-attachment": ["high", "A paperclip-style attachment on a page: a whole file carried inside the PDF. It only does something if someone opens it."],
  "submit-form": ["high", "A button that can send what is typed into the form to a web address."],
  "import-data": ["medium", "An action that can load form data from another file into this form."],
  uri: ["medium", "A link that opens a web address when clicked. The address is shown so you can see where it points."],
  "go-to-remote": ["medium", "A link that jumps into a different PDF file."],
  "go-to-embedded": ["medium", "A link that jumps into a PDF stored inside this one or one it is linked to."],
  "rich-media": ["high", "An embedded interactive item such as video, audio, 3D or an app. It can run its own code in the viewer."],
  "media-action": ["medium", "An action that plays a video, sound or embedded app, which can run its own code in the viewer."],
  "hide-action": ["medium", "An action that hides or shows parts of the page, such as form fields or notes, when something is clicked."],
  xfa: ["medium", "An older kind of dynamic form that runs scripts and loads data in some viewers. The ordinary form fields can be kept without it."],
  "object-streams": ["info", "The file packs its internal objects into compressed groups. This is normal and only means a simple text search won't show everything."],
  jbig2: ["info", "Contains images compressed with JBIG2, a format that is complex to decode. This is common in scanned documents."],
};

const REF = /^\d+ 0 R$/;
const str = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  if (v.startsWith("u:")) return v.slice(2);
  if (v.startsWith("b:")) return v.slice(2).replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
  return undefined;
};
const MAX_DETAIL = 200;
const clip = (s: string | undefined) => (s && s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) + "…" : s);

function analyse(j: J, rawObjStm: number): Omit<SafetyReport, "repaired"> {
  const objs: J = j.qpdf[1];
  const dictOf = (o: J): J => o?.value ?? o?.stream?.dict;
  const deref = (v: J): J => (typeof v === "string" && REF.test(v) ? dictOf(objs[`obj:${v}`]) : v);
  const keys = Object.keys(objs).filter((k) => k.startsWith("obj:"));

  // Page number of every object reachable from a page (never crossing /Parent, /P or into another page).
  const pageRefs: string[] = j.pages.map((p: J) => p.object);
  const pageSet = new Set(pageRefs);
  const pageOf = new Map<string, number>();
  pageRefs.forEach((root, i) => {
    const stack: J[] = [root];
    while (stack.length) {
      const v = stack.pop();
      if (typeof v === "string") {
        if (!REF.test(v) || pageOf.has(v) || (v !== root && pageSet.has(v))) continue;
        pageOf.set(v, i + 1);
        stack.push(dictOf(objs[`obj:${v}`]));
      } else if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "/Parent" && k !== "/P") stack.push(x);
    }
  });

  const rootRef = objs.trailer.value["/Root"];
  const attachSpecs = new Set<string>();
  for (const k of keys) {
    const d = dictOf(objs[k]);
    if (d?.["/Subtype"] === "/FileAttachment" && typeof d["/FS"] === "string") attachSpecs.add(d["/FS"]);
  }

  const items: SafetyItem[] = [];
  const add = (kind: SafetyKind, where: number | "document", detail?: string) => items.push({ kind, severity: INFO[kind][0], where, detail: clip(detail), explanation: INFO[kind][1] });
  const target = (d: J) => {
    const f = deref(d["/F"]);
    return str(f) ?? str(f?.["/UF"]) ?? str(f?.["/F"]) ?? str(d["/URI"]);
  };

  // Actions are often inline dictionaries (an annotation's /A), so every nested dictionary is examined too.
  const walk = (d: J, ref: string, where: number | "document") => {
    if (!d || typeof d !== "object") return;
    if (Array.isArray(d)) return d.forEach((x) => walk(x, "", where));
    examine(d, ref, where);
    for (const x of Object.values(d)) if (x && typeof x === "object") walk(x, "", where);
  };
  const examine = (d: J, ref: string, where: number | "document") => {
    const s = d["/S"];
    if (s === "/JavaScript" || d["/JS"] !== undefined) add("javascript", where, str(d["/JS"]) ?? "script stored in a stream");
    else if (s === "/Launch") add("launch", where, target(d));
    else if (s === "/SubmitForm") add("submit-form", where, target(d));
    else if (s === "/ImportData") add("import-data", where, target(d));
    else if (s === "/Rendition" || s === "/Movie" || s === "/Sound" || s === "/RichMediaExecute") add("media-action", where, s.slice(1));
    else if (s === "/Hide") add("hide-action", where);
    else if (s === "/URI") add("uri", where, str(d["/URI"]));
    else if (s === "/GoToR") add("go-to-remote", where, target(d));
    else if (s === "/GoToE") add("go-to-embedded", where, target(d));
    if (d["/OpenAction"] !== undefined) {
      const a = deref(d["/OpenAction"]);
      add("open-action", where, Array.isArray(a) ? "jumps to a page" : typeof a?.["/S"] === "string" ? `runs a ${a["/S"].slice(1)} action` : undefined);
    }
    if (d["/AA"] !== undefined) {
      const level = ref === rootRef ? "document" : d["/Type"] === "/Page" ? "page" : "annotation or field";
      const events = Object.keys(deref(d["/AA"]) ?? {}).map((e) => e.slice(1));
      add("additional-actions", where, `${level}-level triggers${events.length ? ` (${events.join(", ")})` : ""}`);
    }
    if (d["/Type"] === "/Filespec" && d["/EF"] !== undefined && !attachSpecs.has(ref)) add("embedded-file", where, str(d["/UF"]) ?? str(d["/F"]));
    if (d["/Subtype"] === "/FileAttachment") add("file-attachment", where, str(deref(d["/FS"])?.["/UF"]) ?? str(deref(d["/FS"])?.["/F"]));
    if (d["/Subtype"] === "/RichMedia") add("rich-media", where);
    if (d["/XFA"] !== undefined) add("xfa", where);
    const filter = JSON.stringify(d["/Filter"] ?? "");
    if (filter.includes("JBIG2Decode")) add("jbig2", where);
  };
  for (const k of keys) walk(dictOf(objs[k]), k.slice(4), pageOf.get(k.slice(4)) ?? "document");
  // qpdf's JSON flattens object streams, so they can only be seen in the raw bytes (their dictionaries are never compressed).
  if (rawObjStm > 0) add("object-streams", "document", `${rawObjStm} object stream${rawObjStm === 1 ? "" : "s"}`);

  const order = (w: number | "document") => (w === "document" ? 0 : w);
  items.sort((a, b) => order(a.where) - order(b.where) || a.kind.localeCompare(b.kind) || (a.detail ?? "").localeCompare(b.detail ?? ""));
  return { items, risky: items.some((i) => i.severity !== "info"), pageCount: pageRefs.length, encrypted: !!j.encrypt?.encrypted };
}

const countObjStm = (b: Bytes) => (new TextDecoder("latin1").decode(b).match(/\/Type\s*\/ObjStm/g) ?? []).length;

async function scanBytes(f: InFile, e: Engines): Promise<{ r?: Omit<SafetyReport, "repaired">; err: string }> {
  const run = await e.qpdf(["--json=2", "--json-key=qpdf", "--json-key=pages", "--json-key=encrypt", ...(f.password ? [`--password=${f.password}`] : []), "/f.pdf"], { "/f.pdf": f.bytes });
  if (!run.stdout.startsWith("{")) return { err: run.stderr };
  try {
    return { r: analyse(JSON.parse(run.stdout), countObjStm(f.bytes)), err: "" };
  } catch {
    return { err: run.stderr || "unreadable" };
  }
}

/** Read-only: needs only a password that opens the file (the user password is enough, nothing is decrypted or changed). */
export async function safetyScan(file: InFile, e: Engines): Promise<SafetyReport> {
  let a = await scanBytes(file, e);
  if (a.r) return { ...a.r, repaired: false };
  if (/invalid password/i.test(a.err)) throw classify(a.err, file);
  const opened = await openPdf(file, e); // typed error for empty / not a PDF / unrecoverable, else a repaired copy
  a = await scanBytes({ name: file.name, bytes: opened.bytes }, e);
  if (!a.r) throw classify(a.err, file);
  return { ...a.r, repaired: true };
}

const BAD_ACTIONS = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToR", "GoToE", "Rendition", "Movie", "Sound", "Hide", "RichMediaExecute"]);
const N = (s: string) => PDFName.of(s);
const uriText = (d: PDFDict) => { const u = d.lookup(N("URI")); return u instanceof PDFString || u instanceof PDFHexString ? u.decodeText() : undefined; };
const nameOf = (v: PDFObject | undefined) => (v instanceof PDFName ? v.decodeText() : undefined);

export async function cleanCopy(file: InFile, c: CleanOptions, o: OpOptions, e: Engines): Promise<CleanResult> {
  checkAbort(o.signal);
  // Owner rule: a protected file is only decrypted for a clean copy when its password may remove the protection (D13).
  const plain = await authorise(file, e);
  const opened = await openPdf({ name: file.name, bytes: plain.bytes }, e, o.signal);
  const before = await safetyScan({ name: file.name, bytes: opened.bytes }, e);
  o.onProgress?.(1, 4);

  checkAbort(o.signal);
  const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: true });
  const ctx = doc.context;
  const dict = (v: PDFObject | undefined) => (v ? ctx.lookup(v) : undefined);
  const badAction = (a: PDFObject | undefined, depth = 0): boolean => {
    const d = dict(a);
    if (depth > 32) return true;
    if (d instanceof PDFArray) return d.asArray().some((x) => badAction(x, depth + 1));
    if (!(d instanceof PDFDict)) return false;
    const s = nameOf(d.lookup(N("S")));
    return (s !== undefined && (BAD_ACTIONS.has(s) || (s === "URI" && !(c.keepLinks && isSafeLink(uriText(d)))))) || d.has(N("JS")) || badAction(d.get(N("Next")), depth + 1);
  };
  const dropSub = new Set(["FileAttachment", "RichMedia"]);
  const seen = new Set<PDFObject>();
  const visit = (v: PDFObject | undefined) => {
    if (!v || v instanceof PDFRef || seen.has(v)) return;
    seen.add(v);
    const d = v instanceof PDFStream ? v.dict : v;
    if (d instanceof PDFArray) return d.asArray().forEach(visit);
    if (!(d instanceof PDFDict)) return;
    if (badAction(d.get(N("A")))) d.delete(N("A"));
    for (const k of ["OpenAction", "AA", "JS", "XFA", "AF"]) d.delete(N(k));
    if (c.scrubPersonal) d.delete(N("Metadata"));
    const names = dict(d.get(N("Names")));
    if (names instanceof PDFDict) for (const k of ["JavaScript", "EmbeddedFiles"]) names.delete(N(k));
    const annots = dict(d.get(N("Annots")));
    if (annots instanceof PDFArray) {
      const keep = annots.asArray().filter((a) => !dropSub.has(nameOf(dict(a) instanceof PDFDict ? (dict(a) as PDFDict).get(N("Subtype")) : undefined) ?? ""));
      if (c.scrubPersonal) for (const a of keep) {
        const ad = dict(a);
        if (!(ad instanceof PDFDict)) continue;
        // A form field's /T is its name, not a person: only notes, popups and the like lose it.
        for (const k of nameOf(ad.get(N("Subtype"))) === "Widget" ? ["M", "CreationDate"] : ["T", "M", "CreationDate"]) ad.delete(N(k));
        const pop = dict(ad.get(N("Popup")));
        if (pop instanceof PDFDict) for (const k of ["T", "M", "CreationDate"]) pop.delete(N(k));
      }
      if (keep.length !== annots.size()) d.set(N("Annots"), ctx.obj(keep));
    }
    for (const x of d.values()) visit(x);
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj);
  visit(ctx.trailerInfo.Root);
  const rawBytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });

  // qpdf re-write: writes only objects still reachable (drops the orphaned actions and files) and no object streams.
  checkAbort(o.signal);
  o.onProgress?.(2, 4);
  const r = await e.qpdf(["--object-streams=disable", "/in.pdf", "/out.pdf"], { "/in.pdf": rawBytes }, ["/out.pdf"]);
  const bytes = r.files["/out.pdf"];
  if (!bytes || r.code === 2) throw new PdfError("corrupt", `A clean copy of "${file.name}" couldn't be made. The original is unchanged.`, file.name);
  const after = await safetyScan({ name: file.name, bytes }, e);
  o.onProgress?.(4, 4);

  const kept = (i: SafetyItem) => i.severity === "info" || (c.keepLinks && i.kind === "uri" && isSafeLink(i.detail));
  const warnings: Warning[] = [];
  const left = after.items.filter((i) => !kept(i));
  if (left.length) warnings.push({ code: "residual-risk", message: `The copy still contains ${left.length} flagged item${left.length === 1 ? "" : "s"}. Don't treat it as cleaned.` });
  if (before.items.some((i) => i.kind === "submit-form")) warnings.push({ code: "submit-removed", message: "Buttons that sent the form to a web address no longer do. The fields can still be filled in." });
  if (before.items.some((i) => i.kind === "xfa")) warnings.push({ code: "xfa-removed", message: "The dynamic (XFA) part of the form was removed. Ordinary form fields are kept; some very old forms may look empty." });
  if (plain.encrypted) warnings.push({ code: "encryption-removed", message: "The clean copy has no password. Protect it again if you need that." });
  if (opened.info.repaired) warnings.push({ code: "repaired", message: `"${file.name}" was damaged and has been repaired. Some content may be missing, so check the result.` });
  if (opened.info.hasSignatures) warnings.push({ code: "signature-invalidated", message: `"${file.name}" is digitally signed. Cleaning it makes the signature invalid.` });
  const removed = before.items.filter((i) => !kept(i));
  return { bytes, name: `${safeName(file.name, "document").slice(0, -4)}-clean.pdf`, warnings, removed, remaining: after.items };
}
