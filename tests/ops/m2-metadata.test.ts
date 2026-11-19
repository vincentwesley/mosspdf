import { describe, expect, it } from "vitest";
import { readMetadata, writeMetadata } from "../../src/ops";
import { xmpGet, xmpSet } from "../../src/ops/xmp";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readInfo, readPdf } from "../helpers/qpdf";

const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const xmpOf = (b: Uint8Array) => /<x:xmpmeta[\s\S]*<\/x:xmpmeta>/.exec(text(b))?.[0] ?? "";

describe("A-COR-10 metadata", () => {
  it("A-COR-10 reads Info and XMP", async () => {
    const m = await readMetadata(corpus("xmp"), engines);
    expect(m).toMatchObject({ title: "Info Title Old", author: "Info Author Old", subject: "Info Subject Old", producer: "Old Producer", hasXmp: true });
    expect(m.keywords).toBe("old keys");
    expect((await readMetadata(corpus("plain-3p"), engines)).hasXmp).toBe(false);
  });
  it("A-COR-10 round trip: Info and XMP both updated and consistent, other pages and text intact", async () => {
    const r = await writeMetadata(corpus("xmp"), { title: "New & <Title>", author: "New Author", subject: "New Subject", keywords: "a, b" }, opts(), engines);
    qpdfCheck(r.bytes);
    const m = await readMetadata({ name: "x.pdf", bytes: r.bytes }, engines);
    expect(m).toMatchObject({ title: "New & <Title>", author: "New Author", subject: "New Subject", keywords: "a, b", producer: "Pagehold by Vin's Atelier" });
    const x = xmpOf(r.bytes);
    expect(xmpGet(x, "dc:title")).toBe("New & <Title>");
    expect(xmpGet(x, "dc:creator")).toBe("New Author");
    expect(xmpGet(x, "dc:description")).toBe("New Subject");
    expect(xmpGet(x, "pdf:Keywords")).toBe("a, b");
    expect(xmpGet(x, "pdf:Producer")).toBe("Pagehold by Vin's Atelier");
    expect(x).not.toContain("Old Producer");
    expect(x).not.toContain("XMP Title");
    expect((await readInfo(r.bytes)).Title).toBe("New & <Title>");
    expect((await readPdf(r.bytes)).length).toBe(2);
  });
  it("A-COR-10 partial edit leaves other fields; empty string clears (Info and XMP)", async () => {
    const r = await writeMetadata(corpus("xmp"), { author: "" }, opts({ producerCredit: false }), engines);
    const m = await readMetadata({ name: "x.pdf", bytes: r.bytes }, engines);
    expect(m.title).toBe("Info Title Old");
    expect(m.author).toBeUndefined();
    expect(xmpGet(xmpOf(r.bytes), "dc:creator")).toBeUndefined();
    expect(m.producer).toBe("Old Producer");
  });
  it("A-COR-10 removeAll drops Info and XMP and leaves no trace in the file", async () => {
    const r = await writeMetadata(corpus("xmp"), { removeAll: true }, opts(), engines);
    qpdfCheck(r.bytes);
    const m = await readMetadata({ name: "x.pdf", bytes: r.bytes }, engines);
    expect(m).toMatchObject({ hasXmp: false, title: undefined, author: undefined, producer: undefined, creator: undefined });
    const t = text(r.bytes);
    for (const s of ["Info Title Old", "Info Author Old", "XMP Title Old", "Old Producer", "Pagehold by Vin", "x:xmpmeta"]) expect(t, s).not.toContain(s);
    expect((await readPdf(r.bytes)).length).toBe(2);
    const p = await writeMetadata(corpus("plain-3p"), { removeAll: true }, opts(), engines);
    expect(text(p.bytes)).not.toContain("Quarterly notes");
    expect(text(p.bytes)).not.toContain("Sample Author");
  });
  it("A-COR-10 file without XMP gets Info only; credit on/off", async () => {
    const on = await writeMetadata(corpus("plain-3p"), { title: "T" }, opts(), engines);
    expect(xmpOf(on.bytes)).toBe("");
    expect((await readInfo(on.bytes)).Producer).toBe("Pagehold by Vin's Atelier");
    const off = await writeMetadata(corpus("plain-3p"), { title: "T" }, opts({ producerCredit: false }), engines);
    expect((await readInfo(off.bytes)).Producer).toBe("pdf-lib (test default)");
  });
  it("A-COR-10 bad inputs and cancellation", async () => {
    await expect(readMetadata(corpus("empty"), engines)).rejects.toMatchObject({ code: "empty" });
    await expect(writeMetadata(corpus("encrypted-aes256"), { title: "x" }, opts(), engines)).rejects.toMatchObject({ code: "encrypted" });
    const ok = await readMetadata(corpus("encrypted-aes256", { password: "test-pass" }), engines);
    expect(ok.title).toBe("Quarterly notes (made up)");
    const c = new AbortController();
    c.abort();
    await expect(writeMetadata(corpus("plain-3p"), { title: "x" }, opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("A-COR-10 xmpSet handles attribute form, missing namespace and no Description", () => {
    const attr = `<rdf:Description xmlns:pdf="p" pdf:Producer="A"/>`;
    expect(xmpGet(attr, "pdf:Producer")).toBe("A");
    expect(xmpGet(xmpSet(attr, "pdf:Producer", "B"), "pdf:Producer")).toBe("B");
    expect(xmpSet(attr, "pdf:Producer", null)).not.toContain("Producer");
    expect(xmpSet(`<rdf:Description/>`, "dc:title", "T")).toContain("xmlns:dc=");
    expect(xmpSet("<junk/>", "dc:title", "T")).toBe("<junk/>");
  });
});
