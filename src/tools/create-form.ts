// Create form: place fields on the pages (edit.ts machinery: page viewer, click to place, drag to move, drag the corner or +/- to resize,
// arrows nudge, Delete removes, Undo/Redo). Each field has a name, a required switch and a text size, listed and editable beside the pages.
import type { CreateFormInput, NewField, NewFieldKind } from "../ops/createform";
import type { OpResult } from "../ops/types";
import type { Rect } from "../core/textpos";
import { FIELD_NAME, WIN_ANSI } from "../core/winansi";
import { announce, h } from "../ui/dom";
import { clamp, place, resizeHandle, wireBox } from "../ui/boxlayer";
import { checkField, numberField, radioGroup, textField } from "../ui/fields";
import { formInfo, SIGNED_WARNING } from "../ui/formstate";
import { pageView, type Slot } from "../ui/pageview";
import type { Ctx, ToolDef } from "./types";

const NAMES: Record<NewFieldKind, string> = { text: "Text", multiline: "Multi-line text", checkbox: "Checkbox", date: "Date", dropdown: "Dropdown", signature: "Signature box" };
const PREFIX: Record<NewFieldKind, string> = { text: "Text", multiline: "Multiline", checkbox: "Checkbox", date: "Date", dropdown: "Dropdown", signature: "Signature" };
/** Default box size (fractions of the page); a checkbox is made square on the page. */
const SIZES: Record<NewFieldKind, [number, number]> = { text: [0.3, 0.035], multiline: [0.4, 0.1], checkbox: [0.035, 0.035], date: [0.2, 0.035], dropdown: [0.3, 0.035], signature: [0.35, 0.06] };
const HAS_SIZE = (k: NewFieldKind) => k !== "checkbox";
const UNDO_MAX = 50;
const clean = (s: string) => s.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 40);

interface Item {
  id: number;
  kind: NewFieldKind;
  page: number; // 0-based
  r: Rect; // top-left and size as fractions of the shown page
  name: string;
  required: boolean;
  size: number; // pt, 0 = automatic
  options: string[];
  pw: number; ph: number; // that page's shown size in pt
}

let nextId = 1;

