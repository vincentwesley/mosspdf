// Explicit repair op: the D10 path (qpdf, pdf-lib re-save fallback inside openPdf) plus a qpdf re-write, reporting what was done.
// Encrypted input follows the same owner rule as unprotect (D13). Never claims success when pages are lost.
import { safeName } from "./assemble";
import { checkAbort, classify, openPdf } from "./open";
import { authorise } from "./protect";
import { PdfError, type Engines, type InFile, type OpOptions, type Warning } from "./types";
import type { RepairResult } from "./types-m3";

const MAX_GUESS_BYTES = 64 * 1024 * 1024;

/** Distinct page objects named in the raw bytes: only meaningful for plain (no object stream) files, so a lower bound at best. */
function guessPages(b: Uint8Array): number | null {
  if (b.length > MAX_GUESS_BYTES) return null;
  const text = new TextDecoder("latin1").decode(b);
  const found = new Set<string>();
  for (const m of text.matchAll(/(\d+)\s+\d+\s+obj\s*<<[^>]{0,2000}?\/Type\s*\/Page(?![A-Za-z])/g)) found.add(m[1]);
  return found.size || null;
}

export async function repair(file: InFile, o: OpOptions, e: Engines): Promise<RepairResult> {
  checkAbort(o.signal);
  const plain = await authorise(file, e);
  const opened = await openPdf({ name: file.name, bytes: plain.bytes }, e, o.signal);
  const pagesAfter = opened.info.pageCount;
  if (pagesAfter === 0) throw new PdfError("corrupt", `"${file.name}" looks damaged and no pages could be recovered. Download it again, or re-save it from the original program.`, file.name);
  const r = await e.qpdf(["/in.pdf", "/out.pdf"], { "/in.pdf": opened.bytes }, ["/out.pdf"]);
  if (!r.files["/out.pdf"] || r.code === 2) throw classify(r.stderr, file);

  const repaired = opened.info.repaired;
  const pagesBefore = repaired && !plain.encrypted ? guessPages(file.bytes) : null;
  const lost = pagesBefore !== null && pagesBefore > pagesAfter;
  const actions = repaired ? ["Rebuilt the file's internal index (cross-reference table).", "Dropped broken content it couldn't read."] : ["Checked the file: no damage found."];
  actions.push("Wrote the file again with a clean structure.");
  if (plain.encrypted) actions.push("Removed the password.");

  const warnings: Warning[] = [];
  if (lost) warnings.push({ code: "pages-lost", message: `The original seems to have had ${pagesBefore} pages but only ${pagesAfter} could be recovered. Keep the original.` });
  else if (repaired) warnings.push({ code: "repaired", message: `"${file.name}" was damaged. ${pagesAfter} page${pagesAfter === 1 ? "" : "s"} recovered, but some content may be blank or missing, so check every page.` });
  if (plain.encrypted) warnings.push({ code: "encryption-removed", message: "The repaired file has no password." });
  o.onProgress?.(1, 1);
  return {
    bytes: r.files["/out.pdf"],
    name: `${safeName(file.name, "document").slice(0, -4)}-repaired.pdf`,
    warnings,
    repaired,
    actions,
    pagesBefore,
    pagesAfter,
    complete: !lost,
  };
}
