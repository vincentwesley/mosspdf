// Independent verification: the real qpdf CLI (--check) and pdf.js (page count, rotation, per-page text).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { qpdfBin } from "../../scripts/qpdf-bin.mjs";

function cli(bytes: Uint8Array, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pagehold-"));
  try {
    const f = join(dir, "x.pdf");
    writeFileSync(f, bytes);
    const r = spawnSync(qpdfBin(), [...args, f], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw new Error(`qpdf CLI not runnable (${qpdfBin()}): ${r.error.message}. Set QPDF_BIN.`);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Throws unless `qpdf --check` reports no errors (exit 0, or 3 = warnings when allowed). */
export function qpdfCheck(bytes: Uint8Array, allowWarnings = false) {
  const r = cli(bytes, ["--check"]);
  const ok = r.status === 0 || (allowWarnings && r.status === 3);
  if (!ok) throw new Error(`qpdf --check failed (${r.status}): ${r.stdout}${r.stderr}`);
}

export function qpdfJson(bytes: Uint8Array, key: string): Record<string, unknown> {
  return JSON.parse(cli(bytes, ["--json=2", `--json-key=${key}`]).stdout);
}

export interface PageRead {
  text: string;
  rotate: number;
  w: number;
  h: number;
}

export async function readPdf(bytes: Uint8Array, password?: string): Promise<PageRead[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const pages: PageRead[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      const [x0, y0, x1, y1] = p.view;
      pages.push({ text: tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").trim(), rotate: p.rotate, w: x1 - x0, h: y1 - y0 });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** The marker the corpus writes on each page, e.g. "PAGE-MARKER p2" -> "p2". */
export const marker = (p: PageRead) => /PAGE-MARKER (\S+)/.exec(p.text)?.[1];

/** Where `needle` sits on page `index` as displayed (origin bottom-left, y up): start point, and the text direction in degrees (0 = upright, left to right). */
export async function findText(bytes: Uint8Array, index: number, needle: string) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const p = await doc.getPage(index + 1);
    const vp = p.getViewport({ scale: 1 });
    for (const it of (await p.getTextContent()).items) {
      if (!("str" in it) || !it.str.includes(needle)) continue;
      const m = pdfjs.Util.transform(vp.transform, it.transform as number[]); // device space: y down
      return { x: m[4], y: vp.height - m[5], angle: -(Math.atan2(m[1], m[0]) * 180) / Math.PI, w: vp.width, h: vp.height };
    }
    return undefined;
  } finally {
    await task.destroy();
  }
}

export async function readInfo(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    return ((await doc.getMetadata()).info ?? {}) as Record<string, unknown>;
  } finally {
    await task.destroy();
  }
}
