import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qpdfBin } from "../../scripts/qpdf-bin.mjs";

/** Runs the real qpdf CLI on bytes (independent of the wasm engine under test). */
export function qpdfCli(bytes: Uint8Array, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "mosspdf-"));
  try {
    const f = join(dir, "x.pdf");
    writeFileSync(f, bytes);
    const r = spawnSync(qpdfBin(), [...args, f], { encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export const showEncryption = (b: Uint8Array, password?: string) => qpdfCli(b, ["--show-encryption", ...(password ? [`--password=${password}`] : [])]);
