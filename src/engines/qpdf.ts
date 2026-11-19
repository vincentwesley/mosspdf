// qpdf WASM wrapper. Isomorphic: the caller passes the wasm bytes (browser: preloaded, Node: read from node_modules).
// Each call gets a fresh instance (callMain is one-shot) with a virtual FS; calls are serialised to bound memory.
import qpdfModule from "@neslinesli93/qpdf-wasm";

export type Bytes = Uint8Array;
export interface QpdfRun {
  code: number; // 0 ok, 3 ok with warnings, 2 error
  stdout: string;
  stderr: string;
  files: Record<string, Bytes>;
}
/** inputs: virtual path -> bytes (written before the run); outputs: virtual paths to read back (missing ones are skipped). */
export type Qpdf = (args: string[], inputs?: Record<string, Bytes>, outputs?: string[]) => Promise<QpdfRun>;

interface FsLike {
  init: (i: null, o: (c: number | null) => void, e: (c: number | null) => void) => void;
  writeFile: (p: string, d: Bytes) => void;
  readFile: (p: string) => Bytes;
}

export function createQpdf(wasmBinary: Bytes): Qpdf {
  let queue: Promise<unknown> = Promise.resolve();
  const run = async (args: string[], inputs: Record<string, Bytes> = {}, outputs: string[] = []): Promise<QpdfRun> => {
    const q = await (qpdfModule as unknown as (o: object) => Promise<{ callMain: (a: string[]) => number; FS: FsLike }>)({ wasmBinary, noFSInit: true });
    const out: number[] = [];
    const err: number[] = [];
    // The package ignores print/printErr, so hook the stdio devices directly (Module.noFSInit + FS.init).
    q.FS.init(null, (c) => c !== null && out.push(c & 255), (c) => c !== null && err.push(c & 255));
    for (const [p, d] of Object.entries(inputs)) q.FS.writeFile(p, d);
    let code: number;
    try {
      code = q.callMain(args);
    } catch (e) {
      code = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 2;
      if (code === 0) code = 2;
      err.push(...new TextEncoder().encode(String((e as Error).message ?? e)));
    }
    const files: Record<string, Bytes> = {};
    for (const p of outputs) {
      try {
        files[p] = q.FS.readFile(p);
      } catch {
        /* not produced */
      }
    }
    const dec = new TextDecoder();
    return { code, stdout: dec.decode(Uint8Array.from(out)), stderr: dec.decode(Uint8Array.from(err)), files };
  };
  return (a, i, o) => {
    const p = queue.then(() => run(a, i, o));
    queue = p.catch(() => undefined);
    return p;
  };
}
