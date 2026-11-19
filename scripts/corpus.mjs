// Deterministic test corpus -> tests/corpus/generated/ (gitignored). `node scripts/corpus.mjs [--force] [--external]`.
// Everything is self-generated with pdf-lib + the qpdf CLI; all names/data are made up (CC0, see tests/corpus/README.md).
// --external also downloads openly licensed real-world files into tests/corpus/external/ (sha256-pinned, optional).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { qpdfBin } from "./qpdf-bin.mjs";

const root = fileURLToPath(new URL("../tests/corpus/", import.meta.url));
const gen = root + "generated/";
const ext = root + "external/";
const force = process.argv.includes("--force");

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const newDoc = () => PDFDocument.create({ updateMetadata: false });
const fixedDate = new Date("2026-01-01T00:00:00Z");

/** Pages carry the marker text `PAGE-MARKER {prefix}{n}` so tests can read back which page is which. */
async function textDoc(n, prefix = "p", sizes) {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage(sizes ? sizes[(i - 1) % sizes.length] : [595.28, 841.89]);
    page.drawText(`PAGE-MARKER ${prefix}${i}`, { x: 50, y: page.getHeight() - 80, size: 24, font });
  }
  return doc;
}

const save = (doc) => doc.save({ useObjectStreams: false });

async function plain() {
  const doc = await textDoc(3);
  doc.setTitle("Quarterly notes (made up)");
  doc.setAuthor("Sample Author");
  doc.setProducer("pdf-lib (test default)");
  doc.setCreator("pdf-lib (test default)");
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  return doc;
}

async function links() {
  const doc = await textDoc(3);
  const ctx = doc.context;
  const [p1, , p3] = doc.getPages();
  const uri = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 700, 250, 730], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://example.com/") } }));
  const goto = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 650, 250, 680], Border: [0, 0, 0], Dest: [p3.ref, PDFName.of("Fit")] }));
  const note = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [300, 700, 320, 720], Contents: PDFString.of("Sample comment"), Name: "Comment" }));
  p1.node.set(PDFName.of("Annots"), ctx.obj([uri, goto, note]));
  return doc;
}

async function outline() {
  const doc = await textDoc(4);
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlines = ctx.nextRef();
  const items = pages.map(() => ctx.nextRef());
  items.forEach((ref, i) => {
    const d = { Title: PDFString.of(`Chapter ${i + 1}`), Parent: outlines, Dest: [pages[i].ref, PDFName.of("Fit")] };
    if (i > 0) d.Prev = items[i - 1];
    if (i < items.length - 1) d.Next = items[i + 1];
    ctx.assign(ref, ctx.obj(d));
  });
  ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: items[0], Last: items.at(-1), Count: items.length }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);
  return doc;
}

async function forms() {
  const doc = await textDoc(1);
  const page = doc.getPage(0);
  const form = doc.getForm();
  const t = form.createTextField("full_name");
  t.setText("Sample Person");
  t.addToPage(page, { x: 50, y: 600, width: 200, height: 24 });
  const c = form.createCheckBox("agree");
  c.addToPage(page, { x: 50, y: 560, width: 20, height: 20 });
  c.check();
  const r = form.createRadioGroup("choice");
  r.addOptionToPage("a", page, { x: 50, y: 520, width: 20, height: 20 });
  r.addOptionToPage("b", page, { x: 90, y: 520, width: 20, height: 20 });
  r.select("b");
  const d = form.createDropdown("country");
  d.addOptions(["Alpha", "Beta", "Gamma"]);
  d.select("Beta");
  d.addToPage(page, { x: 50, y: 470, width: 200, height: 24 });
  return doc;
}

async function signed() {
  const doc = await textDoc(1);
  const ctx = doc.context;
  const page = doc.getPage(0);
  const sig = ctx.register(ctx.obj({ Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached", ByteRange: [0, 0, 0, 0], Contents: PDFHexString.of("00".repeat(64)), Name: PDFString.of("Test Signer"), M: PDFString.of("D:20260101000000Z") }));
  const field = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFString.of("Signature1"), Rect: [50, 100, 250, 150], F: 4, V: sig, P: page.ref }));
  page.node.set(PDFName.of("Annots"), ctx.obj([field]));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [field], SigFlags: 3 }));
  return doc;
}

