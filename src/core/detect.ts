// Finds things worth redacting in plain text: Singapore NRIC/FIN, phone numbers, emails, postal codes, street addresses, and free text.
// Pure and isomorphic (no DOM). Every function takes a string and returns character ranges; positions on the page live in textpos.ts.

export type Kind = "nric" | "phone" | "email" | "address" | "postal" | "search" | "manual";
export interface Hit {
  kind: Kind;
  /** [start, end) in the searched string. */
  start: number;
  end: number;
  text: string;
  /** Shown beside the hit when the user should look twice (an M-series number whose check letter can't be verified, D6). */
  note?: string;
}

export const KIND_LABEL: Record<Kind, string> = {
  nric: "NRIC / FIN numbers", phone: "Phone numbers", email: "Email addresses", address: "Street addresses",
  postal: "Postal codes", search: "Words you searched for", manual: "Boxes you drew",
};

const W_ST = "JZIHGFEDCBA";
const W_FG = "XWUTRQPNMLK";
/** True when `id` (S1234567D) has the right check letter. S/T and F/G use the published checksum; M is not verifiable (D6) and returns undefined. */
export function nricValid(id: string): boolean | undefined {
  const m = /^([STFGM])(\d{7})([A-Z])$/.exec(id.toUpperCase());
  if (!m) return false;
  if (m[1] === "M") return undefined;
  const w = [2, 7, 6, 5, 4, 3, 2];
  let sum = [...m[2]].reduce((a, d, i) => a + Number(d) * w[i], 0);
  if (m[1] === "T" || m[1] === "G") sum += 4;
  return (m[1] === "S" || m[1] === "T" ? W_ST : W_FG)[sum % 11] === m[3];
}

const STREET = "(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Crescent|Cres|Close|Walk|Boulevard|Blvd|Way|STREET|ST|ROAD|RD|AVENUE|AVE|DRIVE|DR|LANE|CRESCENT|CLOSE|WALK|BOULEVARD|WAY)";
const UNIT = String.raw`(?:\s*,?\s*#\d{1,3}-\d{1,4}[A-Z]?\b)?`;
const POST = String.raw`(?:\s*,?\s*(?:Singapore\s*)?\d{6}\b)?`;
const NAME = String.raw`[A-Z][A-Za-z'.-]*`;
const RE = {
  nric: /(?<![A-Za-z0-9])[STFGMstfgm]\d{7}[A-Za-z](?![A-Za-z0-9])/g,
  phone: /(?<![\d])(?:\+65[ -]?)?[3689]\d{3}[ -]?\d{4}(?!\d)/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  // Blk 123 Ang Mo Kio Ave 6, #12-34 (Singapore 560123)
  block: new RegExp(String.raw`\b(?:Blk|BLK|Block|BLOCK)\.?\s*\d{1,4}[A-Z]?(?:\s+[A-Za-z0-9'.-]+){0,5}?\s+${STREET}\b\.?(?:\s+\d{1,3}\b)?${UNIT}${POST}`, "g"),
  // 12 Orchard Road
  street: new RegExp(String.raw`\b\d{1,4}[A-Z]?\s+(?:${NAME}\s+){0,4}?${NAME}\s+${STREET}\b\.?(?:\s+\d{1,3}\b)?${UNIT}${POST}`, "g"),
  unit: /(?<!\w)#\d{1,3}-\d{1,4}[A-Z]?\b/g,
  postal: /\b(?:Singapore|S'pore)\s*\(?(\d{6})\b|\bS\((\d{6})\)/gi,
};

function all(re: RegExp, s: string, kind: Kind, pick?: (m: RegExpExecArray) => { start: number; end: number } | undefined): Hit[] {
  const out: Hit[] = [];
  for (const m of s.matchAll(re)) {
    const r = pick ? pick(m as RegExpExecArray) : { start: m.index!, end: m.index! + m[0].length };
    if (r) out.push({ kind, start: r.start, end: r.end, text: s.slice(r.start, r.end) });
  }
  return out;
}

export interface Detect { nric: boolean; phone: boolean; email: boolean; address: boolean; postal: boolean }
export const ALL_DETECT: Detect = { nric: true, phone: true, email: true, address: true, postal: true };

/** `s` with every line break read as a space and a hyphen at a line end joined to the next line ("Pe-\nreira" -> "Pereira"), so a match can
 *  run over a wrapped line. `map[i]` is the index in `s` of flat character i. */
function flatten(s: string): { flat: string; map: number[] } {
  let flat = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "-" && s[i + 1] === "\n" && /\p{L}/u.test(s[i - 1] ?? "") && /\p{L}/u.test(s[i + 2] ?? "")) { i++; continue; }
    flat += s[i] === "\n" ? " " : s[i];
    map.push(i);
  }
  return { flat, map };
}
/** The hits found in the flattened text, as ranges and text of the original string. */
function unflatten(hits: Hit[], s: string, map: number[]): Hit[] {
  return hits.map((h) => {
    const start = map[h.start], end = map[h.end - 1] + 1;
    return { ...h, start, end, text: s.slice(start, end) };
  });
}