const ui = (ctx: Ctx) => ctx.local(() => {
  const s = {
    fileId: undefined as number | undefined,
    signed: false,
    xfa: false,
    existing: new Set<string>(),
    items: [] as Item[],
    els: new Map<number, HTMLElement>(),
    rows: new Map<number, { input: HTMLInputElement; msg: HTMLElement }>(),
    kind: radioGroup({ name: "cf-kind", legend: "Kind of field", value: "text", testid: (v) => `cf-kind-${v}`, onChange: () => ctx.refresh(), options: (Object.keys(NAMES) as NewFieldKind[]).map((k) => [k, NAMES[k]]) }),
    size: numberField({ id: "cf-size", label: "Text size (pt, 0 = automatic)", value: 12, min: 0, max: 96, step: 1, testid: "cf-size" }),
    options: textField({ id: "cf-options", label: "Choices, separated by commas", testid: "cf-options", msgTestId: "cf-options-msg", placeholder: "Red, Green, Blue" }),
    required: checkField({ id: "cf-required", label: "Required", testid: "cf-required" }),
    undoBtn: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Undo", attrs: { "data-testid": "cf-undo" } }),
    redoBtn: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Redo", attrs: { "data-testid": "cf-redo" } }),
    past: [] as Item[][],
    future: [] as Item[][],
    pageNo: numberField({ id: "cf-pageno", label: "Page number", value: 1, min: 1, step: 1, testid: "cf-pageno", onInput: () => ctx.refresh() }),
    place: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Place on page", attrs: { "data-testid": "cf-place" } }),
    msg: h("p", { class: "field__msg", attrs: { role: "status", "data-testid": "cf-msg" } }),
    list: h("ul", { class: "sg-list", attrs: { role: "list", "data-testid": "cf-list" } }),
    hint: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "cf-hint" } }),
    note: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "note", "data-testid": "cf-note" } }),
    pv: pageView({ onSlot: (slot) => paint(slot) }),
    root: h("div", { class: "sign cf" }),
  };
  const step = (n: number, title: string, ...kids: HTMLElement[]) => h("section", { class: "sg-step" }, h("h3", { text: `${n}. ${title}` }), ...kids);
  const placed = h("section", { class: "sg-placed", attrs: { "aria-labelledby": "cf-placed-h" } }, h("h3", { id: "cf-placed-h", text: "Fields" }),
    h("div", { class: "sg-where" }, s.undoBtn, s.redoBtn), s.list);
  s.root.append(
    s.hint,
    h("div", { class: "sg-layout" },
      h("div", { class: "sg-side" },
        step(1, "Choose a field", s.kind.el, s.size.el, s.options.el, s.required.el, s.note),
        step(2, "Place it",
          h("p", { class: "sg-help", text: "Click or tap a page to place it there. Drag to move, drag the corner or press + and - to resize, arrow keys nudge (Shift for bigger steps), Delete removes." }),
          h("div", { class: "sg-where" }, s.pageNo.el, s.place), s.msg),
        placed),
      s.pv.el));
  let base: Item[] = [], last = 0;
  s.undoBtn.addEventListener("click", () => stepHistory(-1));
  s.redoBtn.addEventListener("click", () => stepHistory(1));
  const keys = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!s.root.isConnected || s.root.hidden || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === "z") stepHistory(e.shiftKey ? 1 : -1);
    else if (k === "y") stepHistory(1);
    else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", keys);
  return Object.assign(s, { add, renderList, begin, reset, problem, stop: () => document.removeEventListener("keydown", keys) });

  // ---- undo / redo: snapshots of the items array (same model as edit.ts) ----
  function copy(it: Item): Item { return { ...it, r: { ...it.r }, options: [...it.options] }; }
  function snap(): Item[] { return s.items.map(copy); }
  function changed(force = false): void {
    const now = Date.now();
    if (force || now - last > 600) { s.past.push(base); if (s.past.length > UNDO_MAX) s.past.shift(); s.future.length = 0; }
    base = snap(); last = force ? 0 : now;
    updateUndo();
  }
  function updateUndo(): void { s.undoBtn.disabled = !s.past.length; s.redoBtn.disabled = !s.future.length; }
  function reset(): void { s.past.length = s.future.length = 0; base = []; last = 0; updateUndo(); }
  function stepHistory(dir: -1 | 1): void {
    const from = dir < 0 ? s.past : s.future, to = dir < 0 ? s.future : s.past;
    const target = from.pop();
    if (!target) { announce(dir < 0 ? "Nothing to undo." : "Nothing to redo."); return; }
    to.push(snap());
    s.els.forEach((el) => el.remove());
    s.els.clear();
    s.items.splice(0, s.items.length, ...target.map(copy));
    s.pv.slots.forEach(paint);
    base = snap(); last = 0;
    renderList(); updateUndo();
    announce(`${dir < 0 ? "Undone" : "Redone"}. ${s.items.length} field${s.items.length === 1 ? "" : "s"} placed.`);
    ctx.refresh();
  }

  /** Why this item's name can't be used, or "". */
  function problem(it: Item): string {
    if (!it.name.trim()) return "Give the field a name.";
    if (!FIELD_NAME.test(it.name)) return "Use letters, digits, spaces, dashes or underscores.";
    if (s.existing.has(it.name)) return "A field in this PDF already has this name.";
    if (s.items.some((o) => o !== it && o.name === it.name)) return "Another field has this name.";
    return "";
  }
  function validate(): void {
    for (const it of s.items) {
      const row = s.rows.get(it.id), why = problem(it);
      if (!row) continue;
      row.msg.textContent = why;
      if (why) row.input.setAttribute("aria-invalid", "true"); else row.input.removeAttribute("aria-invalid");
    }
  }
  function autoName(kind: NewFieldKind): string {
    const taken = new Set([...s.existing, ...s.items.map((i) => i.name)]);
    let n = 1;
    while (taken.has(`${PREFIX[kind]} ${n}`)) n++;
    return `${PREFIX[kind]} ${n}`;
  }

  function describe(it: Item): string { return `${NAMES[it.kind]} "${it.name}" on page ${it.page + 1}. Arrow keys move it, plus and minus resize it, Delete removes it.`; }

  function paint(slot: Slot): void {
    for (const it of s.items) if (it.page === slot.index && !s.els.has(it.id) && slot.vp) mount(it, slot);
  }
  function mount(it: Item, slot: Slot): void {
    const el = h("div", { class: `sg-item cf-field cf-${it.kind}`, attrs: { tabindex: 0, role: "group", "aria-label": describe(it), "data-testid": "sg-item", "data-kind": it.kind } },
      h("span", { class: "cf-field__name", text: it.name, attrs: { "aria-hidden": "true" } }));
    s.els.set(it.id, el);
    slot.overlay.append(el);
    place(el, it.r);
    const ratio = it.kind === "checkbox" ? it.ph / it.pw : undefined; // w / h (page fractions) of a square
    resizeHandle(el, it.r, slot.overlay, () => changed(), ratio);
    wireBox(el, it.r, slot.overlay, { onChange: () => changed(), onDelete: () => remove(it), ratio });
  }

  function remove(it: Item): void {
    const i = s.items.indexOf(it);
    if (i < 0) return;
    s.items.splice(i, 1);
    s.els.get(it.id)?.remove();
    s.els.delete(it.id);
    changed(true);
    renderList();
    announce(`${NAMES[it.kind]} "${it.name}" removed.`);
    s.place.focus();
    ctx.refresh();
  }

  function renderList(): void {
    s.rows.clear();
    s.list.replaceChildren(...s.items.map((it, k) => {
      const input = h("input", { class: "hs-input", type: "text", attrs: { "aria-label": `Name of field ${k + 1} (${NAMES[it.kind]}, page ${it.page + 1})`, autocomplete: "off", spellcheck: "false", maxlength: 40, "data-testid": "cf-name" } });
      input.value = it.name;
      const msg = h("p", { class: "field__msg", attrs: { role: "status", "data-testid": "cf-name-msg" } });
      s.rows.set(it.id, { input, msg });
      input.addEventListener("input", () => {
        const v = clean(input.value);
        if (v !== input.value) input.value = v;
        it.name = v;
        const el = s.els.get(it.id);
        if (el) { el.querySelector(".cf-field__name")!.textContent = v; el.setAttribute("aria-label", describe(it)); }
        changed();
        validate();
        ctx.refresh();
      });
      const req = checkField({ id: `cf-req-${it.id}`, label: "Required", testid: "cf-req", checked: it.required, onChange: () => { it.required = req.input.checked; changed(true); } });
      const size = HAS_SIZE(it.kind) ? numberField({ id: `cf-sz-${it.id}`, label: "Text size", value: it.size, min: 0, max: 96, step: 1, testid: "cf-row-size", onInput: () => { it.size = clamp(Number(size?.input.value) || 0, 0, 96); changed(); } }) : undefined;
      return h("li", { class: "sg-row cf-row", attrs: { "data-testid": "cf-row" } },
        h("span", { class: "sg-row__what", text: `${NAMES[it.kind]}, page ${it.page + 1}${it.kind === "dropdown" ? `: ${it.options.join(", ")}` : ""}` }),
        h("div", { class: "field" }, input, msg), req.el, size?.el,
        h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Remove", attrs: { "aria-label": `Remove field ${it.name}`, "data-testid": "cf-row-remove" }, on: { click: () => remove(it) } }));
    }));
    validate();
  }

  /** Puts the chosen field on `slot` at (cx, cy), fractions of the page. Says why when it can't. */
  function add(slot: Slot, cx: number, cy: number): void {
    const vp = slot.vp;
    s.msg.textContent = "";
    if (!vp) return;
    const kind = s.kind.value() as NewFieldKind;
    let options: string[] = [];
    if (kind === "dropdown") {
      options = s.options.input.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (!options.length) { s.msg.textContent = "Type the choices first, separated by commas."; return; }
      if (new Set(options).size !== options.length) { s.msg.textContent = "A choice is listed twice."; return; }
      if (options.some((o) => o.length > 100 || ![...o].every((c) => WIN_ANSI.test(c)))) { s.msg.textContent = "Choices can only use Latin letters, digits and basic punctuation, up to 100 characters each."; return; }
    }
    const [w, d] = SIZES[kind];
    const hh = kind === "checkbox" ? (w * vp.width) / vp.height : d;
    const it: Item = { id: nextId++, kind, page: slot.index, r: { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - hh / 2, 0, 1 - hh), w, h: hh }, name: autoName(kind), required: s.required.input.checked, size: clamp(Number(s.size.input.value) || 0, 0, 96), options, pw: vp.width, ph: vp.height };
    s.items.push(it);
    mount(it, slot);
    changed(true);
    renderList();
    announce(`${NAMES[kind]} added on page ${it.page + 1}.`);
    const el = s.els.get(it.id)!;
    el.scrollIntoView({ block: "center", behavior: "auto" });
    el.focus({ preventScroll: true });
    ctx.refresh();
  }

  /** Click on a page overlay (not on a field) places the chosen field there. */
  function begin(slot: Slot): void {
    slot.overlay.addEventListener("click", (e) => {
      if (e.target !== slot.overlay) return;
      const r = slot.overlay.getBoundingClientRect();
      const [cx, cy] = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      void s.pv.ensure(slot.index).then(() => add(slot, cx, cy));
    });
  }
});

