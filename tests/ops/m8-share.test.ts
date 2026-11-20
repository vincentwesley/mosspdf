import { PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { isSafeLink } from "../../src/core/links";
import { cleanCopy, safetyScan } from "../../src/ops";
import { engines, opts } from "../helpers/env";

/** One page with: a Text note by "Alice Reviewer" (date, popup with the name too), a page /Metadata XMP packet, an image-less XObject with /Metadata,
 *  and link annotations for every action kind the clean copy must handle. */
async function fixture(): Promise<{ name: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 300]);
  const c = doc.context;
  const reg = (o: unknown) => c.register(c.obj(o as never));
  const link = (A: unknown) => reg({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 50, 30], Border: [0, 0, 0], A });
  const S = (s: string) => PDFString.of(s);
  const popup = reg({ Type: "Annot", Subtype: "Popup", Rect: [100, 100, 200, 200], T: S("Alice Reviewer") });
  const note = reg({ Type: "Annot", Subtype: "Text", Rect: [60, 60, 80, 80], T: S("Alice Reviewer"), M: S("D:20260101120000Z"), CreationDate: S("D:20260101120000Z"), Contents: S("see this"), Popup: popup });
  const field = reg({ Type: "Annot", Subtype: "Widget", FT: "Tx", T: S("full_name"), Rect: [10, 100, 90, 120] });
  const annots = [
    note, popup, field,
    link({ S: "URI", URI: S("https://example.com/a") }),
    link({ S: "URI", URI: S("mailto:a@example.com") }),
    link({ S: "URI", URI: S("javascript:app.alert(1)") }),
    link({ S: "URI", URI: S("file:///C:/Windows/System32/calc.exe") }),
    link({ S: "URI", URI: S("java\nscript:app.alert(1)") }),
    link({ S: "Rendition", OP: 0 }), link({ S: "Movie", Title: S("m") }), link({ S: "Sound", Sound: reg({}) }),
    link({ S: "Hide", T: S("full_name") }), link({ S: "RichMediaExecute" }),
  ];
  page.node.set(PDFName.of("Annots"), c.obj(annots));
  const xmp = (n: string) => c.stream(`<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>${n}</dc:creator></x:xmpmeta><?xpacket end="w"?>`, { Type: "Metadata", Subtype: "XML" });
  page.node.set(PDFName.of("Metadata"), c.register(xmp("Alice Reviewer")));
  const form = c.register(c.stream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1], Metadata: c.register(xmp("Bob Author")) }));
  page.node.set(PDFName.of("Resources"), c.obj({ XObject: { Fm0: form } }));
  return { name: "share.pdf", bytes: await doc.save({ useObjectStreams: false }) };
}

const qdf = async (bytes: Uint8Array) => {
  const r = await engines.qpdf(["--qdf", "--object-streams=disable", "/in.pdf", "/out.pdf"], { "/in.pdf": bytes }, ["/out.pdf"]);
  return new TextDecoder("latin1").decode(r.files["/out.pdf"]);
};

describe("Safe to share clean copy", () => {
  it("@A-SHARE-1 scrubPersonal removes annotation authors, dates and every XMP packet", async () => {
    const r = await cleanCopy(await fixture(), { keepLinks: true, scrubPersonal: true }, opts(), engines);
    const text = await qdf(r.bytes);
    expect(text).not.toContain("Alice Reviewer");
    expect(text).not.toContain("Bob Author");
    expect(text).not.toMatch(/xmpmeta|xpacket/);
    expect(text).not.toContain("D:20260101");
    expect(text).toContain("full_name"); // a form field's name is not a person
    expect(text).toContain("see this"); // the note itself stays
  });
  it("@A-SHARE-2 without scrubPersonal the names stay (plain Safety scan clean copy is unchanged)", async () => {
    const r = await cleanCopy(await fixture(), { keepLinks: true }, opts(), engines);
    expect(await qdf(r.bytes)).toContain("Alice Reviewer");
  });
  it("@A-SHARE-3 the scanner flags rendition, movie, sound, hide and rich media actions, and the copy removes them", async () => {
    const f = await fixture();
    const kinds = new Set((await safetyScan(f, engines)).items.map((i) => i.kind));
    expect(kinds.has("media-action")).toBe(true);
    expect(kinds.has("hide-action")).toBe(true);
    const r = await cleanCopy(f, { keepLinks: true, scrubPersonal: true }, opts(), engines);
    const left = r.remaining.filter((i) => i.severity !== "info" && i.kind !== "uri");
    expect(left).toEqual([]);
    const text = await qdf(r.bytes);
    expect(text).not.toMatch(/\/S \/(Rendition|Movie|Sound|Hide|RichMediaExecute)/);
  });
  it("@A-SHARE-4 kept links are web and mail only: javascript:, file: and disguised schemes go", async () => {
    const r = await cleanCopy(await fixture(), { keepLinks: true, scrubPersonal: true }, opts(), engines);
    const text = await qdf(r.bytes);
    expect(text).toContain("https://example.com/a");
    expect(text).toContain("mailto:a@example.com");
    expect(text).not.toMatch(/javascript:|file:\/\/|java\s*script:/i);
    expect(r.warnings.some((w) => w.code === "residual-risk")).toBe(false);
    expect(r.remaining.filter((i) => i.kind === "uri").map((i) => i.detail).sort()).toEqual(["https://example.com/a", "mailto:a@example.com"]);
  });
  it("@A-SHARE-5 isSafeLink", () => {
    for (const u of ["https://a.b", "HTTP://a.b", "mailto:x@y.z"]) expect(isSafeLink(u)).toBe(true);
    for (const u of ["javascript:1", " java\tscript:1", "file:///x", "data:text/html,x", "/relative", "", undefined]) expect(isSafeLink(u)).toBe(false);
  });
});
