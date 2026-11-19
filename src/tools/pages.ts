// Helpers shared by the page tools (merge, organize, extract, split).
import { ops } from "../core/store";
import type { PageSpec } from "../ops/types";
import type { PageItem } from "../ui/pagegrid";
import type { Ctx } from "./types";

export const base = (name: string) => name.replace(/\.pdf$/i, "");

/** [1,2,3,5] -> "1-3, 5" */
export function compress(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return out.join(", ");
}

/** What a rebuilt PDF will lose, per file. */
export function pdfLossWarnings(ctx: Ctx): string[] {
  const w: string[] = [];
  for (const f of ctx.files) {
    const i = f.info!;
    if (i.hasSignatures) w.push(`"${f.name}" has a digital signature. The new file will not carry a valid signature.`);
    if (i.hasXfa) w.push(`"${f.name}" is an XFA form. Its dynamic form parts may not survive.`);
    if (i.hasOutline) w.push(`Bookmarks in "${f.name}" will not be kept.`);
    if (i.hasForms && !i.hasXfa) w.push(`Form fields in "${f.name}" may not stay fillable.`);
    if (i.repaired) w.push(`"${f.name}" had problems and was repaired before reading.`);
  }
  return w;
}

/** Builds one PDF from the chosen grid cards, in their order and rotation. */
export async function assemble(ctx: Ctx, chosen: PageItem[], name: string) {
  const files = ctx.files;
  const pages: PageSpec[] = chosen.map((p) => ({ source: files.indexOf(p.file), page: p.page - 1, rotate: p.rotate as PageSpec["rotate"] }));
  return [await ops.assemble(files, pages, name, ctx.o)];
}
