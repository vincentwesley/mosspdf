// Deterministic test corpus -> tests/corpus/generated/ (gitignored). `node scripts/corpus.mjs [--force] [--external]`.
// Everything is self-generated with pdf-lib + the qpdf CLI; all names/data are made up (CC0, see tests/corpus/README.md).
// --external also downloads openly licensed real-world files into tests/corpus/external/ (sha256-pinned, optional).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { crc32, deflateSync } from "node:zlib";
import { init as initJpegEnc, default as jpegEncode } from "@jsquash/jpeg/encode.js";
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { qpdfBin } from "./qpdf-bin.mjs";
import { grayPng, scanGray, SCAN_LINES } from "./scan-image.mjs";

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

/** One page per entry, one line per string (M7 compare fixtures). `mark` draws a small picture at that spot (x, y from the bottom left). */
async function linesDoc(pages, mark) {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = mark ? await doc.embedPng(pngEncode(64, 64, photo(64, 64, 5).data)) : undefined;
  for (const lines of pages) {
    const page = doc.addPage([595.28, 841.89]);
    lines.forEach((t, i) => page.drawText(t, { x: 50, y: 780 - i * 24, size: i ? 14 : 22, font }));
    if (png) page.drawImage(png, { x: mark[0], y: mark[1], width: 64, height: 64 });
  }
  return doc;
}
const CMP_P1 = ["Quarterly report", "The team shipped three features this quarter.", "Revenue grew by ten percent over last year."];
const CMP_TEXT = [CMP_P1, ["Plan for next quarter", "We will hire two engineers in March.", "The budget stays the same as before."], ["Appendix", "Contact the office for the full figures."]];

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


// M4: a richer form (two pages, the second turned 90 degrees) and an XFA-only form (no standard fields).
async function forms2() {
  const doc = await textDoc(2, "f");
  const [p1, p2] = doc.getPages();
  p2.setRotation(degrees(90));
  const form = doc.getForm();
  form.createTextField("full_name").addToPage(p1, { x: 50, y: 600, width: 200, height: 24 });
  const notes = form.createTextField("notes");
  notes.enableMultiline();
  notes.addToPage(p1, { x: 50, y: 500, width: 250, height: 80 });
  const code = form.createTextField("code");
  code.setMaxLength(4);
  code.addToPage(p1, { x: 300, y: 600, width: 80, height: 24 });
  form.createCheckBox("agree").addToPage(p1, { x: 50, y: 460, width: 20, height: 20 });
  const r = form.createRadioGroup("choice");
  r.addOptionToPage("a", p1, { x: 50, y: 420, width: 20, height: 20 });
  r.addOptionToPage("b", p1, { x: 90, y: 420, width: 20, height: 20 });
  const d = form.createDropdown("country");
  d.addOptions(["Alpha", "Beta", "Gamma"]);
  d.addToPage(p1, { x: 50, y: 370, width: 200, height: 24 });
  const l = form.createOptionList("interests");
  l.addOptions(["Chess", "Go", "Shogi"]);
  l.addToPage(p1, { x: 300, y: 340, width: 120, height: 60 });
  const ro = form.createTextField("ref_no");
  ro.setText("REF-001");
  ro.enableReadOnly();
  ro.addToPage(p1, { x: 300, y: 420, width: 100, height: 24 });
  form.createTextField("page2_note").addToPage(p2, { x: 60, y: 600, width: 200, height: 24 });
  return doc;
}

async function xfaOnly() {
  const doc = await textDoc(1);
  const ctx = doc.context;
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [], XFA: [PDFString.of("template"), ctx.register(ctx.stream("<xdp:xdp xmlns:xdp='http://ns.adobe.com/xdp/'/>"))] }));
  return doc;
}

async function js() {
  const doc = await textDoc(1);
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of('app.alert("hello");') }));
  return doc;
}

// 5 pages of seeded RGB noise, Flate-compressed at level 1 (noise does not shrink): ~20 MB.
/** Image-only pages that look scanned (no text objects): A4 at 150 dpi. `withText` puts a real-text page first. */
async function scanned(withText) {
  const doc = withText ? await textDoc(1, "t") : await newDoc();
  const img = await doc.embedPng(grayPng(scanGray(SCAN_LINES)));
  doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return doc;
}

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

// Smooth, photo-like RGB gradient with a little seeded grain (compresses like a photo, not like noise).
function photo(w, h, seed) {
  const next = rng(seed);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = next() * 10;
      px[i] = 128 + 100 * Math.sin(x / 90 + seed) + g;
      px[i + 1] = 128 + 100 * Math.sin(y / 70) + g;
      px[i + 2] = 128 + 100 * Math.sin((x + y) / 130) + g;
      px[i + 3] = 255;
    }
  return { data: px, width: w, height: h };
}

