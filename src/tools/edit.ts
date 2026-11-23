// Edit PDF: add text, white-out boxes, highlights, rectangles and lines to the pages (sign.ts machinery: page viewer, click to place,
// drag to move, drag the corner or +/- to resize, arrows nudge, Delete removes). Nothing already on the page is changed or removed (D27).
import type { EditInput, EditItem } from "../ops/edit";
import type { OpResult } from "../ops/types";
import type { Rect } from "../core/textpos";
import { badChars, ZH_HINT, zhWouldHelp } from "../core/winansi";
import { announce, h } from "../ui/dom";
import { clamp, place, resizeHandle, wireBox } from "../ui/boxlayer";
import { numberField, radioGroup, textField } from "../ui/fields";
import { formInfo, SIGNED_WARNING } from "../ui/formstate";
import { pageView, type Slot } from "../ui/pageview";
import { baselineRatio } from "./sign";
import type { Ctx, ToolDef } from "./types";

type Kind = "text" | "whiteout" | "highlight" | "rect" | "line";
const NAMES: Record<Kind, string> = { text: "Text", whiteout: "White-out", highlight: "Highlight", rect: "Rectangle", line: "Line" };
const COLOURS: Record<string, string> = { black: "#000000", blue: "#1a3a8a", red: "#c62828" };
/** Default box size (fractions of the page) for each shape. A line lower than FLAT is level; taller, it runs corner to corner. */
const SIZES: Record<string, [number, number]> = { whiteout: [0.3, 0.04], highlight: [0.3, 0.025], rect: [0.25, 0.1], line: [0.3, 0.01] };
const FLAT = 0.012;
const SVG = "http://www.w3.org/2000/svg";

interface Item {
  id: number;
  kind: Kind;
  page: number; // 0-based
  r: Rect; // top-left and size as fractions of the shown page (text: only x and y count)
  size: number; // text: pt
  text?: string;
  color: string;
  stroke: number; // pt (rectangle, line)
  flip: boolean; // line: runs bottom-left to top-right
  pw: number; ph: number; // that page's shown size in pt
}

let nextId = 1;

