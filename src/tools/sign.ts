// Sign: make a signature or initials (draw, type, upload), or a date or some text, and place it on the pages: click or tap a page
// (or use "Place on page"), drag to move, drag the corner or press + and - to resize, arrow keys to nudge, Delete to remove.
// It is a picture on the page, not a certified digital signature (D15). Nothing is stored.
import type { StampInput, StampItem } from "../ops/sign";
import type { OpResult } from "../ops/types";
import { announce, h } from "../ui/dom";
import { checkField, numberField, radioGroup, selectField, textField } from "../ui/fields";
import { pageView, type Slot } from "../ui/pageview";
import { PEN, sigMaker, toPng } from "../ui/sigmaker";
type Maker = ReturnType<typeof sigMaker>;
import { formInfo, SIGNED_WARNING } from "../ui/formstate";
import { badChars } from "../core/winansi";
import type { Ctx, ToolDef } from "./types";

interface Item {
  id: number;
  what: string; // "Signature", "Initials", "Date", "Text"
  page: number; // 0-based page it was placed on
  all: boolean; // repeat on every page
  fx: number; fy: number; // top-left, fraction of the shown page (from its top left)
  fw: number; // pictures: width as a fraction of the page width
  size: number; // text: pt
  pw: number; ph: number; // that page's shown size in pt
  canvas?: HTMLCanvasElement;
  text?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const DATES: Record<string, (d: Date) => string> = {
  long: (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  dmy: (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
  iso: (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
};
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/** Where the baseline sits in a 1.2-line-high box of the text font, as a fraction of its size (browsers differ, so it is measured). */
let blRatio: number | undefined;
function baselineRatio() {
  if (blRatio === undefined) {
    const m = document.createElement("canvas").getContext("2d")!;
    m.font = "100px Helvetica, Arial, sans-serif";
    const t = m.measureText("Hg");
    const asc = (t.fontBoundingBoxAscent ?? 90.5) / 100, desc = (t.fontBoundingBoxDescent ?? 21.2) / 100;
    blRatio = (1.2 - (asc + desc)) / 2 + asc;
  }
  return blRatio;
}

let nextId = 1;

const ui = (ctx: Ctx) => ctx.local(() => {
  const s = {
    fileId: undefined as number | undefined,
    signed: false,
    items: [] as Item[],
    els: new Map<number, HTMLElement>(),
    pen: radioGroup({ name: "sg-pen", legend: "Pen colour", value: "black", testid: (v) => `pen-${v}`, onChange: () => { sig.refresh(); ini.refresh(); ctx.refresh(); }, options: [["black", "Black"], ["blue", "Blue"]] }),
    kind: radioGroup({ name: "sg-kind", legend: "What to place", value: "signature", testid: (v) => `kind-${v}`, onChange: () => ctx.refresh(), options: [["signature", "Signature"], ["initials", "Initials"], ["date", "Date"], ["text", "Text"]] }),
    dateFmt: selectField({ id: "sg-datefmt", label: "Date format", testid: "sg-datefmt", onInput: () => ctx.refresh(), options: [["long", ""], ["dmy", ""], ["iso", ""]] }),
    text: textField({ id: "sg-text", label: "Text to place", testid: "sg-text", msgTestId: "sg-text-msg", reserve: true, onInput: () => ctx.refresh() }),
    all: checkField({ id: "sg-all", label: "Put it on every page", testid: "sg-all" }),
    pageNo: numberField({ id: "sg-pageno", label: "Page number", value: 1, min: 1, step: 1, testid: "sg-pageno", onInput: () => ctx.refresh() }),
    place: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Place on page", attrs: { "data-testid": "sg-place" } }),
    msg: h("p", { class: "field__msg", attrs: { role: "status", "data-testid": "sg-msg" } }),
    list: h("ul", { class: "sg-list", attrs: { role: "list", "data-testid": "sg-list" } }),
    hint: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "sign-hint" } }),
    pv: pageView({ onSlot: (slot) => paint(slot) }),
    root: h("div", { class: "sign" }),
  };
  const sig: Maker = sigMaker({ id: "sg-sig", name: "signature", colour: () => PEN[s.pen.value() as keyof typeof PEN], onChange: () => ctx.refresh() });
  const ini: Maker = sigMaker({ id: "sg-ini", name: "initials", colour: () => PEN[s.pen.value() as keyof typeof PEN], onChange: () => ctx.refresh() });
  const sigBox = h("div", { class: "sg-make", attrs: { "data-testid": "sg-sig-box" } }, h("h4", { text: "Your signature" }), sig.el);
  const iniBox = h("div", { class: "sg-make", attrs: { "data-testid": "sg-ini-box" } }, h("h4", { text: "Your initials" }), ini.el);
  const note = h("p", { class: "sg-note", text: "MossPDF does not save your signature. It stays in this tab until you close it." });
  const disclaimer = h("p", { class: "hs-banner hs-banner--info", text: "This adds a picture of your signature. It is not a certified digital signature, and some organisations require one. It does not prove who signed or that the file has not changed. Whether it is accepted depends on the recipient.", attrs: { role: "note", "data-testid": "sign-disclaimer" } });
  const today = new Date();
  [...s.dateFmt.input.options].forEach((o) => { o.textContent = DATES[o.value](today); });
  const placed = h("section", { class: "sg-placed", attrs: { "aria-labelledby": "sg-placed-h" } }, h("h3", { id: "sg-placed-h", text: "Placed items" }), s.list);
  const step = (n: number, title: string, ...kids: HTMLElement[]) => h("section", { class: "sg-step" }, h("h3", { text: `${n}. ${title}` }), ...kids);
  s.root.append(
    s.hint,
    h("div", { class: "sg-layout" },
      h("div", { class: "sg-side" },
        step(1, "Make your signature", sigBox, iniBox, note),
        step(2, "Choose what to place", s.kind.el, s.dateFmt.el, s.text.el),
        step(3, "Place it",
          h("p", { class: "sg-help", text: "Click or tap a page to place it there. Drag to move, drag the corner or press + and - to resize, arrow keys nudge (Shift for bigger steps), Delete removes." }),
          h("div", { class: "sg-where" }, s.pageNo.el, s.place, s.all.el), s.msg),
        placed, disclaimer),
      s.pv.el));
  return Object.assign(s, { sig, ini, add, renderList, begin });

  function describe(it: Item): string {
    return `${it.what} on page ${it.page + 1}${it.all ? ", repeated on every page" : ""}. Arrow keys move it, plus and minus resize it, Delete removes it.`;
  }
  function layout(it: Item, el: HTMLElement): void {
    el.style.left = `${it.fx * 100}%`;
    el.style.top = `${it.fy * 100}%`;
    if (it.canvas) el.style.width = `${it.fw * 100}%`;
    else el.style.fontSize = `${(it.size / it.pw) * 100}cqw`;
  }
  /** Size of the box as fractions of its page. */
  function box(el: HTMLElement, overlay: HTMLElement) { return { w: el.offsetWidth / overlay.clientWidth, h: el.offsetHeight / overlay.clientHeight }; }

  function paint(slot: Slot): void {
    for (const it of s.items) if (it.page === slot.index && !s.els.has(it.id) && slot.vp) mount(it, slot);
  }
  function mount(it: Item, slot: Slot): void {
    const handle = h("span", { class: "sg-item__handle", attrs: { "aria-hidden": "true" } });
    const body = it.canvas
      ? Object.assign(document.createElement("canvas"), { width: it.canvas.width, height: it.canvas.height, className: "sg-item__img" })
      : h("span", { class: "sg-item__text", text: it.text });
    if (body instanceof HTMLCanvasElement) body.getContext("2d")!.drawImage(it.canvas!, 0, 0);
    const el = h("div", { class: "sg-item", attrs: { tabindex: 0, role: "group", "aria-label": describe(it), "data-testid": "sg-item" } }, body, handle);
    layout(it, el);
    s.els.set(it.id, el);
    slot.overlay.append(el);
    const overlay = slot.overlay;
    const apply = () => { clampIn(it, el, overlay); layout(it, el); };

    // drag to move / resize
    const drag = (e: PointerEvent, size: boolean) => {
      e.stopPropagation();
      el.focus();
      el.setPointerCapture(e.pointerId);
      const r = overlay.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, fx: it.fx, fy: it.fy, fw: it.fw, size: it.size, w: el.offsetWidth };
      const move = (m: PointerEvent) => {
        const dx = (m.clientX - start.x) / r.width, dy = (m.clientY - start.y) / r.height;
        if (!size) { it.fx = start.fx + dx; it.fy = start.fy + dy; }
        else if (it.canvas) it.fw = Math.max(0.03, start.fw + dx);
        else it.size = clamp((start.size * (start.w + dx * r.width)) / start.w, 4, 200);
        apply();
      };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    };
    el.addEventListener("pointerdown", (e) => { if (e.button === 0 || e.pointerType !== "mouse") { e.preventDefault(); drag(e, e.target === handle); } });
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      const r = overlay.getBoundingClientRect();
      if (e.key === "Delete" || e.key === "Backspace") remove(it);
      else if (e.key === "ArrowLeft") it.fx -= step / r.width;
      else if (e.key === "ArrowRight") it.fx += step / r.width;
      else if (e.key === "ArrowUp") it.fy -= step / r.height;
      else if (e.key === "ArrowDown") it.fy += step / r.height;
      else if (e.key === "+" || e.key === "=") { if (it.canvas) it.fw *= 1.08; else it.size = Math.min(200, it.size * 1.08); }
      else if (e.key === "-") { if (it.canvas) it.fw = Math.max(0.03, it.fw / 1.08); else it.size = Math.max(4, it.size / 1.08); }
      else return;
      e.preventDefault();
      if (!(e.key === "Delete" || e.key === "Backspace")) apply();
    });
  }
  function clampIn(it: Item, el: HTMLElement, overlay: HTMLElement): void {
    const b = box(el, overlay);
    it.fx = clamp(it.fx, 0, 1 - b.w);
    it.fy = clamp(it.fy, 0, 1 - b.h);
  }

  function remove(it: Item): void {
    s.items.splice(s.items.indexOf(it), 1);
    s.els.get(it.id)?.remove();
    s.els.delete(it.id);
    renderList();
    announce(`${it.what} removed.`);
    s.place.focus();
    ctx.refresh();
  }

  function renderList(): void {
    s.list.replaceChildren(...s.items.map((it, k) => {
      const id = `sg-row-${it.id}`;
      const every = h("input", { class: "hs-check", id, type: "checkbox", attrs: { "data-testid": "sg-row-all" } });
      every.checked = it.all;
      every.addEventListener("change", () => { it.all = every.checked; s.els.get(it.id)?.setAttribute("aria-label", describe(it)); renderList(); ctx.refresh(); });
      return h("li", { class: "sg-row", attrs: { "data-testid": "sg-row" } },
        h("span", { class: "sg-row__what", text: `${it.what}${it.text ? `: ${it.text}` : ""}, page ${it.page + 1}${it.all ? " (every page)" : ""}` }),
        h("span", { class: "field field--check" }, every, h("label", { text: "Every page", attrs: { for: id } })),
        h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Remove", attrs: { "aria-label": `Remove ${it.what.toLowerCase()} ${k + 1} (page ${it.page + 1})`, "data-testid": "sg-row-remove" }, on: { click: () => remove(it) } }));
    }));
  }

  /** Puts the chosen thing on `slot` at (cx, cy), fractions of the page. Says why when it can't. */
  function add(slot: Slot, cx: number, cy: number): void {
    const vp = slot.vp;
    s.msg.textContent = "";
    if (!vp) return;
    const kind = s.kind.value();
    const base = { id: nextId++, page: slot.index, all: s.all.input.checked, pw: vp.width, ph: vp.height, fx: 0, fy: 0, fw: 0, size: 0 };
    let it: Item;
    if (kind === "signature" || kind === "initials") {
      const canvas = (kind === "signature" ? sig : ini).result();
      if (!canvas) { s.msg.textContent = kind === "signature" ? "Make your signature first: draw it, type it or upload it." : "Make your initials first: draw them, type them or upload them."; return; }
      const fw = kind === "signature" ? 0.28 : 0.1;
      const fh = (fw * vp.width * (canvas.height / canvas.width)) / vp.height;
      it = { ...base, what: kind === "signature" ? "Signature" : "Initials", canvas, fw, fx: clamp(cx - fw / 2, 0, 1 - fw), fy: clamp(cy - fh / 2, 0, 1 - fh) };
    } else {
      const text = kind === "date" ? DATES[s.dateFmt.input.value](new Date()) : s.text.input.value.trim();
      if (!text) { s.msg.textContent = "Type the text to place first."; return; }
      if (badChars(text).length) { s.msg.textContent = "That text has characters that can't be used yet. Use Latin, Greek or Cyrillic letters, digits and basic punctuation."; return; }
      const size = kind === "date" ? 12 : 14;
      it = { ...base, what: kind === "date" ? "Date" : "Text", text, size, fx: clamp(cx, 0, 0.95), fy: clamp(cy - (size * 0.6) / vp.height, 0, 0.97) };
    }
    s.items.push(it);
    mount(it, slot);
    clampIn(it, s.els.get(it.id)!, slot.overlay);
    layout(it, s.els.get(it.id)!);
    renderList();
    announce(`${it.what} placed on page ${it.page + 1}.`);
    const placedEl = s.els.get(it.id)!;
    placedEl.scrollIntoView({ block: "center", behavior: "auto" }); // instant: no motion to gate, and no scroll in flight under keyboard nudges
    placedEl.focus({ preventScroll: true });
    ctx.refresh();
  }

  /** Click on a page overlay (not on an item) places the chosen thing there. */
  function begin(slot: Slot): void {
    slot.overlay.addEventListener("click", (e) => {
      if (e.target !== slot.overlay) return;
      const r = slot.overlay.getBoundingClientRect();
      const [cx, cy] = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      void s.pv.ensure(slot.index).then(() => add(slot, cx, cy)); // the page's size is known once it was drawn or asked for
    });
  }
});

