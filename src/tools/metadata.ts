import type { Metadata, MetadataEdit } from "../ops/metadata";
import type { OpResult } from "../ops/types";
import { errorMessage } from "../core/store";
import { h } from "../ui/dom";
import { checkField, textField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const KEYS = ["title", "author", "subject", "keywords"] as const;
type Key = (typeof KEYS)[number];
const LABEL: Record<Key, string> = { title: "Title", author: "Author", subject: "Subject", keywords: "Keywords" };

const ui = (ctx: Ctx) => ctx.local(() => {
  const fields = Object.fromEntries(KEYS.map((k) => [k, textField({ id: `md-${k}`, label: LABEL[k], testid: `md-${k}`, onInput: () => ctx.refresh() })])) as Record<Key, ReturnType<typeof textField>>;
  return {
    fields,
    wipe: checkField({ id: "md-wipe", label: "Remove all details (title, author, dates, and so on)", testid: "md-remove-all", onChange: () => ctx.refresh() }),
    status: h("p", { class: "field__hint", attrs: { role: "status", "data-testid": "md-status" } }),
    info: h("dl", { class: "md__info", attrs: { "data-testid": "md-info" } }),
    credit: h("p", { class: "field__hint", attrs: { "data-testid": "md-credit" } }),
    box: h("div", { class: "stampopts" }),
    /** What the file had when read (or last saved): only fields that differ are sent. */
    orig: {} as Record<Key, string>,
    loadedId: 0,
    state: "idle" as "idle" | "loading" | "ready" | "failed",
  };
});

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

function load(ctx: Ctx) {
  const u = ui(ctx);
  const f = ctx.file;
  if (!f || u.loadedId === f.id) return;
  u.loadedId = f.id;
  u.state = "loading";
  u.orig = { title: "", author: "", subject: "", keywords: "" };
  for (const k of KEYS) u.fields[k].input.value = "";
  u.info.replaceChildren();
  void ctx.call<Metadata>("readMetadata", { file: ctx.input(f) }).then((m) => {
    if (u.loadedId !== f.id) return;
    for (const k of KEYS) { u.orig[k] = m[k] ?? ""; u.fields[k].input.value = u.orig[k]; }
    const rows: [string, string | undefined][] = [["Made with", m.creator], ["Last saved by", m.producer], ["Created", when(m.created)], ["Changed", when(m.modified)]];
    u.info.replaceChildren(...rows.filter(([, v]) => v).flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
    u.state = "ready";
    ctx.refresh();
  }, (e: unknown) => {
    if (u.loadedId !== f.id) return;
    u.state = "failed";
    u.status.textContent = errorMessage(e);
    ctx.refresh();
  });
}

const changed = (ctx: Ctx) => { const u = ui(ctx); return KEYS.filter((k) => u.fields[k].input.value !== u.orig[k]); };

export const metadata: ToolDef = {
  id: "metadata", title: "Metadata", heading: "Edit a PDF's details", group: "Edit",
  blurb: "Edit title, author and details.",
  lede: "See and change the title, author and other details stored inside a PDF, or remove them all.",
  accepts: "pdf", batch: true,
  options(ctx) {
    const u = ui(ctx);
    u.box.append(u.status, ...KEYS.map((k) => u.fields[k].el), u.info, u.wipe.el, u.credit);
    return u.box;
  },
  sync(ctx) {
    const u = ui(ctx);
    load(ctx);
    u.box.hidden = !ctx.file;
    const wipe = u.wipe.input.checked;
    for (const k of KEYS) { u.fields[k].input.disabled = wipe || u.state !== "ready"; u.fields[k].el.hidden = false; }
    if (u.state === "loading") u.status.textContent = "Reading the file's details…";
    else if (u.state === "ready") u.status.textContent = wipe ? "Everything above will be removed from the file." : "";
    u.info.hidden = wipe || !u.info.childElementCount;
    u.credit.textContent = wipe
      ? "Nothing is added to the file."
      : ctx.producerCredit ? "MossPDF will note itself in the Producer field (\"MossPDF by Vin's Atelier\"). You can switch that off under Output settings." : "MossPDF will not add its name to the file.";
  },
  ready(ctx) { const u = ui(ctx); return !!ctx.file && u.state === "ready" && (u.wipe.input.checked || changed(ctx).length > 0); },
  primaryLabel(ctx) { return ui(ctx).wipe.input.checked ? "Remove all details" : "Save details"; },
  async run(ctx) {
    const u = ui(ctx);
    const edit: MetadataEdit = u.wipe.input.checked ? { removeAll: true } : Object.fromEntries(changed(ctx).map((k) => [k, u.fields[k].input.value]));
    const r = await ctx.call<OpResult>("writeMetadata", { file: ctx.input(ctx.file!), edit, o: { producerCredit: ctx.producerCredit } });
    if (!edit.removeAll) for (const k of KEYS) u.orig[k] = u.fields[k].input.value;
    return [r];
  },
};
