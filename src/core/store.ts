// In-memory file store. Nothing is persisted; "Clear all" drops every byte.
import type { PDFDocumentProxy } from "pdfjs-dist/build/pdf.mjs";
import { opsRpc } from "./engines";
import { openDoc } from "./render";
import { PdfError, type Inspection, type InFile, type OpResult, type PageSpec, type SplitMode } from "../ops/types";
import type { CallOptions } from "./rpc";

export interface LoadedFile {
  id: number; name: string; size: number; password?: string;
  /** PDF bytes. Empty for images: they stay as the original `blob`. */
  bytes: Uint8Array;
  kind: "pdf" | "image";
  status: "loading" | "ready" | "locked" | "error";
  info?: Inspection; error?: string; doc?: Promise<PDFDocumentProxy>;
  /** Images only: the untouched original, its upright size (EXIF orientation applied) and a small preview. */
  blob?: Blob; width?: number; height?: number; thumb?: ImageBitmap;
}
/** What `store.add` keeps; anything else is skipped with a notice. */
export type Intake = "pdf" | "image" | "any";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const THUMB = 160;
export const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isImageFile = (f: File) => /^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
const isHeic = (f: File) => /^image\/hei[cf]$/.test(f.type) || /\.hei[cf]$/i.test(f.name);

/** Decodes an image upright (EXIF orientation applied) into its size and a small preview. Throws when the browser cannot read it. */
async function decodeImage(f: File): Promise<Pick<LoadedFile, "width" | "height" | "thumb">> {
  const full = await createImageBitmap(f, { imageOrientation: "from-image" });
  try {
    const k = Math.min(1, THUMB / Math.max(full.width, full.height));
    const thumb = await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * k)), resizeHeight: Math.max(1, Math.round(full.height * k)), resizeQuality: "medium" });
    return { width: full.width, height: full.height, thumb };
  } finally {
    full.close();
  }
}
let nextId = 1;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const store = {
  files: [] as LoadedFile[],
  busy: false,
  notice: "" as string, // short message about files that were skipped
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },
  setBusy(b: boolean) { store.busy = b; notify(); },

  async add(list: File[], intake: Intake = "pdf"): Promise<LoadedFile[]> {
    const skipped: string[] = [];
    const notes: string[] = [];
    const added: LoadedFile[] = [];
    for (const f of list) {
      if (intake !== "image" && isPdfFile(f)) {
        const lf: LoadedFile = { id: nextId++, kind: "pdf", name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()), status: "loading" };
        store.files.push(lf);
        added.push(lf);
      } else if (intake !== "pdf" && isImageFile(f)) {
        try {
          const lf: LoadedFile = { id: nextId++, kind: "image", name: f.name, size: f.size, bytes: new Uint8Array(0), blob: f, status: "ready", ...(await decodeImage(f)) };
          store.files.push(lf);
        } catch {
          notes.push(isHeic(f) ? `"${f.name}" is a HEIC photo this browser cannot read. Convert it to JPG first, then add it again.` : `"${f.name}" could not be read as an image.`);
        }
      } else skipped.push(f.name);
    }
    if (skipped.length) {
      const what = intake === "pdf" ? "a PDF" : intake === "image" ? "a JPG, PNG or WebP image" : "a PDF or an image";
      notes.unshift(`${skipped.length === 1 ? `"${skipped[0]}" is` : `${skipped.length} files are`} not ${what} and was skipped.${intake === "pdf" ? " To turn images into a PDF, use Images to PDF." : ""}`);
    }
    store.notice = notes.join(" ");
    notify();
    await Promise.all(added.map((f) => store.check(f)));
    return added;
  },
  /** Puts back files taken out with remove() (undo). */
  restore(files: LoadedFile[]) { store.files.splice(0, store.files.length, ...files); notify(); },

  /** (Re)inspects a file; sets locked when it needs a password. */
  async check(f: LoadedFile): Promise<void> {
    f.status = "loading";
    f.error = undefined;
    notify();
    try {
      if (!f.bytes.length) throw new PdfError("empty", "This file is empty. Choose a different file.", f.name);
      if (!PDF_MAGIC.every((b, i) => f.bytes[i] === b) && !new TextDecoder().decode(f.bytes.subarray(0, 1024)).includes("%PDF")) {
        throw new PdfError("not-pdf", "This is not a PDF file. Choose a PDF instead.", f.name);
      }
      f.info = await opsRpc.call<Inspection>("inspect", { file: toIn(f) });
      f.status = f.info.needsPassword ? "locked" : "ready";
      if (f.status === "locked" && f.password) f.error = "That password did not work.";
    } catch (e) {
      if (e instanceof PdfError && (e.code === "encrypted" || e.code === "wrong-password")) {
        f.status = "locked";
        f.error = e.code === "wrong-password" ? "That password did not work." : undefined;
      } else {
        f.status = "error";
        f.error = errorMessage(e);
      }
    }
    notify();
  },

  async unlock(f: LoadedFile, password: string): Promise<void> {
    f.password = password;
    f.doc = undefined;
    await store.check(f);
  },

  remove(id: number) {
    const i = store.files.findIndex((f) => f.id === id);
    if (i < 0) return;
    void store.files[i].doc?.then((d) => d.loadingTask.destroy()).catch(() => undefined);
    store.files[i].doc = undefined;
    store.files.splice(i, 1);
    notify();
  },
  clear() { [...store.files].forEach((f) => store.remove(f.id)); store.notice = ""; },
  move(id: number, to: number) {
    const i = store.files.findIndex((f) => f.id === id);
    if (i < 0 || to < 0 || to >= store.files.length) return;
    store.files.splice(to, 0, ...store.files.splice(i, 1));
    notify();
  },
  /** Applies a new order given as ids (from drag and drop). */
  reorder(ids: number[]) {
    store.files.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    notify();
  },
  ready: (kind: LoadedFile["kind"] = "pdf") => store.files.filter((f) => f.kind === kind && f.status === "ready"),
  doc(f: LoadedFile): Promise<PDFDocumentProxy> { return (f.doc ??= openDoc(f.bytes, f.password)); },
};