async function js() {
  const doc = await textDoc(1);
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of('app.alert("hello");') }));
  return doc;
}

// 5 pages of seeded RGB noise, Flate-compressed at level 1 (noise does not shrink): ~20 MB.
async function imageHeavy() {
  const doc = await newDoc();
  const next = rng(42);
  const w = 1300, h = 1000;
  for (let i = 0; i < 5; i++) {
    const raw = Buffer.alloc(w * h * 3);
    for (let j = 0; j < raw.length; j += 4) raw.writeUInt32LE((next() * 4294967296) >>> 0, j);
    const ref = doc.context.register(doc.context.stream(deflateSync(raw, { level: 1 }), { Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode" }));
    const page = doc.addPage([650, 500]);
    const name = page.node.newXObject("Im", ref);
    page.node.addContentStream(doc.context.register(doc.context.stream(`q 650 0 0 500 0 0 cm /${name.decodeText()} Do Q`)));
  }
  return doc;
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function qpdf(args) {
  execFileSync(qpdfBin(), args, { stdio: ["ignore", "ignore", "inherit"] });
}

// ---- M3 safety fixtures (one per risky element; see tests/corpus/README.md) ----
const S = (s) => PDFString.of(s);
const reg = (doc, d) => doc.context.register(doc.context.obj(d));
const annots = (doc, pageIdx, refs) => {
  const node = doc.getPage(pageIdx).node;
  const cur = node.lookup(PDFName.of("Annots"));
  node.set(PDFName.of("Annots"), doc.context.obj([...(cur ? cur.asArray() : []), ...refs]));
};
const linkWith = (doc, y, A) => reg(doc, { Type: "Annot", Subtype: "Link", Rect: [50, y, 250, y + 24], Border: [0, 0, 0], A });
const fileStream = (doc, text) => doc.context.register(doc.context.stream(text, { Type: "EmbeddedFile" }));
const filespec = (doc, name, text) => reg(doc, { Type: "Filespec", F: S(name), UF: S(name), EF: { F: fileStream(doc, text) } });

const addField = (doc, ref) => {
  const af = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (af) af.set(PDFName.of("Fields"), doc.context.obj([...af.lookup(PDFName.of("Fields")).asArray(), ref]));
  else doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({ Fields: [ref] }));
};

const riskAdders = {
  js: (doc) => doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ Type: "Action", S: "JavaScript", JS: S('app.alert("hello");') })),
  jsNames: (doc) => doc.catalog.set(PDFName.of("Names"), doc.context.obj({ JavaScript: { Names: [S("init"), doc.context.obj({ S: "JavaScript", JS: S("var x = 1;") })] } })),
  // /AA with a harmless Named action, so only the /AA itself is flagged
  aa: (doc) => doc.getPage(0).node.set(PDFName.of("AA"), doc.context.obj({ O: { S: "Named", N: "NextPage" } })),
  launch: (doc) => annots(doc, 0, [linkWith(doc, 700, { S: "Launch", F: S("sample-app.exe") })]),
  embedded: (doc) => {
    const spec = filespec(doc, "notes.txt", "made-up attachment");
    const names = doc.catalog.lookup(PDFName.of("Names"));
    const ef = doc.context.obj({ Names: [S("notes.txt"), spec] });
    if (names) names.set(PDFName.of("EmbeddedFiles"), ef);
    else doc.catalog.set(PDFName.of("Names"), doc.context.obj({ EmbeddedFiles: ef }));
    annots(doc, 1, [reg(doc, { Type: "Annot", Subtype: "FileAttachment", Rect: [60, 600, 80, 620], Name: "Paperclip", FS: filespec(doc, "data.csv", "a,b\n1,2\n") })]);
  },
  submit: (doc) => {
    const w = reg(doc, { Type: "Annot", Subtype: "Widget", FT: "Btn", Ff: 65536, T: S("send"), Rect: [50, 560, 150, 590], F: 4, P: doc.getPage(0).ref, A: { S: "SubmitForm", F: { FS: "URL", F: S("https://example.com/submit") }, Flags: 4 } });
    annots(doc, 0, [w]);
    addField(doc, w);
  },
  importData: (doc) => annots(doc, 0, [linkWith(doc, 520, { S: "ImportData", F: S("data.fdf") })]),
  uri: (doc) => annots(doc, 0, [linkWith(doc, 480, { S: "URI", URI: S("https://example.com/a") }), linkWith(doc, 440, { S: "URI", URI: S("https://example.org/b?x=1") })]),
  gotor: (doc) => annots(doc, 0, [linkWith(doc, 400, { S: "GoToR", F: S("other.pdf"), D: [0, PDFName.of("Fit")] })]),
  gotoe: (doc) => annots(doc, 0, [linkWith(doc, 360, { S: "GoToE", F: S("other.pdf"), D: [0, PDFName.of("Fit")] })]),
  richmedia: (doc) => annots(doc, 1, [reg(doc, { Type: "Annot", Subtype: "RichMedia", Rect: [50, 300, 250, 400], RichMediaContent: { Assets: { Names: [] } } })]),
  xfa: (doc) => {
    const af = doc.catalog.lookup(PDFName.of("AcroForm"));
    af.set(PDFName.of("XFA"), doc.context.obj([S("template"), doc.context.register(doc.context.stream("<xdp:xdp xmlns:xdp='http://ns.adobe.com/xdp/'/>"))]));
  },
  // annotation-level /AA (a form field's on-focus action)
  annotAa: (doc) => {
    const w = reg(doc, { Type: "Annot", Subtype: "Widget", FT: "Tx", T: S("aa_field"), Rect: [300, 560, 400, 580], F: 4, P: doc.getPage(0).ref, AA: { Fo: { S: "Named", N: "NextPage" } } });
    annots(doc, 0, [w]);
    addField(doc, w);
  },
  jbig2: (doc) => {
    const img = doc.context.register(doc.context.stream("00", { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 1, Filter: "JBIG2Decode" }));
    doc.getPage(0).node.newXObject("Im", img);
  },
};