/** Detector hits in `s` (lines may wrap anywhere), sorted by position; a hit inside an earlier, longer one (a postal code inside an address) is dropped. */
export function detect(s: string, on: Partial<Detect> = ALL_DETECT): Hit[] {
  const { flat, map } = flatten(s);
  return unflatten(detectFlat(flat, on), s, map);
}
function detectFlat(s: string, on: Partial<Detect>): Hit[] {
  const hits: Hit[] = [];
  if (on.nric) {
    for (const h of all(RE.nric, s, "nric")) {
      const v = nricValid(h.text);
      if (v === false) continue;
      hits.push(v === undefined ? { ...h, note: "Check this one: the check letter of M numbers can't be verified." } : h);
    }
  }
  if (on.phone) hits.push(...all(RE.phone, s, "phone"));
  if (on.email) hits.push(...all(RE.email, s, "email"));
  if (on.address) hits.push(...all(RE.block, s, "address"), ...all(RE.street, s, "address"), ...all(RE.unit, s, "address"));
  if (on.postal) hits.push(...all(RE.postal, s, "postal", (m) => { const d = m[1] ?? m[2]; const e = m.index! + m[0].length; return { start: e - d.length - (m[2] ? 1 : 0), end: e - (m[2] ? 1 : 0) }; }));
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: Hit[] = [];
  for (const h of hits) if (!out.some((o) => h.start < o.end && h.end > o.start)) out.push(h);
  return out;
}

export const escRe = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive search for `q`, also across a line wrap; `whole` only matches whole words. */
export function findText(s: string, q: string, whole: boolean): Hit[] {
  q = q.trim();
  if (!q) return [];
  const esc = escRe(q).replace(/\s+/g, "\\s+");
  const re = new RegExp(whole ? String.raw`(?<![\p{L}\p{N}_])${esc}(?![\p{L}\p{N}_])` : esc, "giu");
  const { flat, map } = flatten(s);
  return unflatten(all(re, flat, "search"), s, map);
}

/** Does `hay` contain `needle` (any capitalisation)? Needles under 4 characters only count as a whole word, so "Tan" is not found in "Tangent". */
export function has(hay: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  const h = hay.toLowerCase();
  if (n.length >= 4) return h.includes(n);
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])${escRe(n)}(?![\p{L}\p{N}_])`, "u").test(h);
}

/** A hit for the review list: enough to recognise it, not enough to read it aloud. S1234567D -> S****567D. */
export function mask(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= 4) return s[0] + "*".repeat(s.length - 1);
  const keep = s.length >= 8 ? 4 : 1;
  return s[0] + "*".repeat(Math.min(s.length - 1 - keep, 8)) + s.slice(-keep);
}