export const toIn = (f: LoadedFile): InFile => ({ name: f.name, bytes: f.bytes, password: f.password });

export const prefs = {
  get producerCredit(): boolean {
    try { return localStorage.getItem("mosspdf:producerCredit") !== "false"; } catch { return true; }
  },
  set producerCredit(v: boolean) {
    try { localStorage.setItem("mosspdf:producerCredit", String(v)); } catch { /* not remembered */ }
  },
};

// Typed ops calls (run in the ops worker; the result buffers are transferred back).
const base = (extra: CallOptions) => ({ ...extra });
export const ops = {
  merge: (files: LoadedFile[], o: CallOptions, bookmarks = false) => opsRpc.call<OpResult>("merge", { files: files.map(toIn), bookmarks, o: { producerCredit: prefs.producerCredit } }, base(o)),
  assemble: (files: LoadedFile[], pages: PageSpec[], name: string, o: CallOptions) =>
    opsRpc.call<OpResult>("assemble", { files: files.map(toIn), pages, name, o: { producerCredit: prefs.producerCredit } }, base(o)),
  split: (file: LoadedFile, mode: SplitMode, o: CallOptions) => opsRpc.call<OpResult[]>("split", { file: toIn(file), mode, o: { producerCredit: prefs.producerCredit } }, base(o)),
};

/** Plain message for any failure: what happened, then what to do (each PdfError message carries both). */
export function errorMessage(e: unknown): string {
  if (e instanceof PdfError) {
    const who = e.fileName && !e.message.includes(e.fileName) ? `"${e.fileName}": ` : "";
    return `${who}${e.message}${e.code === "cancelled" && !/nothing was changed/i.test(e.message) ? " Nothing was changed." : ""}`;
  }
  return "Something went wrong with this file. Your files are still here. Try again, or remove the file and add it again.";
}
