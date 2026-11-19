// Finds the qpdf CLI used as the independent verifier: QPDF_BIN, then tools/qpdf/*/bin (this repo or the main
// repo when run from a worktree), then `qpdf` on PATH.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export function qpdfBin() {
  if (process.env.QPDF_BIN) return process.env.QPDF_BIN;
  const exe = process.platform === "win32" ? "qpdf.exe" : "qpdf";
  for (const rel of ["../tools/qpdf", "../../../tools/qpdf"]) {
    const base = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const p = join(base, d, "bin", exe);
      if (existsSync(p)) return p;
    }
  }
  return "qpdf";
}
