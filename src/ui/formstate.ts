// The form facts of a loaded PDF (fields, XFA, signed), read once per file in the ops worker. Shared by Fill and Sign.
import type { LoadedFile } from "../core/store";
import type { FormInfo } from "../ops/forms";
import type { Ctx } from "../tools/types";

const cache = new WeakMap<LoadedFile, Promise<FormInfo>>();

export function formInfo(ctx: Ctx, f: LoadedFile): Promise<FormInfo> {
  let p = cache.get(f);
  if (!p) {
    p = ctx.call<FormInfo>("readForm", { file: ctx.input(f) });
    cache.set(f, p);
    p.catch(() => cache.delete(f));
  }
  return p;
}

export const SIGNED_WARNING = "This PDF is digitally signed. Changing it will make the existing digital signature invalid.";
