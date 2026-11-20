import { describe, expect, it } from "vitest";
import { fillForm, readForm } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const byName = (f: Awaited<ReturnType<typeof readForm>>) => Object.fromEntries(f.fields.map((x) => [x.name, x]));
const inf = (name: string, bytes: Uint8Array) => ({ name, bytes });

describe("M4 readForm", () => {
  it("lists every field with type, options, flags and widget page + rect", async () => {
    const f = await readForm(corpus("forms-2p"), {}, engines);
    const m = byName(f);
    expect(f.hasXFA).toBe(false);
    expect(f.signed).toBe(false);
    expect(f.fields.map((x) => x.type)).toEqual(["text", "text", "text", "checkbox", "radio", "dropdown", "optionlist", "text", "text"]);
    expect(m.country.options).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(m.interests.options).toEqual(["Chess", "Go", "Shogi"]);
    expect(m.notes.multiline).toBe(true);
    expect(m.code.maxLength).toBe(4);
    expect(m.ref_no).toMatchObject({ readOnly: true, value: "REF-001" });
    expect(m.choice.widgets.map((w) => w.onValue)).toEqual(["a", "b"]);
    expect(m.full_name.widgets[0]).toMatchObject({ page: 0, rect: [49.5, 599.5, 250.5, 624.5] });
    expect(m.page2_note.widgets[0].page).toBe(1);
  });
  it("reports XFA (hybrid and XFA-only) and signed", async () => {
    expect((await readForm(corpus("risk-xfa"), {}, engines)).hasXFA).toBe(true);
    const x = await readForm(corpus("xfa-only"), {}, engines);
    expect(x).toMatchObject({ hasXFA: true, fields: [] });
    const s = await readForm(corpus("signed"), {}, engines);
    expect(s.signed).toBe(true);
    expect(s.fields.map((f) => f.type)).toEqual(["signature"]);
    expect((await readForm(corpus("plain-3p"), {}, engines)).fields).toEqual([]);
  });
});

describe("M4 fillForm", () => {
  const values = { full_name: "Ana Maria", notes: "line one\nline two", agree: true, choice: "b", country: "Gamma", interests: ["Go", "Shogi"], code: "AB12" };
  it("values round-trip and the file is valid", async () => {
    const r = await fillForm(corpus("forms-2p"), values, {}, opts(), engines);
    qpdfCheck(r.bytes);
    expect(r.name).toBe("forms-2p-filled.pdf");
    const back = byName(await readForm(inf(r.name, r.bytes), {}, engines));
    expect(back.full_name.value).toBe("Ana Maria");
    expect(back.notes.value).toBe("line one\nline two");
    expect(back.agree.value).toBe(true);
    expect(back.choice.value).toBe("b");
    expect(back.country.value).toBe("Gamma");
    expect(back.interests.value).toEqual(["Go", "Shogi"]);
    expect(back.ref_no.value).toBe("REF-001"); // untouched
  });
  it("can clear values and uncheck", async () => {
    const r = await fillForm(corpus("forms"), { full_name: "", agree: false, country: "" }, {}, opts(), engines);
    qpdfCheck(r.bytes);
    const back = byName(await readForm(inf("x.pdf", r.bytes), {}, engines));
    expect(back.full_name.value).toBe("");
    expect(back.agree.value).toBe(false);
    expect(back.country.value).toBe("");
  });
  it("flatten removes the fields and keeps the text on the page", async () => {
    const r = await fillForm(corpus("forms-2p"), values, { flatten: true }, opts(), engines);
    qpdfCheck(r.bytes);
    expect((await readForm(inf("x.pdf", r.bytes), {}, engines)).fields).toEqual([]);
    expect((await readPdf(r.bytes))[0].text).toContain("Ana Maria");
  });
  it("characters Helvetica cannot draw give a plain error", async () => {
    await expect(fillForm(corpus("forms-2p"), { full_name: "李小龍" }, {}, opts(), engines)).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining("can't take characters like") });
  });
  it("too-long values and unknown fields give plain errors", async () => {
    await expect(fillForm(corpus("forms-2p"), { code: "TOO LONG" }, {}, opts(), engines)).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining('"code"') });
    await expect(fillForm(corpus("forms-2p"), { nope: "x" }, {}, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
  });
  it("read-only fields are left alone", async () => {
    const r = await fillForm(corpus("forms-2p"), { ref_no: "CHANGED" }, {}, opts(), engines);
    expect(byName(await readForm(inf("x.pdf", r.bytes), {}, engines)).ref_no.value).toBe("REF-001");
  });
  it("hybrid XFA: fills the standard fields and says the XFA data was removed", async () => {
    const r = await fillForm(corpus("risk-xfa"), { full_name: "Zed" }, {}, opts(), engines);
    expect(r.warnings.map((w) => w.code)).toContain("xfa-removed");
    const back = await readForm(inf("x.pdf", r.bytes), {}, engines);
    expect(back.hasXFA).toBe(false);
    expect(byName(back).full_name.value).toBe("Zed");
  });
  it("signed input warns that the signature is invalidated", async () => {
    const r = await fillForm(corpus("signed"), {}, {}, opts(), engines);
    expect(r.warnings.map((w) => w.code)).toContain("signature-invalidated");
  });
  it("cancellation", async () => {
    const c = new AbortController();
    c.abort();
    await expect(fillForm(corpus("forms-2p"), values, {}, opts({ signal: c.signal }), engines)).rejects.toMatchObject({ code: "cancelled" });
  });
});
