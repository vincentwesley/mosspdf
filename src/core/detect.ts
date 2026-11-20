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

/** Detector hits in `s`, sorted by position; a hit inside an earlier, longer one (a postal code inside an address) is dropped. */
export function detect(s: string, on: Partial<Detect> = ALL_DETECT): Hit[] {
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

/** Case-insensitive search for `q`; `whole` only matches whole words. */
export function findText(s: string, q: string, whole: boolean): Hit[] {
  q = q.trim();
  if (!q) return [];
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(whole ? String.raw`(?<![\p{L}\p{N}_])${esc}(?![\p{L}\p{N}_])` : esc, "giu");
  return all(re, s, "search");
}

/** A hit for the review list: enough to recognise it, not enough to read it aloud. S1234567D -> S****567D. */
export function mask(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= 4) return s[0] + "*".repeat(s.length - 1);
  const keep = s.length >= 8 ? 4 : 1;
  return s[0] + "*".repeat(Math.min(s.length - 1 - keep, 8)) + s.slice(-keep);
}