async function riskDoc(kinds) {
  const doc = await (kinds.includes("xfa") ? forms() : textDoc(2));
  if (doc.getPageCount() < 2) doc.addPage([595.28, 841.89]);
  for (const k of kinds) riskAdders[k](doc);
  return doc;
}

async function buildSafety(w) {
  const sv = (d, objStm = false) => d.save({ useObjectStreams: objStm, updateFieldAppearances: false }); // the default would let pdf-lib drop the XFA
  const wd = async (name, doc) => w(name, await sv(await doc));
  for (const [file, kinds] of [
    ["risk-js-openaction", ["js"]],
    ["risk-js-names", ["jsNames"]],
    ["risk-page-aa", ["aa"]],
    ["risk-annot-aa", ["annotAa"]],
    ["risk-launch", ["launch"]],
    ["risk-embedded", ["embedded"]],
    ["risk-submit", ["submit"]],
    ["risk-importdata", ["importData"]],
    ["risk-uri", ["uri"]],
    ["risk-gotor", ["gotor"]],
    ["risk-gotoe", ["gotoe"]],
    ["risk-richmedia", ["richmedia"]],
    ["risk-xfa", ["xfa"]],
    ["risk-jbig2", ["jbig2"]],
  ]) await wd(`${file}.pdf`, riskDoc(kinds));
  const every = await riskDoc(Object.keys(riskAdders).filter((k) => k !== "jbig2" && k !== "annotAa" && k !== "submit"));
  riskAdders.submit(every); // forms() already has an AcroForm
  riskAdders.annotAa(every);
  await wd("risk-everything.pdf", every); // classic objects
  w("risk-everything-objstm.pdf", await sv(every, true)); // same content inside object streams
  qpdf(["--encrypt", "user-pass", "owner-pass", "256", "--", gen + "risk-everything.pdf", gen + "risk-everything-encrypted.pdf"]);
  // owner password only: opens with no password, but print/copy/modify are restricted
  qpdf(["--encrypt", "", "owner-pass", "256", "--print=none", "--extract=n", "--modify=none", "--annotate=n", "--form=n", "--", gen + "plain-3p.pdf", gen + "restricted-owner-only.pdf"]);
  // user + different owner password, with restrictions
  qpdf(["--encrypt", "user-pass", "owner-pass", "256", "--print=none", "--extract=n", "--", gen + "plain-3p.pdf", gen + "encrypted-user-owner.pdf"]);
}

