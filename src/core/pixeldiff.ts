// Page pixel difference for the Overlay view: both pages drawn at the same scale on white, differing pixels marked.
// Only pdf.js documents already open through the store (openDoc in render.ts), so fonts and data come from memory.
import type { PDFDocumentProxy } from "pdfjs-dist/build/pdf.mjs";

/** Colours of marks: only in the Original / only in the Changed. Also shown as a legend, so keep them in step with style.css. */
export const REMOVED_RGB = [217, 83, 30] as const;
export const ADDED_RGB = [60, 90, 220] as const;
const THRESHOLD = 96; // summed channel difference that counts as a different pixel (anti-aliasing stays below it)
const MAX_PIXELS = 3_000_000;

async function size(doc: PDFDocumentProxy, n: number | null) {
  if (n === null) return { w: 0, h: 0 };
  const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height };
}
async function draw(doc: PDFDocumentProxy, n: number | null, scale: number, W: number, H: number): Promise<HTMLCanvasElement> {
  const target = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = target.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  if (n !== null) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const tmp = Object.assign(document.createElement("canvas"), { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
    await page.render({ canvas: tmp, viewport }).promise;
    g.drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 0;
    page.cleanup();
  }
  return target;
}

/** Draws Original page `pa` and Changed page `pb` (1-based, null = nothing there) about `width` px wide. `base` receives the Original,
 *  `mark` the differing pixels (transparent elsewhere); both optional. Returns how many pixels differ. */
export async function pixelDiff(da: PDFDocumentProxy, pa: number | null, db: PDFDocumentProxy, pb: number | null, width: number, base?: HTMLCanvasElement, mark?: HTMLCanvasElement): Promise<number> {
  const [sa, sb] = await Promise.all([size(da, pa), size(db, pb)]);
  const ref = sa.w ? sa : sb;
  let scale = width / (ref.w || 1);
  const bw = Math.max(sa.w, sb.w), bh = Math.max(sa.h, sb.h);
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (bw * bh || 1)));
  const W = Math.max(1, Math.ceil(bw * scale)), H = Math.max(1, Math.ceil(bh * scale));
  const ca = await draw(da, pa, scale, W, H), cb = await draw(db, pb, scale, W, H);
  const A = ca.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const B = cb.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const out = new ImageData(W, H);
  let n = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d <= THRESHOLD) continue;
    n++;
    const added = A[i] + A[i + 1] + A[i + 2] > B[i] + B[i + 1] + B[i + 2]; // darker in the Changed: new ink
    const c = added ? ADDED_RGB : REMOVED_RGB;
    out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = 255;
  }
  if (mark) { mark.width = W; mark.height = H; mark.getContext("2d")!.putImageData(out, 0, 0); }
  if (base) { base.width = W; base.height = H; base.getContext("2d")!.drawImage(ca, 0, 0); }
  ca.width = ca.height = cb.width = cb.height = 0;
  return n;
}
