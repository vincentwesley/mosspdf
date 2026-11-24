// Saved signatures: strictly opt-in ("Keep on this device"). Trimmed PNGs in localStorage `mosspdf.saved-sigs`, never uploaded.
export const SAVED_KEY = "mosspdf.saved-sigs";
export const MAX_SAVED = 4;
export const MAX_BYTES = 200 * 1024;
export interface Saved { kind: "signature" | "initials"; png: string } // png = base64
const PNG_MAGIC = "iVBORw0KGgo"; // base64 of the 8-byte PNG signature (first 8 bytes = 11 chars)

/** Structural checks (no decoding): array of up to 4 {kind, png} with a base64 PNG of at most 200 KB. Bad entries are dropped. */
export function parseSaved(raw: string | null): Saved[] {
  let v: unknown;
  try { v = JSON.parse(raw ?? "[]"); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: Saved[] = [];
  for (const e of v) {
    if (out.length >= MAX_SAVED) break;
    const o = e as Partial<Saved> | null;
    if (!o || (o.kind !== "signature" && o.kind !== "initials") || typeof o.png !== "string") continue;
    if (!o.png.startsWith(PNG_MAGIC) || !/^[A-Za-z0-9+/]+={0,2}$/.test(o.png) || (o.png.length * 3) / 4 > MAX_BYTES) continue;
    out.push({ kind: o.kind, png: o.png });
  }
  return out;
}

export function readRaw(): Saved[] {
  try { return parseSaved(localStorage.getItem(SAVED_KEY)); } catch { return []; }
}
export function writeSaved(list: Saved[]): void {
  try { if (list.length) localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(-MAX_SAVED))); else localStorage.removeItem(SAVED_KEY); } catch { /* storage blocked: nothing is kept */ }
}

export const toB64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** Decodes each saved PNG to a canvas; entries that do not decode as a picture are dropped (and storage is rewritten without them). */
export async function loadSaved(): Promise<{ saved: Saved; canvas: HTMLCanvasElement }[]> {
  const list = readRaw();
  const out: { saved: Saved; canvas: HTMLCanvasElement }[] = [];
  for (const saved of list) {
    try {
      const bin = atob(saved.png);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
      const canvas = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
      canvas.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
      out.push({ saved, canvas });
    } catch { /* not a picture: dropped */ }
  }
  if (out.length !== list.length) writeSaved(out.map((o) => o.saved));
  return out;
}
