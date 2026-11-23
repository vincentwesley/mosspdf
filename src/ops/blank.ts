// Blank-page detection: the share of "ink" (not near-white) pixels in a low-resolution RGBA render.
export type Sensitivity = "strict" | "normal" | "loose";
/** A page is blank below this ink share. Strict: a single speck counts; loose: allows scanner dust and faint edges. */
export const BLANK_LIMIT: Record<Sensitivity, number> = { strict: 0.00002, normal: 0.001, loose: 0.006 };
const WHITE = 235; // a pixel is ink when any channel is darker than this

export function inkRatio(rgba: ArrayLike<number>): number {
  const n = rgba.length >> 2;
  let ink = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] > 0 && (rgba[i * 4] < WHITE || rgba[i * 4 + 1] < WHITE || rgba[i * 4 + 2] < WHITE)) ink++;
  return n ? ink / n : 0;
}
export const isBlank = (ratio: number, s: Sensitivity) => ratio <= BLANK_LIMIT[s];
