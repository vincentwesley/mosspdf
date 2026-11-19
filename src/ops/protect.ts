// Add and remove a password. NO CIRCUMVENTION (owner rule): a password is only added to, or removed from, a file by someone who
// supplies the right password for it. There is no guessing, no candidate list, no brute force and no way around an owner password.
// A file with restrictions (no print/copy/edit) that opens without a password is NOT freely unlockable: removing or changing its
// protection needs the owner password, as the PDF spec intends (D13). qpdf itself would decrypt it with the user password alone,
// so the check in `authorise` is ours and runs before any decrypt.
import { checkAbort, classify, openPdf } from "./open";
import { safeName } from "./assemble";
import type { Permissions, ProtectOptions, UnprotectOptions } from "./types-m3";
import { PdfError, type Bytes, type Engines, type InFile, type OpOptions, type OpResult, type Warning } from "./types";

const pwArgs = (f: InFile) => (f.password ? [`--password=${f.password}`] : []);
const stem = (n: string) => safeName(n, "document").slice(0, -4);
const MAX_PW = 127; // PDF 2.0 (R6) uses at most 127 bytes of a password

export interface Authorised {
  bytes: Bytes;
  encrypted: boolean;
}

/**
 * Returns decrypted bytes only when the supplied password may remove the protection: the owner password always may; the user
 * password only when the file has no restrictions. Files qpdf can't parse at all come back untouched (the caller's openPdf
 * then classifies or repairs them).
 */
export async function authorise(f: InFile, e: Engines): Promise<Authorised> {
  const r = await e.qpdf(["--json=2", "--json-key=encrypt", ...pwArgs(f), "/f.pdf"], { "/f.pdf": f.bytes });
  if (!r.stdout.startsWith("{")) {
    if (/invalid password/i.test(r.stderr)) throw classify(r.stderr, f);
    return { bytes: f.bytes, encrypted: false };
  }
  const enc = (JSON.parse(r.stdout) as { encrypt?: { encrypted?: boolean; ownerpasswordmatched?: boolean; capabilities: Record<string, boolean> } }).encrypt;
  if (!enc?.encrypted) return { bytes: f.bytes, encrypted: false };
  const restricted = Object.values(enc.capabilities).some((v) => v === false);
  if (!enc.ownerpasswordmatched && restricted) {
    throw new PdfError(
      "wrong-password",
      `"${f.name}" has restrictions (for example on printing, copying or editing). Taking them off needs its owner password, which can be different from the password that opens it. Enter the owner password.`,
      f.name,
    );
  }
  const d = await e.qpdf(["--decrypt", ...pwArgs(f), "/f.pdf", "/o.pdf"], { "/f.pdf": f.bytes }, ["/o.pdf"]);
  if (!d.files["/o.pdf"] || d.code === 2) throw classify(d.stderr, f);
  return { bytes: d.files["/o.pdf"], encrypted: true };
}

export async function protect(file: InFile, p: ProtectOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  if (!p.userPassword) throw new PdfError("unsupported", "Enter a password to protect the file with. An empty password would not protect anything.", file.name);
  const owner = p.ownerPassword || p.userPassword;
  if (p.userPassword.length > MAX_PW || owner.length > MAX_PW) throw new PdfError("unsupported", `Passwords can be at most ${MAX_PW} characters long.`, file.name);
  checkAbort(o.signal);
  // An already protected input is only re-encrypted by someone allowed to change it (owner rule).
  const plain = await authorise(file, e);
  const opened = await openPdf({ name: file.name, bytes: plain.bytes }, e, o.signal);
  const perm: Permissions = { print: true, copy: true, modify: true, annotate: true, fillForms: true, ...p.permissions };
  const yn = (b: boolean) => (b ? "y" : "n");
  checkAbort(o.signal);
  const r = await e.qpdf(
    [
      "--encrypt",
      p.userPassword,
      owner,
      "256", // AES-256, revision 6
      "--accessibility=y",
      `--print=${perm.print ? "full" : "none"}`,
      `--extract=${yn(perm.copy)}`,
      `--assemble=${yn(perm.modify)}`,
      `--modify-other=${yn(perm.modify)}`,
      `--annotate=${yn(perm.annotate)}`,
      `--form=${yn(perm.fillForms)}`,
      "--",
      "/in.pdf",
      "/out.pdf",
    ],
    { "/in.pdf": opened.bytes },
    ["/out.pdf"],
  );
  if (!r.files["/out.pdf"] || r.code === 2) throw classify(r.stderr, file);
  const warnings: Warning[] = [];
  if (opened.info.repaired) warnings.push({ code: "repaired", message: `"${file.name}" was damaged and has been repaired. Some content may be missing, so check the result.` });
  if (opened.info.hasSignatures) warnings.push({ code: "signature-invalidated", message: `"${file.name}" is digitally signed. Encrypting it makes the signature invalid.` });
  if (!p.ownerPassword) warnings.push({ code: "same-password", message: "No separate owner password was set, so the same password opens the file and removes its protection." });
  o.onProgress?.(1, 1);
  return { bytes: r.files["/out.pdf"], name: `${stem(file.name)}-protected.pdf`, warnings };
}

export async function unprotect(file: InFile, p: UnprotectOptions, o: OpOptions, e: Engines): Promise<OpResult> {
  if (!p.password) throw new PdfError("wrong-password", `Enter the password for "${file.name}".`, file.name);
  checkAbort(o.signal);
  // Empty or non-PDF input is classified by openPdf below; a wrong password throws wrong-password from authorise.
  const plain = await authorise({ ...file, password: p.password }, e);
  const base = stem(file.name);
  if (!plain.encrypted) {
    await openPdf({ name: file.name, bytes: file.bytes }, e, o.signal);
    return { bytes: file.bytes, name: `${base}.pdf`, warnings: [{ code: "not-protected", message: `"${file.name}" isn't password-protected, so it is unchanged.` }] };
  }
  o.onProgress?.(1, 1);
  return { bytes: plain.bytes, name: `${base}-unprotected.pdf`, warnings: [] };
}
