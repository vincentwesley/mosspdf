// Memory guard: a plain warning (never a block) before an op that probably needs more memory than this device has.
// Factors come from docs/PERF.md: the worker holds the input, qpdf/pdf-lib copies and the output at once (repair about 3x the file, compress and scan more).
const MB = 1024 * 1024;
const FACTOR: Record<string, number> = { compress: 5, repair: 4, "safety-scan": 4, merge: 3, ocr: 4 };
/** Rough peak memory (bytes) an op on these files needs. */
export const estimateNeed = (toolId: string, bytes: number): number => bytes * (FACTOR[toolId] ?? 3);

/** Memory this tab can reasonably use: a quarter of `navigator.deviceMemory` (GB, rounded down to a power of two, capped at 8 by browsers); 1.5 GB when unknown. */
export function budgetBytes(deviceMemory: number | undefined = (navigator as Navigator & { deviceMemory?: number }).deviceMemory): number {
  return deviceMemory ? (deviceMemory * 1024 * MB) / 4 : 1536 * MB;
}

/** A warning sentence when the op looks too big for this device, else "". */
export function memoryWarning(toolId: string, bytes: number, deviceMemory?: number): string {
  const need = estimateNeed(toolId, bytes);
  if (bytes < 50 * MB || need <= budgetBytes(deviceMemory)) return "";
  return `This is a large file (${Math.round(bytes / MB)} MB). This step may need about ${Math.round(need / MB)} MB of memory, and the browser tab could run out and stop. Close other tabs first, or try anyway.`;
}