export const createFormTool: ToolDef = {
  id: "create-form", title: "Create form", heading: "Create a fillable form", group: "Fill and sign",
  blurb: "Add fields people can fill in.",
  lede: "Click a page to add text boxes, checkboxes, dates, dropdowns and signature areas. Anyone can then fill them in a PDF reader, or here with Fill forms.",
  how: "Add a PDF, click a page to place fields, name them, then save the form.",
  accepts: "pdf",
  next: ["fill", "protect", "compress"],
  options(ctx) {
    const u = ui(ctx);
    u.place.addEventListener("click", () => {
      const i = Number(u.pageNo.input.value) - 1;
      const slot = u.pv.slots[i];
      if (!slot) { u.msg.textContent = "Type a page number that exists in this PDF."; return; }
      void u.pv.ensure(i).then(() => { slot.wrap.scrollIntoView({ block: "center" }); u.add(slot, 0.5, 0.5); });
    });
    return u.root;
  },
  sync(ctx) {
    const u = ui(ctx);
    const f = ctx.file;
    if (f?.id !== u.fileId) {
      u.fileId = f?.id;
      u.signed = u.xfa = false;
      u.existing = new Set();
      u.items.length = 0;
      u.els.clear();
      u.reset();
      u.renderList();
      u.msg.textContent = "";
      u.pv.setFile(f);
      u.pv.slots.forEach((slot) => u.begin(slot));
      if (f) formInfo(ctx, f).then((i) => {
        if (u.fileId !== f.id) return;
        u.signed = i.signed; u.xfa = i.hasXFA; u.existing = new Set(i.fields.map((x) => x.name));
        u.renderList(); ctx.refresh();
      }, () => undefined);
    }
    u.pageNo.input.max = String(f?.info?.pageCount ?? 1);
    u.hint.hidden = !!f;
    u.hint.textContent = "Add a PDF above to start.";
    const k = u.kind.value() as NewFieldKind;
    u.root.querySelectorAll<HTMLElement>(".sg-side, .vw").forEach((e) => (e.hidden = !f));
    u.size.el.hidden = !HAS_SIZE(k);
    u.options.el.hidden = k !== "dropdown";
    u.note.hidden = k !== "signature" && k !== "date" && !u.xfa;
    u.note.textContent = u.xfa ? "This PDF has an old-style (XFA) form. Fields can't be added to it." : k === "signature" ? "A signature box is an empty area to sign by hand or with Sign. It is not a certificate (digital) signature field." : "A date field is a text box with a hint. It does not check the date.";
  },
  warnings(ctx) { return ui(ctx).signed ? [SIGNED_WARNING] : []; },
  ready(ctx) { const u = ui(ctx); return !!ctx.file && !u.xfa && u.items.length > 0 && u.items.every((it) => !u.problem(it)); },
  whyDisabled(ctx) {
    const u = ui(ctx);
    if (!ctx.file) return "";
    if (u.xfa) return "Fields can't be added to an XFA form.";
    return u.items.length ? (u.items.some((it) => u.problem(it)) ? "Fix the field names first." : "") : "Place a field on a page first.";
  },
  primaryLabel: () => "Save form",
  destroy(ctx) { const u = ui(ctx); u.stop(); u.pv.destroy(); },
  async run(ctx) {
    const u = ui(ctx);
    const fields: NewField[] = u.items.map((it) => ({ kind: it.kind, name: it.name, page: it.page, x: it.r.x, y: it.r.y, w: it.r.w, h: it.r.h, required: it.required, size: it.size, options: it.options }));
    const input: CreateFormInput = { fields };
    return [await ctx.call<OpResult>("createForm", { file: ctx.input(ctx.file!), input, o: { producerCredit: ctx.producerCredit } })];
  },
};