const ui = (ctx: Ctx) => ctx.local(() => {
  const s = {
    fileId: undefined as number | undefined,
    signed: false,
    items: [] as Item[],
    els: new Map<number, HTMLElement>(),
    kind: radioGroup({ name: "ed-kind", legend: "What to add", value: "text", testid: (v) => `ed-kind-${v}`, onChange: () => ctx.refresh(), options: (Object.keys(NAMES) as Kind[]).map((k) => [k, NAMES[k]]) }),
    text: textField({ id: "ed-text", label: "Text to add", testid: "ed-text", msgTestId: "ed-text-msg", reserve: true, onInput: () => ctx.refresh() }),
    size: numberField({ id: "ed-size", label: "Text size", value: 14, min: 6, max: 200, step: 1, testid: "ed-size" }),
    colour: radioGroup({ name: "ed-colour", legend: "Colour", value: "black", testid: (v) => `ed-colour-${v}`, options: [["black", "Black"], ["blue", "Dark blue"], ["red", "Red"]] }),
    stroke: radioGroup({ name: "ed-stroke", legend: "Line width", value: "2", testid: (v) => `ed-stroke-${v}`, options: [["1", "Thin"], ["2", "Medium"], ["4", "Thick"]] }),
    pageNo: numberField({ id: "ed-pageno", label: "Page number", value: 1, min: 1, step: 1, testid: "ed-pageno", onInput: () => ctx.refresh() }),
    place: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Place on page", attrs: { "data-testid": "ed-place" } }),
    msg: h("p", { class: "field__msg", attrs: { role: "status", "data-testid": "ed-msg" } }),
    list: h("ul", { class: "sg-list", attrs: { role: "list", "data-testid": "ed-list" } }),
    hint: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "edit-hint" } }),
    cover: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "note", "data-testid": "ed-cover" } }, "White-out only covers what is under it. The words are still in the file and can be copied. To remove them for good, use ", h("a", { href: "#/redact", text: "Redact" }), "."),
    pv: pageView({ onSlot: (slot) => paint(slot) }),
    root: h("div", { class: "sign ed" }),
  };
  const step = (n: number, title: string, ...kids: HTMLElement[]) => h("section", { class: "sg-step" }, h("h3", { text: `${n}. ${title}` }), ...kids);
  const placed = h("section", { class: "sg-placed", attrs: { "aria-labelledby": "ed-placed-h" } }, h("h3", { id: "ed-placed-h", text: "Added items" }), s.list);
  s.root.append(
    s.hint,
    h("div", { class: "sg-layout" },
      h("div", { class: "sg-side" },
        step(1, "Choose what to add", s.kind.el, s.text.el, s.size.el, s.colour.el, s.stroke.el, s.cover),
        step(2, "Place it",
          h("p", { class: "sg-help", text: "Click or tap a page to place it there. Drag to move, drag the corner or press + and - to resize, arrow keys nudge (Shift for bigger steps), Delete removes." }),
          h("div", { class: "sg-where" }, s.pageNo.el, s.place), s.msg),
        placed),
      s.pv.el));
  return Object.assign(s, { add, renderList, begin });

  function label(it: Item) { return `${NAMES[it.kind]}${it.text ? `: ${it.text}` : ""}, page ${it.page + 1}`; }
  function describe(it: Item) { return `${NAMES[it.kind]} on page ${it.page + 1}. Arrow keys move it, plus and minus resize it, Delete removes it.`; }

  function layout(it: Item, el: HTMLElement): void {
    if (it.kind === "text") {
      el.style.left = `${it.r.x * 100}%`; el.style.top = `${it.r.y * 100}%`;
      el.style.fontSize = `${(it.size / it.pw) * 100}cqw`;
      return;
    }
    place(el, it.r);
    if (it.kind === "rect") el.style.borderWidth = `${(it.stroke / it.pw) * 100}cqw`;
    if (it.kind === "line") {
      const ln = el.querySelector("line")!;
      const flat = it.r.h < FLAT;
      ln.setAttribute("y1", flat ? "50" : it.flip ? "100" : "0");
      ln.setAttribute("y2", flat ? "50" : it.flip ? "0" : "100");
      ln.style.strokeWidth = `${(it.stroke / it.pw) * 100}cqw`;
    }
  }

  function paint(slot: Slot): void {
    for (const it of s.items) if (it.page === slot.index && !s.els.has(it.id) && slot.vp) mount(it, slot);
  }
  function mount(it: Item, slot: Slot): void {
    const el = h("div", { class: `sg-item ed-${it.kind}`, attrs: { tabindex: 0, role: "group", "aria-label": describe(it), "data-testid": "sg-item", "data-kind": it.kind } });
    if (it.kind === "text") { el.append(h("span", { class: "sg-item__text", text: it.text })); el.style.color = it.color; }
    if (it.kind === "rect") el.style.borderColor = it.color;
    if (it.kind === "line") {
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "ed-line__svg");
      const ln = document.createElementNS(SVG, "line");
      ln.setAttribute("x1", "0"); ln.setAttribute("x2", "100"); ln.setAttribute("vector-effect", "non-scaling-stroke");
      ln.style.stroke = it.color;
      svg.append(ln);
      el.append(svg);
    }
    s.els.set(it.id, el);
    slot.overlay.append(el);
    layout(it, el);
    const overlay = slot.overlay;
    if (it.kind === "text") textBehaviour(it, el, overlay);
    else {
      resizeHandle(el, it.r, overlay, () => layout(it, el));
      wireBox(el, it.r, overlay, { onChange: () => layout(it, el), onDelete: () => remove(it) });
    }
  }

  /** Text: drag to move, drag the corner or +/- to change the size (a box would not scale the letters). */
  function textBehaviour(it: Item, el: HTMLElement, overlay: HTMLElement): void {
    const handle = h("span", { class: "sg-item__handle", attrs: { "aria-hidden": "true" } });
    el.append(handle);
    const apply = () => {
      it.size = clamp(it.size, 4, 200);
      layout(it, el);
      const [w, hh] = [el.offsetWidth / overlay.clientWidth, el.offsetHeight / overlay.clientHeight];
      it.r.x = clamp(it.r.x, 0, 1 - w); it.r.y = clamp(it.r.y, 0, 1 - hh);
      layout(it, el);
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault(); e.stopPropagation();
      el.focus();
      el.setPointerCapture(e.pointerId);
      const size = e.target === handle;
      const b = overlay.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, fx: it.r.x, fy: it.r.y, size: it.size, w: el.offsetWidth };
      const move = (m: PointerEvent) => {
        const dx = (m.clientX - start.x) / b.width, dy = (m.clientY - start.y) / b.height;
        if (size) it.size = (start.size * (start.w + dx * b.width)) / start.w; else { it.r.x = start.fx + dx; it.r.y = start.fy + dy; }
        apply();
      };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      const b = overlay.getBoundingClientRect();
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(it); return; }
      if (e.key === "ArrowLeft") it.r.x -= step / b.width;
      else if (e.key === "ArrowRight") it.r.x += step / b.width;
      else if (e.key === "ArrowUp") it.r.y -= step / b.height;
      else if (e.key === "ArrowDown") it.r.y += step / b.height;
      else if (e.key === "+" || e.key === "=") it.size *= 1.08;
      else if (e.key === "-") it.size /= 1.08;
      else return;
      e.preventDefault();
      apply();
    });
  }

  function remove(it: Item): void {
    const i = s.items.indexOf(it);
    if (i < 0) return;
    s.items.splice(i, 1);
    s.els.get(it.id)?.remove();
    s.els.delete(it.id);
    renderList();
    announce(`${NAMES[it.kind]} removed.`);
    s.place.focus();
    ctx.refresh();
  }

  function renderList(): void {
    s.list.replaceChildren(...s.items.map((it, k) => h("li", { class: "sg-row", attrs: { "data-testid": "ed-row" } },
      h("span", { class: "sg-row__what", text: label(it) }),
      it.kind === "line" && h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Flip", attrs: { "aria-label": `Flip line ${k + 1} (page ${it.page + 1})` }, on: { click: () => { it.flip = !it.flip; const el = s.els.get(it.id); if (el) layout(it, el); } } }),
      h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Remove", attrs: { "aria-label": `Remove ${NAMES[it.kind].toLowerCase()} ${k + 1} (page ${it.page + 1})`, "data-testid": "ed-row-remove" }, on: { click: () => remove(it) } }))));
  }

  /** Puts the chosen thing on `slot` at (cx, cy), fractions of the page. Says why when it can't. */
  function add(slot: Slot, cx: number, cy: number): void {
    const vp = slot.vp;
    s.msg.textContent = "";
    if (!vp) return;
    const kind = s.kind.value() as Kind;
    const it: Item = { id: nextId++, kind, page: slot.index, r: { x: 0, y: 0, w: 0, h: 0 }, size: 14, color: COLOURS[s.colour.value()], stroke: Number(s.stroke.value()), flip: false, pw: vp.width, ph: vp.height };
    if (kind === "text") {
      const text = s.text.input.value.trim();
      if (!text) { s.msg.textContent = "Type the text to add first."; return; }
      const bad = badChars(text);
      if (bad.length) { s.msg.textContent = "That text has characters that can't be used yet. Use Latin, Greek or Cyrillic letters, digits and basic punctuation." + (zhWouldHelp(bad) ? ZH_HINT : ""); return; }
      it.size = clamp(Number(s.size.input.value) || 14, 6, 200);
      it.text = text;
      it.r = { x: clamp(cx, 0, 0.95), y: clamp(cy - (it.size * 0.6) / vp.height, 0, 0.97), w: 0, h: 0 };
    } else {
      const [w, hh] = SIZES[kind];
      it.r = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - hh / 2, 0, 1 - hh), w, h: hh };
    }
    s.items.push(it);
    mount(it, slot);
    const el = s.els.get(it.id)!;
    if (kind === "text") { it.r.x = clamp(it.r.x, 0, 1 - el.offsetWidth / slot.overlay.clientWidth); layout(it, el); }
    renderList();
    announce(`${NAMES[kind]} added on page ${it.page + 1}.`);
    el.scrollIntoView({ block: "center", behavior: "auto" });
    el.focus({ preventScroll: true });
    ctx.refresh();
  }

  /** Click on a page overlay (not on an item) places the chosen thing there. */
  function begin(slot: Slot): void {
    slot.overlay.addEventListener("click", (e) => {
      if (e.target !== slot.overlay) return;
      const r = slot.overlay.getBoundingClientRect();
      const [cx, cy] = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      void s.pv.ensure(slot.index).then(() => add(slot, cx, cy));
    });
  }
});

