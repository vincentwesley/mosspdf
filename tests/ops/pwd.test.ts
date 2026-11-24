import { describe, expect, it, vi } from "vitest";
import { cleanCopy, PdfError, protect, repair, unprotect } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCli, showEncryption } from "../helpers/m3";
import { qpdfCheck, readPdf } from "../helpers/qpdf";

const P3 = ["PAGE-MARKER p1", "PAGE-MARKER p2", "PAGE-MARKER p3"];

vi.setConfig({ testTimeout: 180_000 }); // qpdf spawns and AES work: slow when e2e runs alongside
describe("add password", () => {
  it("@A-PWD-1 writes AES-256 R6, opens with the user password, not without", async () => {
    const r = await protect(corpus("plain-3p"), { userPassword: "open-me", ownerPassword: "boss" }, opts(), engines);
    const enc = showEncryption(r.bytes, "open-me");
    expect(enc.out).toMatch(/R = 6/);
    expect(enc.out).toMatch(/stream encryption method: AESv3/);
    expect(enc.out).toMatch(/Supplied password is user password/);
    expect(enc.out).toMatch(/print high resolution: allowed/);
    expect(showEncryption(r.bytes, "boss").out).toMatch(/Supplied password is owner password/);
    expect(qpdfCli(r.bytes, ["--check"]).status).toBe(2);
    expect(qpdfCli(r.bytes, ["--check", "--password=wrong"]).status).toBe(2);
    expect(qpdfCli(r.bytes, ["--check", "--password=open-me"]).status).toBe(0);
    await expect(readPdf(r.bytes)).rejects.toThrow();
    expect((await readPdf(r.bytes, "open-me")).map((p) => p.text)).toEqual(P3);
    expect(r.name).toBe("plain-3p-protected.pdf");
    expect(r.warnings.map((w) => w.code)).not.toContain("same-password");
  });

  it("@A-PWD-1 permissions map onto the file's restrictions", async () => {
    const r = await protect(corpus("plain-3p"), { userPassword: "u", ownerPassword: "o", permissions: { print: false, copy: false, modify: false, annotate: false, fillForms: false } }, opts(), engines);
    const out = showEncryption(r.bytes, "u").out;
    for (const l of ["extract for any purpose", "print low resolution", "print high resolution", "modify document assembly", "modify forms", "modify annotations", "modify other"]) expect(out, l).toMatch(new RegExp(`${l}: not allowed`));
    const some = await protect(corpus("plain-3p"), { userPassword: "u", ownerPassword: "o", permissions: { copy: false, fillForms: true, annotate: false } }, opts(), engines);
    const o2 = showEncryption(some.bytes, "u").out;
    expect(o2).toMatch(/extract for any purpose: not allowed/);
    expect(o2).toMatch(/print high resolution: allowed/);
    expect(o2).toMatch(/modify forms: allowed/);
    expect(o2).toMatch(/modify annotations: not allowed/);
  });

  it("@A-PWD-1 no owner password: the user password is used for both, with a warning", async () => {
    const r = await protect(corpus("plain-3p"), { userPassword: "same-pw" }, opts(), engines);
    expect(showEncryption(r.bytes, "same-pw").out).toMatch(/Supplied password is (user|owner) password/);
    expect(r.warnings.map((w) => w.code)).toContain("same-password");
    const back = await unprotect({ name: r.name, bytes: r.bytes }, { password: "same-pw" }, opts(), engines);
    qpdfCheck(back.bytes);
  });

  it("@A-PWD-1 rejects an empty or too long password; unicode passwords round-trip", async () => {
    await expect(protect(corpus("plain-3p"), { userPassword: "" }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    await expect(protect(corpus("plain-3p"), { userPassword: "x".repeat(128) }, opts(), engines)).rejects.toMatchObject({ code: "unsupported" });
    const r = await protect(corpus("plain-3p"), { userPassword: "pässwörd 密码" }, opts(), engines);
    expect((await readPdf(r.bytes, "pässwörd 密码")).length).toBe(3);
  });

  it("@A-PWD-1 odd passwords (leading dash, option-like, spaces, unicode, 127 chars) go to qpdf as values, never as options", async () => {
    for (const pw of ["-x", "--help", "pass word", "pässwörd", "a".repeat(127)]) {
      for (const owner of [undefined, pw === "-x" ? "--owner" : "-o"]) {
        const r = await protect(corpus("plain-3p"), { userPassword: pw, ownerPassword: owner }, opts(), engines);
        expect(showEncryption(r.bytes, pw).out, pw).toMatch(/R = 6/);
        expect(qpdfCli(r.bytes, ["--check", `--password=${pw}`]).status, pw).toBe(0);
        expect((await readPdf(r.bytes, pw)).map((p) => p.text), pw).toEqual(P3);
        await expect(readPdf(r.bytes, "wrong")).rejects.toThrow();
        const back = await unprotect({ name: r.name, bytes: r.bytes }, { password: owner ?? pw }, opts(), engines);
        expect(showEncryption(back.bytes).out).toMatch(/not encrypted/);
      }
    }
  });

  it("@A-PWD-1 bad inputs are typed errors", async () => {
    await expect(protect(corpus("empty"), { userPassword: "x" }, opts(), engines)).rejects.toMatchObject({ code: "empty" });
    await expect(protect(corpus("renamed-text"), { userPassword: "x" }, opts(), engines)).rejects.toMatchObject({ code: "not-pdf" });
    await expect(protect(corpus("encrypted-aes256"), { userPassword: "x" }, opts(), engines)).rejects.toMatchObject({ code: "encrypted" });
  });

  it("@A-PWD-1 re-protecting a protected file needs the right password", async () => {
    const r = await protect(corpus("encrypted-aes256", { password: "test-pass" }), { userPassword: "new-pass" }, opts(), engines);
    expect((await readPdf(r.bytes, "new-pass")).length).toBe(3);
    await expect(readPdf(r.bytes, "test-pass")).rejects.toThrow();
  });
});

describe("remove password", () => {
  it("@A-PWD-2 works with the correct password", async () => {
    for (const [name, pw] of [["encrypted-aes256", "test-pass"], ["encrypted-rc4-40", "test-pass"], ["encrypted-user-owner", "owner-pass"]]) {
      const r = await unprotect(corpus(name), { password: pw }, opts(), engines);
      qpdfCheck(r.bytes);
      expect(showEncryption(r.bytes).out).toMatch(/not encrypted/);
      expect((await readPdf(r.bytes)).map((p) => p.text)).toEqual(P3);
      expect(r.name).toBe(`${name}-unprotected.pdf`);
    }
  });

  it("@A-PWD-2 a wrong or missing password fails with wrong-password and a readable message", async () => {
    for (const pw of ["nope", "", "test-pas", "TEST-PASS"]) {
      const e = await unprotect(corpus("encrypted-aes256"), { password: pw }, opts(), engines).catch((x) => x);
      expect(e).toBeInstanceOf(PdfError);
      expect(e.code).toBe("wrong-password");
      expect(e.message).not.toMatch(/qpdf|wasm|stack|undefined/i);
    }
  });

  it("@A-PWD-2 owner-password-only file: opens freely, but removing protection REQUIRES the owner password", async () => {
    const file = corpus("restricted-owner-only");
    expect(showEncryption(file.bytes).status).toBe(0); // opens without a password
    for (const pw of ["", "owner", "wrong", "OWNER-PASS"]) {
      const e = await unprotect(file, { password: pw }, opts(), engines).catch((x) => x);
      expect(e, `password "${pw}"`).toBeInstanceOf(PdfError);
      expect(e.code).toBe("wrong-password");
    }
    const ok = await unprotect(file, { password: "owner-pass" }, opts(), engines);
    expect(showEncryption(ok.bytes).out).toMatch(/not encrypted/);
    qpdfCheck(ok.bytes);
  });

  it("@A-PWD-2 restricted file with a user password: the user password is not enough, the owner password is", async () => {
    const file = corpus("encrypted-user-owner");
    const e = await unprotect(file, { password: "user-pass" }, opts(), engines).catch((x) => x);
    expect(e.code).toBe("wrong-password");
    expect(e.message).toMatch(/owner password/);
    expect((await unprotect(file, { password: "owner-pass" }, opts(), engines)).bytes.length).toBeGreaterThan(100);
  });

  it("@A-PWD-2 the same rule guards protect, clean copy and repair on restricted files", async () => {
    const f = corpus("restricted-owner-only");
    await expect(protect(f, { userPassword: "x" }, opts(), engines)).rejects.toMatchObject({ code: "wrong-password", message: expect.stringMatching(/owner password/) });
    await expect(cleanCopy(f, { keepLinks: false }, opts(), engines)).rejects.toMatchObject({ code: "wrong-password" });
    await expect(repair(f, opts(), engines)).rejects.toMatchObject({ code: "wrong-password" });
    const owner = corpus("restricted-owner-only", { password: "owner-pass" });
    expect((await repair(owner, opts(), engines)).pagesAfter).toBe(3);
  });

  it("@A-PWD-2 an unprotected file comes back unchanged with a note", async () => {
    const r = await unprotect(corpus("plain-3p"), { password: "anything" }, opts(), engines);
    expect(r.warnings.map((w) => w.code)).toEqual(["not-protected"]);
  });
});
