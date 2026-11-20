// Fill forms: real HTML inputs laid over the rendered pages at each widget's rectangle, plus a plain fields list that stays in sync
// (the list works with a screen reader, a keyboard and a small phone screen). The op writes the values and the appearances (D15).
import { errorMessage } from "../core/store";
import type { FieldValue, FormField, FormInfo, FormWidget } from "../ops/forms";
import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { checkField } from "../ui/fields";
import { pageView, rectToFractions, type Slot } from "../ui/pageview";
import { formInfo, SIGNED_WARNING } from "../ui/formstate";
import type { Ctx, ToolDef } from "./types";

const FILLABLE = (f: FormField) => f.type !== "signature" && f.type !== "button";
const same = (a: FieldValue, b: FieldValue) => (Array.isArray(a) && Array.isArray(b) ? a.join("\n") === b.join("\n") : a === b);
let uid = 0;

const ui = (ctx: Ctx) => ctx.local(() => {
  const s = {
    fileId: undefined as number | undefined,
    info: undefined as FormInfo | undefined,
    loading: false,
    error: "",
    values: new Map<string, FieldValue>(),
    changed: new Set<string>(),
    setters: new Map<string, ((v: FieldValue) => void)[]>(),
    hint: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "fill-hint" } }),
    pv: pageView({ onSlot: (slot) => buildSlot(slot) }),
    list: h("div", { class: "fill__list", attrs: { "data-testid": "fields-list" } }),
    listBox: h("details", { class: "more fill__listbox", attrs: { open: true } }, h("summary", { text: "Fields list" })),
    flatten: checkField({ id: "fill-flatten", label: "Flatten: make the answers part of the page, so they can't be edited later", testid: "fill-flatten" }),
    phone: h("p", { class: "hs-banner hs-banner--info fill__phone", text: "On a small screen, fill in the form in the fields list below the pages." }),
    root: h("div", { class: "fill" }),
  };
  s.listBox.append(h("p", { class: "fill__note", text: "The same fields as on the pages, in order. Use this list with a screen reader or on a small screen." }), s.list);
  s.root.append(s.hint, h("div", { class: "fill__layout" }, h("div", { class: "fill__side" }, s.flatten.el, s.phone, s.listBox), s.pv.el));
  return Object.assign(s, { load });

  function cur(f: FormField): FieldValue { return s.values.get(f.name) ?? f.value; }
  function change(f: FormField, v: FieldValue) {
    if (same(v, cur(f))) return;
    s.values.set(f.name, v);
    s.changed.add(f.name);
    s.setters.get(f.name)?.forEach((fn) => fn(v));
    ctx.refresh();
  }
  function track(f: FormField, fn: (v: FieldValue) => void): void { (s.setters.get(f.name) ?? s.setters.set(f.name, []).get(f.name)!).push(fn); }
  function label(f: FormField): string { return f.required ? `${f.name} (required)` : f.name; }

  /** One control for a field (or one widget of a radio group). `l` is its visible label's id, when there is one. */
  function control(f: FormField, w?: FormWidget, aria?: string, radioName = ""): HTMLElement {
    const lab = aria ?? label(f);
    const ro = f.readOnly;
    if (f.type === "text") {
      const el = f.multiline ? h("textarea", { class: "hs-input", attrs: { "aria-label": lab } }) : h("input", { class: "hs-input", type: "text", attrs: { "aria-label": lab, autocomplete: "off" } });
      el.value = cur(f) as string;
      if (f.maxLength) el.maxLength = f.maxLength;
      el.disabled = ro;
      el.addEventListener("input", () => change(f, el.value));
      track(f, (v) => { if (el.value !== v) el.value = v as string; });
      return el;
    }
    if (f.type === "checkbox") {
      const el = h("input", { class: "hs-check", type: "checkbox", attrs: { "aria-label": lab } });
      el.checked = cur(f) as boolean;
      el.disabled = ro;
      el.addEventListener("change", () => change(f, el.checked));
      track(f, (v) => { el.checked = v as boolean; });
      return el;
    }
    if (f.type === "radio") {
      const el = h("input", { class: "hs-check hs-check--radio", type: "radio", attrs: { "aria-label": lab, name: radioName, value: w?.onValue } });
      el.checked = cur(f) === w?.onValue;
      el.disabled = ro;
      el.addEventListener("change", () => { if (el.checked && w?.onValue !== undefined) change(f, w.onValue); });
      track(f, (v) => { el.checked = v === w?.onValue; });
      return el;
    }
    const multi = f.type === "optionlist";
    const el = h("select", { class: "hs-select", attrs: { "aria-label": lab, multiple: multi } }, ...(multi ? [] : [h("option", { text: "", attrs: { value: "" } })]), ...(f.options ?? []).map((o) => h("option", { text: o, attrs: { value: o } })));
    const set = (v: FieldValue) => { for (const o of el.options) o.selected = Array.isArray(v) ? v.includes(o.value) : o.value === v; };
    set(cur(f));
    el.disabled = ro;
    el.addEventListener("change", () => change(f, multi ? [...el.selectedOptions].map((o) => o.value) : el.value));
    track(f, set);
    return el;
  }

  function buildSlot(slot: Slot) {
    if (!s.info || !slot.vp || slot.overlay.dataset.built) return;
    slot.overlay.dataset.built = "1";
    const vp = slot.vp;
    for (const f of s.info.fields.filter(FILLABLE)) {
      const radioName = `ov-${uid++}`;
      for (const w of f.widgets.filter((x) => x.page === slot.index)) {
        const r = rectToFractions(vp, w.rect);
        const aria = f.type === "radio" ? `${label(f)}: ${w.onValue}` : undefined;
        const el = control(f, w, aria, radioName);
        el.classList.add("vw__ctl", `vw__ctl--${f.type}`);
        el.style.left = `${r.left * 100}%`;
        el.style.top = `${r.top * 100}%`;
        el.style.width = `${r.width * 100}%`;
        el.style.height = `${r.height * 100}%`;
        if (f.type === "text" || f.type === "dropdown") el.style.fontSize = `${(Math.min(Math.max(r.height * vp.height * 0.6, 6), 14) / vp.width) * 100}cqw`;
        if (f.type === "optionlist" || f.multiline) el.style.fontSize = `${(11 / vp.width) * 100}cqw`;
        slot.overlay.append(el);
      }
    }
  }

  function buildList(info: FormInfo) {
    const rows = info.fields.filter(FILLABLE).map((f) => {
      const id = `ff-${uid++}`;
      if (f.type === "radio") {
        const name = `ls-${uid++}`;
        const opts = f.widgets.map((w) => w.onValue).filter((v): v is string => v !== undefined);
        return h("fieldset", { class: "radios field" }, h("legend", { text: label(f) }),
          ...opts.map((o, k) => {
            const w = f.widgets.find((x) => x.onValue === o)!;
            const el = control(f, w, `${label(f)}: ${o}`, name);
            el.id = `${id}-${k}`;
            return h("div", { class: "radios__opt" }, el, h("label", { text: o, attrs: { for: el.id } }));
          }));
      }
      const el = control(f, undefined, label(f));
      el.id = id;
      el.removeAttribute("aria-label");
      if (f.type === "checkbox") return h("div", { class: "field field--check" }, el, h("label", { text: label(f), attrs: { for: id } }));
      return h("div", { class: "field" }, h("label", { text: label(f), attrs: { for: id } }), el);
    });
    s.list.replaceChildren(...rows);
  }

  /** The file changed or its form was read: start over. */
  function load(f: NonNullable<typeof ctx.file>) {
    s.loading = true;
    s.error = "";
    formInfo(ctx, f).then((info) => {
      if (s.fileId !== f.id) return;
      s.loading = false;
      s.info = info;
      s.values.clear();
      s.changed.clear();
      s.setters.clear();
      buildList(info);
      const pages = new Set(info.fields.filter(FILLABLE).flatMap((x) => x.widgets.map((w) => w.page)).filter((p) => p >= 0));
      for (const i of pages) { const slot = s.pv.slots[i]; if (slot?.vp) buildSlot(slot); else if (slot) void s.pv.ensure(i); }
      ctx.refresh();
    }, (e: unknown) => {
      if (s.fileId !== f.id) return;
      s.loading = false;
      s.error = errorMessage(e);
      ctx.refresh();
    });
  }
});

