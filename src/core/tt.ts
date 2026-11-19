// Trusted Types: the header sets `require-trusted-types-for 'script'` + `trusted-types pagehold`.
// Worker and service-worker URLs are the only script sinks we use; this policy lets same-origin URLs through.
interface TT { createPolicy(name: string, rules: { createScriptURL(u: string): string }): { createScriptURL(u: string): string } }
const tt = (globalThis as unknown as { trustedTypes?: TT }).trustedTypes;
const policy = tt?.createPolicy("pagehold", {
  createScriptURL(u) {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin) throw new TypeError("Only scripts from this site can be loaded.");
    return url.href;
  },
});
export const scriptUrl = (u: string): string => (policy ? policy.createScriptURL(u) : u);
