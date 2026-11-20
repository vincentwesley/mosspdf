import { describe, expect, it } from "vitest";
import { cleanCopy, safetyScan, type SafetyKind } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const FIXTURES: [string, SafetyKind[]][] = [
  ["risk-js-openaction", ["javascript", "open-action"]],
  ["risk-js-names", ["javascript"]],
  ["risk-page-aa", ["additional-actions"]],
  ["risk-annot-aa", ["additional-actions"]],
  ["risk-launch", ["launch"]],
  ["risk-embedded", ["embedded-file", "file-attachment"]],
  ["risk-submit", ["submit-form"]],
  ["risk-importdata", ["import-data"]],
  ["risk-uri", ["uri"]],
  ["risk-gotor", ["go-to-remote"]],
  ["risk-gotoe", ["go-to-embedded"]],
  ["risk-richmedia", ["rich-media"]],
  ["risk-xfa", ["xfa"]],
];
const EVERYTHING = [...new Set(FIXTURES.flatMap(([, k]) => k))].sort();
const kinds = (r: { items: { kind: string }[] }) => [...new Set(r.items.map((i) => i.kind))].sort();

describe("safety scan", () => {
  for (const [name, expected] of FIXTURES) {
    it(`@A-SAF-1 ${name} is reported as ${expected.join(" + ")}`, async () => {
      const r = await safetyScan(corpus(name), engines);
      expect(kinds(r)).toEqual(expect.arrayContaining(expected));
      expect(r.risky).toBe(true);
      for (const i of r.items) {
        expect(i.explanation.length).toBeGreaterThan(30);
        expect(i.explanation).not.toMatch(/malware|virus/i);
      }
    });
  }

  it("@A-SAF-1 reports URL targets, attachment names and page numbers", async () => {
    const uri = await safetyScan(corpus("risk-uri"), engines);
    expect(uri.items.map((i) => i.detail).sort()).toEqual(["https://example.com/a", "https://example.org/b?x=1"]);
    expect(uri.items.every((i) => i.where === 1)).toBe(true);
    const emb = await safetyScan(corpus("risk-embedded"), engines);
    expect(emb.items.find((i) => i.kind === "embedded-file")).toMatchObject({ detail: "notes.txt", where: "document" });
    expect(emb.items.find((i) => i.kind === "file-attachment")).toMatchObject({ detail: "data.csv", where: 2 });
    expect((await safetyScan(corpus("risk-submit"), engines)).items.find((i) => i.kind === "submit-form")?.detail).toBe("https://example.com/submit");
    expect((await safetyScan(corpus("risk-page-aa"), engines)).items[0]).toMatchObject({ where: 1, severity: "medium" });
  });

  it("@A-SAF-1 every kind is found in the combined file, in the object-stream copy and in the encrypted copy", async () => {
    const a = await safetyScan(corpus("risk-everything"), engines);
    expect(kinds(a)).toEqual(expect.arrayContaining(EVERYTHING));
    const b = await safetyScan(corpus("risk-everything-objstm"), engines);
    expect(kinds(b)).toEqual(expect.arrayContaining([...EVERYTHING, "object-streams"]));
    expect(b.items.filter((i) => i.kind !== "object-streams")).toEqual(a.items);
    const c = await safetyScan(corpus("risk-everything-encrypted", { password: "user-pass" }), engines);
    expect(c.encrypted).toBe(true);
    expect(c.items).toEqual(a.items);
    await expect(safetyScan(corpus("risk-everything-encrypted", { password: "nope" }), engines)).rejects.toMatchObject({ code: "wrong-password" });
    await expect(safetyScan(corpus("risk-everything-encrypted"), engines)).rejects.toMatchObject({ code: "encrypted" });
  });

  it("@A-SAF-1 JBIG2 is informational only", async () => {
    const r = await safetyScan(corpus("risk-jbig2"), engines);
    expect(r.items.map((i) => [i.kind, i.severity])).toEqual([["jbig2", "info"]]);
    expect(r.risky).toBe(false);
  });

  it("@A-SAF-3 clean fixtures report nothing risky", async () => {
    for (const name of ["plain-3p", "forms", "outline", "mixed-sizes"]) {
      const r = await safetyScan(corpus(name), engines);
      expect(r.items, name).toEqual([]);
      expect(r.risky).toBe(false);
    }
  });

  it("@A-SAF-3 the existing javascript and links fixtures are flagged", async () => {
    expect(kinds(await safetyScan(corpus("javascript"), engines))).toEqual(["javascript", "open-action"]);
    expect(kinds(await safetyScan(corpus("links-annots"), engines))).toEqual(["uri"]);
  });

  it("@A-COR-3 bad input gives typed errors", async () => {
    await expect(safetyScan(corpus("empty"), engines)).rejects.toMatchObject({ code: "empty" });
    await expect(safetyScan(corpus("renamed-png"), engines)).rejects.toMatchObject({ code: "not-pdf" });
    const damaged = await safetyScan(corpus("broken-xref"), engines).catch((e) => e);
    expect(damaged.repaired === true || damaged.code === "corrupt").toBe(true);
  });
});