const editable = (u: ReturnType<typeof ui>) => u.info?.fields.filter(FILLABLE) ?? [];

export const fill: ToolDef = {
  id: "fill", title: "Fill forms", heading: "Fill in a form", group: "Fill and sign",
  blurb: "Fill in a PDF form.",
  lede: "Type into the fields of a PDF form, on the page or in the list below, then save a filled copy.",
  accepts: "pdf",
  options(ctx) { return ui(ctx).root; },
  sync(ctx) {
    const u = ui(ctx);
    const f = ctx.file;
    if (f?.id !== u.fileId) {
      u.fileId = f?.id;
      u.info = undefined;
      u.values.clear(); u.changed.clear(); u.setters.clear();
      u.list.replaceChildren();
      u.pv.setFile(f);
      if (f) u.load(f);
    }
    const n = editable(u).length;
    const none = !!u.info && n === 0;
    u.hint.hidden = !!u.info && n > 0;
    u.hint.replaceChildren(
      ...(!f ? ["Add a PDF form above to start."]
        : u.error ? [u.error]
        : u.loading || !u.info ? ["Reading the form..."]
        : none ? ["This PDF has no form fields Pagehold can fill. To put your name, a date or a signature anywhere on a page, use ", h("a", { href: "#/sign", text: "Sign", attrs: { "data-testid": "fill-to-sign" } }), "."]
        : []));
    u.flatten.el.hidden = u.pv.el.hidden = u.phone.hidden = u.listBox.hidden = !u.info || n === 0;
  },
  warnings(ctx) {
    const u = ui(ctx);
    const w: string[] = [];
    if (u.info?.signed) w.push(SIGNED_WARNING);
    if (u.info?.hasXFA) w.push(editable(u).length
      ? "This form also contains XFA data (an Adobe-only form layout). Pagehold fills the standard fields and removes the XFA data from the copy it saves."
      : "This form is built with XFA, an old Adobe-only form format. Pagehold can't fill it in. Open it in Adobe Acrobat Reader, or ask the sender for a standard PDF form.");
    return w;
  },
  ready(ctx) { return !!ctx.file && editable(ui(ctx)).some((f) => !f.readOnly); },
  primaryLabel: () => "Save filled form",
  destroy(ctx) { ui(ctx).pv.destroy(); },
  async run(ctx) {
    const u = ui(ctx);
    const values = Object.fromEntries([...u.changed].map((n) => [n, u.values.get(n)!]));
    return [await ctx.call<OpResult>("fillForm", { file: ctx.input(ctx.file!), values, flatten: u.flatten.input.checked, o: { producerCredit: ctx.producerCredit } })];
  },
};
