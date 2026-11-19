// Shared by the single-file ops that edit with pdf-lib: open, decrypt, collect the usual warnings, validate page selections.
import { classify, openPdf } from "./open";
import { PdfError, type Engines, type InFile, type Inspection, type OpOptions, type Warning } from "./types";

export async function prepare(file: InFile, o: Pick<OpOptions, "signal">, e: Engines) {
  const { bytes: opened, info } = await openPdf(file, e, o.signal);
  const n = `"${file.name}"`;
  const warnings: Warning[] = [];
  if (info.repaired) warnings.push({ code: "repaired", message: `${n} was damaged and has been repaired. Some content may be missing, so check the result.` });
  if (info.hasSignatures) warnings.push({ code: "signature-invalidated", message: `${n} is digitally signed. Changing it makes the signature invalid.` });
  let bytes = opened;
  if (info.encrypted) {
    const r = await e.qpdf([...(file.password ? [`--password=${file.password}`] : []), "--decrypt", "/in.pdf", "/out.pdf"], { "/in.pdf": opened }, ["/out.pdf"]);
    if (!r.files["/out.pdf"] || r.code === 2) throw classify(r.stderr, file);
    bytes = r.files["/out.pdf"];
    warnings.push({ code: "decrypted", message: `${n} was password-protected. The new file isn't, so add protection again if you need it.` });
  }
  return { bytes, info, warnings };
}

/** 0-based, sorted, unique. undefined = every page. */
export function selectPages(pages: number[] | undefined, info: Inspection, file: InFile): number[] {
  const n = info.pageCount;
  const sel = pages ? [...new Set(pages)].sort((a, b) => a - b) : Array.from({ length: n }, (_, i) => i);
  if (!sel.length) throw new PdfError("unsupported", "No pages are selected. Pick at least one page.", file.name);
  const bad = sel.find((p) => !Number.isInteger(p) || p < 0 || p >= n);
  if (bad !== undefined) throw new PdfError("unsupported", `Page ${bad + 1} doesn't exist in "${file.name}", which has ${n} page${n === 1 ? "" : "s"}.`, file.name);
  return sel;
}
