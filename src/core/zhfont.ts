// Optional Simplified Chinese font (D24): one switch, kept per viewer in localStorage. Turning it on reloads the page so the font is fetched
// before the seal, like the OCR languages (D21). Off by default: the default load is unchanged.
const KEY = "mosspdf.text-zh";
export const zhOn = (): boolean => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};
export function setZh(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode: nothing to keep, the reload still happens */ }
}
