// In-memory file store. Nothing is persisted; "Clear all" drops every byte.
import type { PDFDocumentProxy } from "pdfjs-dist/build/pdf.mjs";
import { opsRpc } from "./engines";
import { openDoc } from "./render";
import { PdfError, type Inspection, type InFile, type OpResult, type PageSpec, type SplitMode } from "../ops/types";
import type { CallOptions } from "./rpc";

export interface LoadedFile {
  id: number; name: string; size: number; bytes: Uint8Array; password?: string;
  status: "loading" | "ready" | "locked" | "error";
  info?: Inspection; error?: string; doc?: Promise<PDFDocumentProxy>;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
let nextId = 1;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const store = {
  files: [] as LoadedFile[],
  busy: false,
  notice: "" as string, // short message about files that were skipped
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },
  setBusy(b: boolean) { store.busy = b; notify(); },

  async add(list: File[]): Promise<LoadedFile[]> {
    const skipped: string[] = [];
    const added: LoadedFile[] = [];
    for (const f of list) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!isPdf) { skipped.push(f.name); continue; }
      const lf: LoadedFile = { id: nextId++, name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()), status: "loading" };
      store.files.push(lf);
      added.push(lf);
    }
    store.notice = skipped.length
      ? `${skipped.length === 1 ? `"${skipped[0]}" is` : `${skipped.length} files are`} not a PDF and was skipped. Turning images into PDFs is coming soon.`
      : "";
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
      if (!f.bytes.length) throw new PdfError("empty", "This file is empty.", f.name);
      if (!PDF_MAGIC.every((b, i) => f.bytes[i] === b) && !new TextDecoder().decode(f.bytes.subarray(0, 1024)).includes("%PDF")) {
        throw new PdfError("not-pdf", "This is not a PDF file.", f.name);
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
  ready: () => store.files.filter((f) => f.status === "ready"),
  doc(f: LoadedFile): Promise<PDFDocumentProxy> { return (f.doc ??= openDoc(f.bytes, f.password)); },
};

const toIn = (f: LoadedFile): InFile => ({ name: f.name, bytes: f.bytes, password: f.password });

export const prefs = {
  get producerCredit(): boolean {
    try { return localStorage.getItem("pagehold:producerCredit") !== "false"; } catch { return true; }
  },
  set producerCredit(v: boolean) {
    try { localStorage.setItem("pagehold:producerCredit", String(v)); } catch { /* not remembered */ }
  },
};

// Typed ops calls (run in the ops worker; the result buffers are transferred back).
const base = (extra: CallOptions) => ({ ...extra });
export const ops = {
  merge: (files: LoadedFile[], o: CallOptions) => opsRpc.call<OpResult>("merge", { files: files.map(toIn), o: { producerCredit: prefs.producerCredit } }, base(o)),
  assemble: (files: LoadedFile[], pages: PageSpec[], name: string, o: CallOptions) =>
    opsRpc.call<OpResult>("assemble", { files: files.map(toIn), pages, name, o: { producerCredit: prefs.producerCredit } }, base(o)),
  split: (file: LoadedFile, mode: SplitMode, o: CallOptions) => opsRpc.call<OpResult[]>("split", { file: toIn(file), mode, o: { producerCredit: prefs.producerCredit } }, base(o)),
};

/** Plain message + next step for any failure. */
export function errorMessage(e: unknown): string {
  if (e instanceof PdfError) {
    const who = e.fileName ? `"${e.fileName}": ` : "";
    const next: Record<string, string> = {
      "not-pdf": "Choose a PDF file instead.",
      empty: "Choose a different file.",
      corrupt: "Try opening it in another app and saving a fresh copy, then add it again.",
      encrypted: "Enter its password to open it.",
      "wrong-password": "Check the password and try again.",
      unsupported: "Pagehold cannot handle this kind of file yet.",
      "too-large": "Try a smaller file, or split it elsewhere first.",
      cancelled: "Nothing was changed.",
    };
    return `${who}${e.message} ${next[e.code] ?? ""}`.trim();
  }
  return `Something went wrong: ${e instanceof Error ? e.message : String(e)}. Your files are still here. Try again, or remove the file and add it again.`;
}
