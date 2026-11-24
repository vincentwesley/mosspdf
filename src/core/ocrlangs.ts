// OCR languages (D21): the allowlist, and the choice kept in the route (`#/ocr?langs=eng+msa`) and, per viewer, in localStorage.
// Adding a language: `npm i @tesseract.js-data/<code>` (pinned, Apache-2.0 data) and one line below; the bundler picks the data up by itself.
// Nothing is ever built from raw input: the route is only ever matched against this list.
export interface OcrLang { code: string; label: string; /** Gzipped model size in MB (best_int). */ mb: number }
export const OCR_LANGS: readonly OcrLang[] = [
  { code: "eng", label: "English", mb: 2.95 },
  { code: "chi_sim", label: "中文 (简体) Chinese", mb: 1.7 },
  { code: "msa", label: "Bahasa Melayu", mb: 1.2 },
  { code: "tam", label: "தமிழ் Tamil", mb: 1.5 },
];
/** The Tesseract engine itself (.wasm), MB. */
export const OCR_ENGINE_MB = 2.9; // 2.86
const KEY = "mosspdf.ocr-langs";

/** Keeps the allowlisted codes, in list order, no duplicates; an empty result is null. */
const clean = (codes: string[]): string[] | null => {
  const out = OCR_LANGS.map((l) => l.code).filter((c) => codes.includes(c));
  return out.length ? out : null;
};

export const langsFromHash = (hash: string): string[] | null => clean((/[?&]langs=([^&]*)/.exec(hash)?.[1] ?? "").split(/[+ ]/));
/** The route without its query: "#/ocr?langs=eng" gives "ocr". */
export const routeOf = (hash: string) => hash.replace(/^#\/?/, "").split("?")[0];
export const hashFor = (codes: string[]) => `#/ocr?langs=${codes.join("+")}`;
export const loadSize = (codes: string[], withEngine = true) => (withEngine ? OCR_ENGINE_MB : 0) + OCR_LANGS.filter((l) => codes.includes(l.code)).reduce((n, l) => n + l.mb, 0);

export function savedLangs(): string[] | null {
  try { return clean((localStorage.getItem(KEY) ?? "").split("+")); } catch { return null; }
}
export function saveLangs(codes: string[]) {
  try { localStorage.setItem(KEY, codes.join("+")); } catch { /* private mode: the route still carries the choice */ }
}
/** What a page booting now should load: the route's choice, else this viewer's last, else English. */
export const chosenLangs = (hash = location.hash) => langsFromHash(hash) ?? savedLangs() ?? ["eng"];