describe("cleaned copy", () => {
  for (const name of [...FIXTURES.map(([n]) => n), "risk-everything", "risk-everything-objstm"]) {
    it(`@A-SAF-2 ${name}: re-scan finds nothing and qpdf --check passes`, async () => {
      const r = await cleanCopy(corpus(name), { keepLinks: false }, opts(), engines);
      qpdfCheck(r.bytes);
      expect(r.remaining).toEqual([]);
      expect(r.removed.length).toBeGreaterThan(0);
      expect(r.warnings.find((w) => w.code === "residual-risk")).toBeUndefined();
      expect(r.name).toMatch(/-clean\.pdf$/);
      const again = await safetyScan({ name: r.name, bytes: r.bytes }, engines);
      expect(again.items).toEqual([]);
      expect((await readPdf(r.bytes)).length).toBe(2);
    });
  }

  it("@A-SAF-2 keepLinks keeps web links and nothing else", async () => {
    const r = await cleanCopy(corpus("risk-everything"), { keepLinks: true }, opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.remaining.map((i) => i.kind)).toEqual(["uri", "uri"]);
    expect(r.remaining.map((i) => i.detail).sort()).toEqual(["https://example.com/a", "https://example.org/b?x=1"]);
  });

  it("@A-SAF-2 keeps the form fields, drops XFA and warns about submit buttons", async () => {
    const x = await cleanCopy(corpus("risk-xfa"), { keepLinks: false }, opts(), engines);
    expect(x.warnings.map((w) => w.code)).toContain("xfa-removed");
    const text = Buffer.from(x.bytes).toString("latin1");
    expect(text).toContain("AcroForm");
    expect(text).not.toContain("XFA");
    const s = await cleanCopy(corpus("risk-submit"), { keepLinks: false }, opts(), engines);
    expect(s.warnings.map((w) => w.code)).toContain("submit-removed");
    expect(Buffer.from(s.bytes).toString("latin1")).toContain("AcroForm");
  });

  it("@A-SAF-2 a clean file stays clean and readable", async () => {
    const r = await cleanCopy(corpus("plain-3p"), { keepLinks: false }, opts(), engines);
    expect(r.removed).toEqual([]);
    expect((await readPdf(r.bytes)).map((p) => p.text)).toEqual(["PAGE-MARKER p1", "PAGE-MARKER p2", "PAGE-MARKER p3"]);
  });

  it("@A-SAF-2 an encrypted file is cleaned with its password; the copy has no password", async () => {
    const r = await cleanCopy(corpus("risk-everything-encrypted", { password: "user-pass" }), { keepLinks: false }, opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.remaining).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("encryption-removed");
    await expect(cleanCopy(corpus("risk-everything-encrypted", { password: "bad" }), { keepLinks: false }, opts(), engines)).rejects.toMatchObject({ code: "wrong-password" });
  });
});