function pngEncode(w, h, rgba) {
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "latin1");
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const addImage = (doc, page, dict, bytes) => {
  const ref = doc.context.register(doc.context.stream(bytes, { Type: "XObject", Subtype: "Image", ...dict }));
  const name = page.node.newXObject("Im", ref);
  page.node.addContentStream(doc.context.register(doc.context.stream(`q 500 0 0 400 0 0 cm /${name.decodeText()} Do Q`)));
};

// JPEG (DCT), Flate gray with a PNG Sub predictor, Flate RGB + SMask (must be left alone), and a tiny image (below the size floor).
async function imageMixed(jpeg) {
  const doc = await newDoc();
  const mk = () => doc.addPage([500, 400]);
  addImage(doc, mk(), { Width: 1600, Height: 1200, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" }, jpeg);
  const gw = 1200, gh = 900;
  const gray = Buffer.alloc((gw + 1) * gh);
  for (let y = 0; y < gh; y++) {
    gray[y * (gw + 1)] = 1; // Sub
    let prev = 0;
    for (let x = 0; x < gw; x++) {
      const v = Math.round(128 + 100 * Math.sin(x / 80) * Math.cos(y / 60));
      gray[y * (gw + 1) + 1 + x] = (v - prev) & 255;
      prev = v;
    }
  }
  addImage(doc, mk(), { Width: gw, Height: gh, ColorSpace: "DeviceGray", BitsPerComponent: 8, Filter: "FlateDecode", DecodeParms: { Predictor: 15, Colors: 1, Columns: gw, BitsPerComponent: 8 } }, deflateSync(gray));
  const sw = 800, sh = 600;
  const rgb = Buffer.alloc(sw * sh * 3);
  const next = rng(5);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (next() * 256) | 0;
  const smask = doc.context.register(doc.context.stream(deflateSync(Buffer.alloc(sw * sh, 200)), { Type: "XObject", Subtype: "Image", Width: sw, Height: sh, ColorSpace: "DeviceGray", BitsPerComponent: 8, Filter: "FlateDecode" }));
  addImage(doc, mk(), { Width: sw, Height: sh, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode", SMask: smask }, deflateSync(rgb));
  addImage(doc, mk(), { Width: 20, Height: 20, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode" }, deflateSync(Buffer.alloc(20 * 20 * 3, 90)));
  return doc;
}

const XMP = `<?xpacket begin=""?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" pdf:Producer="Old Producer" xmp:CreatorTool="Old Tool">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP Title Old</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>XMP Author Old</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">XMP Subject Old</rdf:li></rdf:Alt></dc:description>
<pdf:Keywords>old, keys</pdf:Keywords>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

async function xmpDoc() {
  const doc = await textDoc(2, "x");
  doc.setTitle("Info Title Old");
  doc.setAuthor("Info Author Old");
  doc.setSubject("Info Subject Old");
  doc.setKeywords(["old", "keys"]);
  doc.setProducer("Old Producer");
  doc.setCreator("Old Tool");
  const ref = doc.context.register(doc.context.stream(Buffer.from(XMP), { Type: "Metadata", Subtype: "XML" }));
  doc.catalog.set(PDFName.of("Metadata"), ref);
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

// Rebuild whenever this generator changes, so a stale corpus never hides a missing fixture.
const stamp = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");

// M6: made-up personal details (a valid-checksum NRIC, phone, email, address) in the page text, Info title, an outline entry and an annotation.
async function redactSample() {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const p1 = doc.addPage([595.28, 841.89]);
  const p2 = doc.addPage([595.28, 841.89]);
  [["Applicant: Tan Wei Ming", 700], ["NRIC: S1234567D", 670], ["Phone: 9123 4567", 640], ["Email: wei.ming@example.com", 610],
    ["Address: Blk 123 Ang Mo Kio Ave 6, #12-34, Singapore 560123", 580], ["KEEP-THIS-SENTENCE stays searchable", 540]].forEach(([s, y]) => p1.drawText(s, { x: 50, y, size: 14, font }));
  p2.drawText("PAGE-MARKER r2 nothing private here", { x: 50, y: 700, size: 14, font });
  doc.setTitle("Application for S1234567D");
  doc.setAuthor("Tan Wei Ming");
  doc.setCreationDate(fixedDate);
  const note = reg(doc, { Type: "Annot", Subtype: "Text", Rect: [300, 640, 320, 660], Contents: PDFString.of("Call 9123 4567"), Name: "Comment" });
  p1.node.set(PDFName.of("Annots"), ctx.obj([note]));
  const outlines = ctx.nextRef(), item = ctx.nextRef();
  ctx.assign(item, ctx.obj({ Title: PDFString.of("Contact wei.ming@example.com"), Parent: outlines, Dest: [p1.ref, PDFName.of("Fit")] }));
  ctx.assign(outlines, ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);
  return doc;
}

// A JPEG with an EXIF block: camera, date and a GPS latitude (made up, city-level). Little-endian TIFF built by hand.
function withExif(jpeg) {
  const ascii = (s) => Buffer.from(s + "\0", "latin1");
  const make = ascii("PagerCam"), model = ascii("PH-1"), date = ascii("2026:01:02 03:04:05");
  const entry = (tag, type, count, value) => { const b = Buffer.alloc(12); b.writeUInt16LE(tag, 0); b.writeUInt16LE(type, 2); b.writeUInt32LE(count, 4); b.writeUInt32LE(value, 8); return b; };
  const ifd = (entries) => { const n = Buffer.alloc(2); n.writeUInt16LE(entries.length, 0); return Buffer.concat([n, ...entries, Buffer.alloc(4)]); };
  const rational = Buffer.alloc(24);
  [[1, 1], [17, 1], [0, 1]].forEach(([a, b], i) => { rational.writeUInt32LE(a, i * 8); rational.writeUInt32LE(b, i * 8 + 4); });
  const head = Buffer.from("II*\0\x08\0\0\0", "latin1");
  const [offMake, offModel, offExif, offDate, offGps, offLat] = [62, 71, 76, 94, 114, 144];
  const tiff = Buffer.concat([head,
    ifd([entry(0x010f, 2, make.length, offMake), entry(0x0110, 2, model.length, offModel), entry(0x8769, 4, 1, offExif), entry(0x8825, 4, 1, offGps)]),
    make, model, ifd([entry(0x9003, 2, date.length, offDate)]), date,
    ifd([entry(1, 2, 2, "N\0".charCodeAt(0)), entry(2, 5, 3, offLat)]), rational]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, body, jpeg.subarray(2)]);
}
export async function buildCorpus() {
  if (!force && existsSync(gen + "DONE") && readFileSync(gen + "DONE", "utf8") === stamp) return;
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
  await wd("forms-2p.pdf", forms2());
  await wd("xfa-only.pdf", xfaOnly());
  await wd("javascript.pdf", js());
  await wd("text-1000p.pdf", textDoc(1000, "k"));
  await wd("text-500p.pdf", textDoc(500, "k"));
  await wd("image-heavy.pdf", imageHeavy());
  await wd("scan-1p.pdf", scanned(false));
  await wd("scan-mixed-2p.pdf", scanned(true));
  const req = createRequire(import.meta.url);
  await initJpegEnc(await globalThis.WebAssembly.compile(readFileSync(req.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"))));
  const jpg = Buffer.from(await jpegEncode(photo(1600, 1200, 3), { quality: 95 }));
  w("photo.jpg", jpg);
  w("photo-small.jpg", Buffer.from(await jpegEncode(photo(400, 300, 4), { quality: 85 })));
  w("photo-alpha.png", pngEncode(400, 300, Object.assign(photo(400, 300, 9).data, {})));
  await wd("image-mixed.pdf", imageMixed(jpg));
  await wd("xmp.pdf", xmpDoc());
  await wd("redact-sample.pdf", redactSample());
  w("photo-gps.jpg", withExif(Buffer.from(await jpegEncode(photo(400, 300, 5), { quality: 90 }))));
  const rot2 = await textDoc(4, "c");
  rot2.getPages().forEach((p, i) => { p.setRotation(degrees(i * 90)); if (i === 1) p.setCropBox(50, 100, 400, 500); });
  await wd("rotated-crop.pdf", rot2);

  // M7 compare: v2 changes a sentence, inserts a paragraph and drops the last page; the moved pair has the same text and a picture elsewhere
  await wd("compare-v1.pdf", linesDoc(CMP_TEXT));
  await wd("compare-v2.pdf", linesDoc([CMP_P1, ["Plan for next quarter", "We will hire three engineers in April.", "A new paragraph about security training was added here.", "The budget stays the same as before."]]));
  await wd("compare-moved-a.pdf", linesDoc(CMP_TEXT, [400, 500]));
  await wd("compare-moved-b.pdf", linesDoc(CMP_TEXT, [100, 200]));

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
  writeFileSync(gen + "DONE", stamp);
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
