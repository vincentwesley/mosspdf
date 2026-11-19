// Deterministic test corpus -> tests/corpus/generated/ (gitignored). `node scripts/corpus.mjs [--force] [--external]`.
// Everything is self-generated with pdf-lib + the qpdf CLI; all names/data are made up (CC0, see tests/corpus/README.md).
// --external also downloads openly licensed real-world files into tests/corpus/external/ (sha256-pinned, optional).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { crc32, deflateSync } from "node:zlib";
import { init as initJpegEnc, default as jpegEncode } from "@jsquash/jpeg/encode.js";
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
  const req = createRequire(import.meta.url);
  await initJpegEnc(await globalThis.WebAssembly.compile(readFileSync(req.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"))));
  const jpg = Buffer.from(await jpegEncode(photo(1600, 1200, 3), { quality: 95 }));
  w("photo.jpg", jpg);
  w("photo-small.jpg", Buffer.from(await jpegEncode(photo(400, 300, 4), { quality: 85 })));
  w("photo-alpha.png", pngEncode(400, 300, Object.assign(photo(400, 300, 9).data, {})));
  await wd("image-mixed.pdf", imageMixed(jpg));
  await wd("xmp.pdf", xmpDoc());
  const rot2 = await textDoc(4, "c");
  rot2.getPages().forEach((p, i) => { p.setRotation(degrees(i * 90)); if (i === 1) p.setCropBox(50, 100, 400, 500); });
  await wd("rotated-crop.pdf", rot2);

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
