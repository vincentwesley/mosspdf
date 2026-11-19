// Every request the page makes (PerformanceObserver) and every request the CSP stopped (securitypolicyviolation).
// Worker traffic is not visible here: workers carry their own `connect-src 'none'` header.
export interface NetEntry { url: string; blocked: boolean; directive?: string; t: number } // t = performance.now() ms
const entries: NetEntry[] = [];
const subs = new Set<() => void>();
let sealPerf: number | null = null;
const poke = () => subs.forEach((f) => f());

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) entries.push({ url: e.name, blocked: false, t: e.startTime });
    poke();
  }).observe({ type: "resource", buffered: true });
} catch {
  /* resource timing unavailable: the log stays empty and the panel says so */
}
document.addEventListener("securitypolicyviolation", (e) => {
  entries.push({ url: e.blockedURI || "(inline)", blocked: true, directive: e.effectiveDirective, t: performance.now() });
  poke();
});

export const netlog = {
  markSealed: () => { sealPerf = performance.now(); poke(); },
  get sealPerf() { return sealPerf; },
  all: () => [...entries].sort((a, b) => a.t - b.t),
  after: () => entries.filter((e) => sealPerf !== null && e.t >= sealPerf),
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },
};