export const edit: ToolDef = {
  id: "edit", title: "Edit PDF", heading: "Edit a PDF", group: "Edit",
  blurb: "Add text, highlights and shapes.",
  lede: "Click a page to add text, a highlight, a rectangle or a line. White-out covers what is under it, but does not remove it.",
  accepts: "pdf",
  next: ["sign", "compress", "protect"],
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
      u.signed = false;
      u.items.length = 0;
      u.els.clear();
      u.renderList();
      u.msg.textContent = "";
      u.pv.setFile(f);
      u.pv.slots.forEach((slot) => u.begin(slot));
      if (f) formInfo(ctx, f).then((i) => { if (u.fileId === f.id && i.signed !== u.signed) { u.signed = i.signed; ctx.refresh(); } }, () => undefined);
    }
    u.pageNo.input.max = String(f?.info?.pageCount ?? 1);
    u.hint.hidden = !!f;
    u.hint.textContent = "Add a PDF above to start.";
    const k = u.kind.value() as Kind;
    u.root.querySelectorAll<HTMLElement>(".sg-side, .vw").forEach((e) => (e.hidden = !f));
    u.text.el.hidden = u.size.el.hidden = k !== "text";
    u.colour.el.hidden = k === "whiteout" || k === "highlight";
    u.stroke.el.hidden = k !== "rect" && k !== "line";
    u.cover.hidden = k !== "whiteout" && !u.items.some((it) => it.kind === "whiteout");
    const bad = badChars(u.text.input.value);
    u.text.setMessage(k === "text" && bad.length ? `These characters cannot be used yet: ${bad.map((c) => `"${c}"`).join(" ")}. Use Latin, Greek or Cyrillic letters, digits and basic punctuation.${zhWouldHelp(bad) ? ZH_HINT : ""}` : "", k === "text" && bad.length > 0);
  },
  warnings(ctx) { return ui(ctx).signed ? [SIGNED_WARNING] : []; },
  ready(ctx) { return !!ctx.file && ui(ctx).items.length > 0; },
  whyDisabled: (ctx) => (ctx.file && !ui(ctx).items.length ? "Add something to a page first." : ""),
  primaryLabel: () => "Save edited copy",
  destroy(ctx) { ui(ctx).pv.destroy(); },
  async run(ctx) {
    const u = ui(ctx);
    const items: EditItem[] = u.items.map((it): EditItem => {
      const { x, y, w, h: hh } = it.r;
      if (it.kind === "text") return { kind: "text", page: it.page, text: it.text!, size: it.size, color: it.color, x, y: y + (baselineRatio() * it.size) / it.ph };
      if (it.kind === "line") {
        const flat = hh < FLAT;
        return { kind: "line", page: it.page, color: it.color, stroke: it.stroke, x1: x, x2: x + w, y1: flat ? y + hh / 2 : it.flip ? y + hh : y, y2: flat ? y + hh / 2 : it.flip ? y : y + hh };
      }
      if (it.kind === "rect") return { kind: "rect", page: it.page, color: it.color, stroke: it.stroke, x, y, w, h: hh };
      return { kind: it.kind, page: it.page, x, y, w, h: hh };
    });
    const input: EditInput = { items };
    return [await ctx.call<OpResult>("editPages", { file: ctx.input(ctx.file!), input, o: { producerCredit: ctx.producerCredit } })];
  },
};