export async function buildCorpus() {
  if (!force && existsSync(gen + "DONE")) return;
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(gen, { recursive: true });
  const w = (name, bytes) => writeFileSync(gen + name, bytes);
  const wd = async (name, doc) => w(name, await save(await doc));

  await wd("plain-3p.pdf", plain());
  await wd("mixed-sizes.pdf", textDoc(3, "m", [[595.28, 841.89], [612, 792], [1190.55, 841.89]]));
  const rot = await textDoc(4, "r");
  rot.getPages().forEach((p, i) => p.setRotation(degrees(i * 90)));
  await wd("rotated.pdf", rot);
  await wd("links-annots.pdf", links());
  await wd("outline.pdf", outline());
  await wd("forms.pdf", forms());
  await wd("signed.pdf", signed());
  await wd("javascript.pdf", js());
  await wd("text-1000p.pdf", textDoc(1000, "k"));
  await wd("text-500p.pdf", textDoc(500, "k"));
  await wd("image-heavy.pdf", imageHeavy());

  const plainBytes = readFileSync(gen + "plain-3p.pdf");
  qpdf(["--encrypt", "test-pass", "test-pass", "256", "--", gen + "plain-3p.pdf", gen + "encrypted-aes256.pdf"]);
  qpdf(["--allow-weak-crypto", "--encrypt", "test-pass", "test-pass", "40", "--", gen + "plain-3p.pdf", gen + "encrypted-rc4-40.pdf"]);

  const next = rng(7);
  const corrupt = Buffer.from(plainBytes);
  const mid = corrupt.length >> 1;
  for (let i = mid - 300; i < mid + 300; i++) corrupt[i] = (next() * 256) | 0;
  w("corrupt.pdf", corrupt);
  w("truncated.pdf", plainBytes.subarray(0, Math.floor(plainBytes.length * 0.6)));
  w("empty.pdf", new Uint8Array(0));
  w("renamed-png.pdf", PNG);
  w("renamed-text.pdf", "This is just a text file with a .pdf name.\n");
  // 10 extra bytes after the header: every xref offset is now wrong, qpdf must rebuild the table.
  w("broken-xref.pdf", Buffer.concat([plainBytes.subarray(0, 9), Buffer.from("%padding0\n"), plainBytes.subarray(9)]));
  await buildSafety(w);
  writeFileSync(gen + "DONE", "ok");
}

// Public-domain US federal form (17 USC 105). Pinned; skipped quietly when offline or when the IRS has republished it.
const EXTERNAL = [{ name: "irs-fw9.pdf", url: "https://www.irs.gov/pub/irs-pdf/fw9.pdf", sha256: "2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53" }];

async function external() {
  mkdirSync(ext, { recursive: true });
  for (const f of EXTERNAL) {
    try {
      const bytes = Buffer.from(await (await fetch(f.url)).arrayBuffer());
      const sum = createHash("sha256").update(bytes).digest("hex");
      if (f.sha256 && sum !== f.sha256) { console.warn(`${f.name}: sha256 changed (${sum}), skipped`); continue; }
      writeFileSync(ext + f.name, bytes);
      console.log(`${f.name} ${sum}`);
    } catch (e) {
      console.warn(`${f.name}: download failed (${e.message}), skipped`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildCorpus();
  if (process.argv.includes("--external")) await external();
}
