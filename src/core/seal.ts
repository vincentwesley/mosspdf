// D7: preload every engine asset, spawn the workers, then lock the page with a meta CSP and announce `pagehold:sealed`.
// Add an engine (pdfium, tesseract...) with registerEngine(); nothing else changes.
import { netlog } from "./netlog";

export interface EngineEntry { name: string; load: () => Promise<void> }
export type SealStatus = "preparing" | "sealed" | "failed";

/** Policy D from docs/spikes/csp.md. Workers already running are covered by their own header (connect-src 'none'). */
export const SEAL_CSP = "default-src 'none'; script-src 'wasm-unsafe-eval'; worker-src 'none'; form-action 'none'; base-uri 'none'";

const engines: EngineEntry[] = [];
const subs = new Set<() => void>();
export const seal = {
  status: "preparing" as SealStatus,
  sealedAt: null as Date | null,
  error: null as string | null,
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },
};
const set = (s: SealStatus) => { seal.status = s; subs.forEach((f) => f()); };

export const registerEngine = (e: EngineEntry) => void engines.push(e);

/** Fetch bytes for an engine asset (before the seal only). */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

// After the seal nothing can be fetched: fonts and lazy images must already be in memory.
async function preloadStatic(): Promise<void> {
  const imgs = [...document.images];
  await Promise.all([
    ...["1em 'Space Grotesk'", "600 1em 'Inter'", "1em Inter", "1em Silkscreen", "1em 'JetBrains Mono'", "1em Caveat"].map((f) => document.fonts.load(f)),
    ...imgs.map((i) => { i.loading = "eager"; return i.decode().catch(() => undefined); }),
  ]);
  await document.fonts.ready;
}

let booted: Promise<void> | undefined;
export function bootAndSeal(): Promise<void> {
  return (booted ??= (async () => {
    try {
      await Promise.all([...engines.map((e) => e.load()), preloadStatic()]);
      const meta = document.createElement("meta");
      meta.httpEquiv = "Content-Security-Policy";
      meta.content = SEAL_CSP;
      document.head.append(meta);
      seal.sealedAt = new Date();
      netlog.markSealed();
      set("sealed");
      document.documentElement.dataset.sealed = "true";
      window.dispatchEvent(new Event("pagehold:sealed"));
    } catch (e) {
      seal.error = e instanceof Error ? e.message : String(e);
      set("failed");
    }
  })());
}