export const sign: ToolDef = {
  id: "sign", title: "Sign", heading: "Sign a PDF", group: "Fill and sign",
  blurb: "Add your signature.",
  lede: "Draw, type or upload a signature, then click a page to place it. You can also add initials, today's date or a line of text.",
  accepts: "pdf",
  options(ctx) {
    const u = ui(ctx);
    u.place.addEventListener("click", () => {
      const i = Number(u.pageNo.input.value) - 1;
      const slot = u.pv.slots[i];
      if (!slot) { u.msg.textContent = "Type a page number that exists in this PDF."; return; }
      void u.pv.ensure(i).then(() => { slot.wrap.scrollIntoView({ block: "center" }); u.add(slot, 0.5, 0.8); });
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
    const n = f?.info?.pageCount ?? 1;
    u.pageNo.input.max = String(n);
    u.hint.hidden = !!f;
    u.hint.textContent = "Add a PDF above to start.";
    const k = u.kind.value();
    u.root.querySelectorAll<HTMLElement>(".sg-side, .vw").forEach((e) => (e.hidden = !f));
    u.root.querySelector<HTMLElement>("[data-testid=sg-sig-box]")!.hidden = k !== "signature";
    u.root.querySelector<HTMLElement>("[data-testid=sg-ini-box]")!.hidden = k !== "initials";
    const boxEl = u.root.querySelector<HTMLElement>(k === "initials" ? "[data-testid=sg-ini-box]" : "[data-testid=sg-sig-box]")!;
    if (u.pen.el.parentElement !== boxEl) boxEl.append(u.pen.el);
    u.pen.el.hidden = (k !== "signature" && k !== "initials") || (k === "initials" ? u.ini : u.sig).tab() === "upload";
    u.dateFmt.el.hidden = k !== "date";
    u.text.el.hidden = k !== "text";
    const bad = badChars(u.text.input.value);
    u.text.setMessage(k === "text" && bad.length ? `These characters cannot be used yet: ${bad.map((c) => `"${c}"`).join(" ")}. Use Latin, Greek or Cyrillic letters, digits and basic punctuation.` : "", k === "text" && bad.length > 0);
  },
  warnings(ctx) { return ui(ctx).signed ? [SIGNED_WARNING] : []; },
  ready(ctx) { return !!ctx.file && ui(ctx).items.length > 0; },
  whyDisabled: (ctx) => (ctx.file && !ui(ctx).items.length ? "Place a signature on a page first." : ""),
  primaryLabel: () => "Save signed copy",
  destroy(ctx) { ui(ctx).pv.destroy(); },
  async run(ctx) {
    const u = ui(ctx);
    const images: Uint8Array[] = [];
    const index = new Map<HTMLCanvasElement, number>();
    const items: StampItem[] = [];
    for (const it of u.items) {
      const pages = it.all ? ("all" as const) : [it.page];
      if (it.canvas) {
        if (!index.has(it.canvas)) { index.set(it.canvas, images.length); images.push(await toPng(it.canvas)); }
        items.push({ kind: "image", image: index.get(it.canvas)!, pages, fx: it.fx, fy: it.fy, fw: it.fw });
      } else items.push({ kind: "text", text: it.text!, size: it.size, pages, fx: it.fx, fy: it.fy + (baselineRatio() * it.size) / it.ph });
    }
    const input: StampInput = { images, items };
    return [await ctx.call<OpResult>("stampPage", { file: ctx.input(ctx.file!), input, o: { producerCredit: ctx.producerCredit } })];
  },
};
