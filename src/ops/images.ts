// Images -> one PDF, one image per page.
// CONTRACT (the UI decodes first): each image arrives as JPEG or PNG bytes whose pixels are already upright, plus their pixel width/height.
// The UI decodes with createImageBitmap(blob, { imageOrientation: "from-image" }); a JPEG whose EXIF orientation is not 1 must be re-encoded
// upright (canvas.toBlob) before it gets here, because PDF viewers ignore EXIF. JPEGs are embedded as-is (no re-encode). A width/height that
// doesn't match the bytes is rejected as a probable un-applied rotation.
import { PDFDocument } from "@cantoo/pdf-lib";
import { CREATOR } from "./assemble";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { PdfError, type OpOptions, type OpResult } from "./types";

export interface ImageInput {
  name: string;
  format: "jpeg" | "png";
  bytes: Uint8Array;
  width: number; // upright pixels
  height: number;
}
export interface ImagesToPdfOptions {
  size?: "fit" | "a4" | "letter"; // default fit
  dpi?: number; // fit only: pixels per inch used to turn pixels into points, default 72 (1 px = 1 pt)
  orientation?: "auto" | "portrait" | "landscape"; // a4/letter only, default auto (follows the image)
  margin?: number; // pt, a4/letter only, default 36
}

const PAGES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function imagesToPdf(images: ImageInput[], opts: ImagesToPdfOptions, o: OpOptions): Promise<OpResult> {
  if (!images.length) throw new PdfError("unsupported", "There is no picture to work on. Add a picture and try again.");
  const size = opts.size ?? "fit";
  const dpi = opts.dpi ?? 72;
  const margin = opts.margin ?? 36;
  if (!(dpi > 0 && dpi <= 2400)) throw new PdfError("unsupported", "The DPI must be between 1 and 2400. Change it and try again.");
  if (!(margin >= 0 && margin < 200)) throw new PdfError("unsupported", "The margin must be between 0 and 200 points. Change it and try again.");
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const [i, im] of images.entries()) {
    checkAbort(o.signal);
    if (!(im.width > 0 && im.height > 0)) throw new PdfError("unsupported", `"${im.name}" couldn't be measured. Remove it and add it again.`, im.name);
    let img;
    try {
      img = im.format === "jpeg" ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes);
    } catch {
      throw new PdfError("unsupported", `"${im.name}" couldn't be read as a ${im.format.toUpperCase()}. Re-save it as a normal JPG or PNG and try again.`, im.name);
    }
    if (img.width !== im.width || img.height !== im.height)
      throw new PdfError("unsupported", `"${im.name}" is stored sideways (it has a rotation flag), so it would come out turned. Re-save it upright and try again.`, im.name);
    let pw: number, ph: number, x = 0, y = 0, w: number, h: number;
    if (size === "fit") {
      [pw, ph] = [(im.width * 72) / dpi, (im.height * 72) / dpi];
      [w, h] = [pw, ph];
    } else {
      let [a, b]: number[] = [...PAGES[size]];
      if (opts.orientation === "landscape" || (opts.orientation !== "portrait" && im.width > im.height)) [a, b] = [b, a];
      [pw, ph] = [a, b];
      if (margin * 2 >= Math.min(pw, ph)) throw new PdfError("unsupported", "The margin is too big for this page size. Use a smaller margin or a bigger page.");
      const s = Math.min((pw - 2 * margin) / im.width, (ph - 2 * margin) / im.height);
      [w, h] = [im.width * s, im.height * s];
      [x, y] = [(pw - w) / 2, (ph - h) / 2];
    }
    doc.addPage([pw, ph]).drawImage(img, { x, y, width: w, height: h });
    o.onProgress?.(i + 1, images.length);
  }
  if (o.producerCredit) {
    applyCredit(doc);
    doc.setCreator(CREATOR); // a new file, so the credit covers Creator too (as in assemble)
  }
  return { bytes: await doc.save({ useObjectStreams: false }), name: "images.pdf", warnings: [] };
}
