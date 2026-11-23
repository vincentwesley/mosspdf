// Optional extra text font (D24, D30): one of Simplified/Traditional Chinese, Japanese, Korean, kept per viewer in localStorage. Changing it reloads
// the page so the font is fetched before the seal, like the OCR languages (D21). Off by default: the default load is unchanged.
export const LANGS = ["sc", "tc", "jp", "kr"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAME: Record<Lang, string> = { sc: "Simplified Chinese", tc: "Traditional Chinese", jp: "Japanese", kr: "Korean" };
const KEY = "mosspdf.text-lang", OLD = "mosspdf.text-zh";
/** The chosen language, or undefined when off. The old D24 switch (`mosspdf.text-zh` = 1) counts as Simplified Chinese. */
export const cjkLang = (): Lang | undefined => {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return LANGS.find((l) => l === v);
    return localStorage.getItem(OLD) === "1" ? "sc" : undefined;
  } catch { return undefined; }
};
export function setCjkLang(l: Lang | undefined) {
  try { localStorage.setItem(KEY, l ?? "off"); localStorage.removeItem(OLD); } catch { /* private mode: nothing to keep, the reload still happens */ }
}
