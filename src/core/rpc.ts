// Tiny typed request/response RPC over postMessage: ids, transfer lists, cancel, progress, PdfError round-trip.
import { PdfError, type PdfErrorCode } from "../ops/types";

type Call = { id: number; method: string; payload: unknown };
type Cancel = { id: number; cancel: true };
type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; code?: PdfErrorCode; message: string; fileName?: string }
  | { id: number; progress: [number, number] };

export interface CallOptions { transfer?: Transferable[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }

export class RpcClient {
  #n = 1;
  #pending = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void; onProgress?: CallOptions["onProgress"] }>();
  constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      const p = this.#pending.get(r.id);
      if (!p) return;
      if ("progress" in r) return p.onProgress?.(r.progress[0], r.progress[1]);
      this.#pending.delete(r.id);
      if (r.ok) p.ok(r.value as never);
      else p.fail(r.code ? new PdfError(r.code, r.message, r.fileName) : new Error(r.message));
    };
    worker.onerror = (e) => {
      for (const p of this.#pending.values()) p.fail(new Error(e.message || "The worker stopped unexpectedly."));
      this.#pending.clear();
    };
  }

  call<T>(method: string, payload: unknown, o: CallOptions = {}): Promise<T> {
    const id = this.#n++;
    return new Promise<T>((ok, fail) => {
      if (o.signal?.aborted) return fail(new PdfError("cancelled", "Cancelled."));
      this.#pending.set(id, { ok: ok as (v: never) => void, fail, onProgress: o.onProgress });
      o.signal?.addEventListener("abort", () => {
        this.worker.postMessage({ id, cancel: true } satisfies Cancel);
        if (this.#pending.delete(id)) fail(new PdfError("cancelled", "Cancelled."));
      }, { once: true });
      this.worker.postMessage({ id, method, payload } satisfies Call, o.transfer ?? []);
    });
  }
}

/** Wrap a return value to transfer buffers instead of copying them. */
export class Transfer { constructor(public value: unknown, public list: Transferable[]) {} }
export interface Ctx { signal: AbortSignal; progress: (done: number, total: number) => void }
type Handler = (payload: never, ctx: Ctx) => unknown;

/** Worker side: `serve({ method: (payload, ctx) => value | Transfer })`. */
export function serve(handlers: Record<string, Handler>): void {
  const g = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent<Call | Cancel>) => void) | null };
  const live = new Map<number, AbortController>();
  g.onmessage = async (e) => {
    const m = e.data;
    if ("cancel" in m) return live.get(m.id)?.abort();
    const ac = new AbortController();
    live.set(m.id, ac);
    try {
      const h = handlers[m.method];
      if (!h) throw new Error(`Unknown method ${m.method}`);
      const out = await h(m.payload as never, { signal: ac.signal, progress: (d, t) => g.postMessage({ id: m.id, progress: [d, t] } satisfies Reply) });
      if (out instanceof Transfer) g.postMessage({ id: m.id, ok: true, value: out.value } satisfies Reply, out.list);
      else g.postMessage({ id: m.id, ok: true, value: out } satisfies Reply);
    } catch (err) {
      const pe = err instanceof PdfError ? err : ac.signal.aborted ? new PdfError("cancelled", "Cancelled.") : null;
      g.postMessage((pe
        ? { id: m.id, ok: false, code: pe.code, message: pe.message, fileName: pe.fileName }
        : { id: m.id, ok: false, message: err instanceof Error ? err.message : String(err) }) satisfies Reply);
    } finally {
      live.delete(m.id);
    }
  };
}
