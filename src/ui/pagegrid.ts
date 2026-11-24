// Page grid: lazy thumbnails, rotate/delete/select, reorder by drag handle, buttons or Alt+Arrow keys.
import { store, type LoadedFile } from "../core/store";
import { renderThumb } from "../core/render";
import { announce, h } from "./dom";
import { icon, type IconName } from "./icons";
import { history, rangeBetween, shiftSelected } from "./gridlogic";
import { sortable } from "./sortable";

export interface PageItem { id: number; file: LoadedFile; page: number; rotate: number; selected: boolean }
interface Card { li: HTMLLIElement; canvas: HTMLCanvasElement; skel: HTMLElement; key: string; cancel?: () => void; label: HTMLElement; thumb: HTMLElement; src: HTMLElement; badge: HTMLElement }
interface Snap { order: PageItem[]; rot: number[] }

let uid = 1;
export const newItem = (file: LoadedFile, page: number): PageItem => ({ id: uid++, file, page, rotate: 0, selected: false });

export function pageGrid(o: { items: () => PageItem[]; set: (p: PageItem[]) => void; selectable: boolean; showFile: boolean; onChange: () => void }) {
  const cards = new Map<number, Card>();
  const byLi = new WeakMap<Element, PageItem>();
  const bulk = !o.selectable; // merge and organize: toolbar with undo/redo and multi-select; extract keeps plain click-to-select
  const hist = history<Snap>(50);
  let known = new Set<number>(), tags = new Map<string | number, number>(), anchor = -1, selectMode = false;
  const snap = (): Snap => ({ order: o.items().slice(), rot: o.items().map((i) => i.rotate) });
  const sel = () => o.items().filter((i) => i.selected);
  const ul = h("ul", { class: "pg-grid", attrs: { role: "list", "data-testid": "page-grid", "aria-label": "Pages" } });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = byLi.get(e.target);
      const c = item && cards.get(item.id);
      if (!c || !item) continue;
      if (e.isIntersecting) draw(item, c);
      else release(c);
    }
  }, { rootMargin: "500px 0px" });

  function draw(item: PageItem, c: Card) {
    const key = `${item.file.id}:${item.page}:${item.rotate}`;
    if (c.key === key) return;
    c.cancel?.();
    c.key = key;
    store.doc(item.file).then((doc) => {
      const r = renderThumb(doc, item.page, item.rotate, c.canvas, 220);
      c.cancel = r.cancel;
      return r.done.then(() => { if (c.key === key) c.li.classList.add("is-drawn"); });
    }).catch((e) => { console.warn("thumbnail failed", e); c.key = ""; });
  }
  function release(c: Card) { // free offscreen canvases
    c.cancel?.();
    c.key = "";
    c.li.classList.remove("is-drawn");
    c.canvas.width = c.canvas.height = 0;
  }

  const move = (id: number, to: number, focus = true) => {
    const items = o.items().slice();
    const from = items.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= items.length) return;
    hist.push(snap());
    items.splice(to, 0, ...items.splice(from, 1));
    o.set(items);
    sync();
    announce(`Page moved to position ${to + 1} of ${items.length}.`);
    if (focus) cards.get(id)?.li.querySelector<HTMLElement>("[data-focus]")?.focus();
    o.onChange();
  };
  const rotate = (item: PageItem, d: number) => {
    hist.push(snap());
    item.rotate = (item.rotate + d + 360) % 360;
    sync();
    o.onChange();
    announce(`Page rotated to ${item.rotate} degrees.`);
  };
  const remove = (item: PageItem) => {
    hist.push(snap());
    const items = o.items();
    const i = items.findIndex((x) => x.id === item.id);
    o.set(items.filter((x) => x.id !== item.id));
    sync();
    o.onChange();
    announce(`Page removed. ${o.items().length} pages left.`);
    const next = o.items()[Math.min(i, o.items().length - 1)];
    (next && cards.get(next.id)?.li.querySelector<HTMLElement>("[data-focus]"))?.focus();
  };

  const action = (name: IconName, label: string, fn: () => void, testid: string, disabled = false) =>
    h("button", { class: "pg__btn", type: "button", disabled, attrs: { "aria-label": label, title: label, "data-testid": testid }, on: { click: fn } }, icon(name));

  function build(item: PageItem): Card {
    const canvas = h("canvas", { class: "pg__canvas", attrs: { "aria-hidden": "true" } });
    const skel = h("div", { class: "pg__skel", attrs: { "aria-hidden": "true" } },
      h("div", { class: "hs-skel" }, h("i"), h("i"), h("i")), h("span", { class: "pg__skelnum" }));
    const thumb = o.selectable || bulk
      ? h("button", { class: "pg__thumb", type: "button", attrs: { "data-focus": true, "data-testid": "page-select" } }, skel, canvas)
      : h("div", { class: "pg__thumb", attrs: { tabindex: 0, "data-focus": true, role: "group" } }, skel, canvas);
    const label = h("span", { class: "pg__label" });
    const src = h("span", { class: "pg__src" });
    const badge = h("span", { class: "pg__badge", attrs: { "aria-hidden": "true" } });
    const li = h("li", { class: "pg", attrs: { "data-testid": "page-card", "data-page-id": item.id } }, thumb, badge, h("div", { class: "pg__meta" }, label, src), h("div", { class: "pg__bar" }));
    byLi.set(li, item);
    (thumb as HTMLElement).addEventListener("click", (e: MouseEvent) => {
      if (o.selectable) { item.selected = !item.selected; sync(); o.onChange(); }
      else if (selectMode || e.ctrlKey || e.metaKey || e.shiftKey) pick(item, e.shiftKey);
    });
    (thumb as HTMLElement).addEventListener("keydown", (e: KeyboardEvent) => {
      const i = o.items().findIndex((x) => x.id === item.id);
      const group = bulk && item.selected && sel().length > 1; // a focused page inside the selection moves with it
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowUp")) { e.preventDefault(); if (group) shift(-1); else move(item.id, i - 1); }
      else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) { e.preventDefault(); if (group) shift(1); else move(item.id, i + 1); }
      else if (e.key === "Delete") { e.preventDefault(); if (group) removeSel(); else remove(item); }
      else if (bulk && (e.key === " " || e.key === "Enter")) { e.preventDefault(); pick(item, e.shiftKey); }
    });
    io.observe(li);
    return { li, canvas, skel, key: "", label, thumb, src, badge };
  }

  // ---- selection and bulk actions (merge, organize) ----
  function pick(item: PageItem, range: boolean) {
    const items = o.items();
    const i = items.findIndex((x) => x.id === item.id);
    if (range && anchor >= 0 && anchor < items.length) for (const k of rangeBetween(anchor, i)) items[k].selected = true;
    else { item.selected = !item.selected; anchor = i; }
    sync();
    announce(`${sel().length} of ${items.length} pages selected.`);
  }
  function shift(dir: -1 | 1) {
    const next = shiftSelected(o.items(), (x) => x.selected, dir);
    if (next.every((x, i) => x === o.items()[i])) return;
    hist.push(snap());
    o.set(next);
    sync();
    announce(`${sel().length} pages moved ${dir < 0 ? "earlier" : "later"}.`);
    o.onChange();
  }
  function rotateSel(d: number) {
    hist.push(snap());
    for (const i of sel()) i.rotate = (i.rotate + d + 360) % 360;
    sync();
    announce(`${sel().length} pages rotated.`);
    o.onChange();
  }
  function removeSel() {
    const n = sel().length;
    if (!n) return;
    hist.push(snap());
    o.set(o.items().filter((x) => !x.selected));
    sync();
    announce(`${n} pages removed. ${o.items().length} pages left.`);
    o.onChange();
  }
  function step(dir: -1 | 1) {
    const to = dir < 0 ? hist.undo(snap()) : hist.redo(snap());
    if (!to) { announce(dir < 0 ? "Nothing to undo." : "Nothing to redo."); return; }
    to.order.forEach((it, i) => (it.rotate = to.rot[i]));
    o.set(to.order);
    sync();
    announce(`${dir < 0 ? "Undone" : "Redone"}. ${to.order.length} pages.`);
    o.onChange();
  }
  const tbtn = (text: string, fn: () => void, testid: string) =>
    h("button", { class: "hs-btn hs-btn--secondary pg-bar__btn", type: "button", text, attrs: { "data-testid": testid }, on: { click: fn } });
  const tb = bulk ? {
    undo: tbtn("Undo", () => step(-1), "pg-undo"), redo: tbtn("Redo", () => step(1), "pg-redo"),
    mode: tbtn("Select", () => { selectMode = !selectMode; sync(); }, "pg-select-mode"),
    rl: tbtn("Rotate left", () => rotateSel(-90), "pg-sel-rotate-left"), rr: tbtn("Rotate right", () => rotateSel(90), "pg-sel-rotate-right"),
    up: tbtn("Move earlier", () => shift(-1), "pg-sel-earlier"), dn: tbtn("Move later", () => shift(1), "pg-sel-later"),
    del: tbtn("Delete", removeSel, "pg-sel-delete"),
    count: h("span", { class: "pg-bar__count", attrs: { "data-testid": "pg-sel-count" } }),
  } : null;
  const wrap = h("div", { class: "pg-wrap" }, ...(tb ? [h("div", { class: "pg-bar", attrs: { role: "toolbar", "aria-label": "Page tools" } }, ...Object.values(tb))] : []), ul);
  const keys = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!wrap.isConnected || wrap.closest("[hidden]") || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === "z") step(e.shiftKey ? 1 : -1);
    else if (k === "y") step(1);
    else return;
    e.preventDefault();
  };
  if (bulk) document.addEventListener("keydown", keys);

  function sync() {
    const items = o.items();
    if (items.some((i) => !known.has(i.id))) { // the files changed: fresh items, so the old history no longer applies
      known = new Set(items.map((i) => i.id)); tags = new Map(); anchor = -1; hist.clear();
    }
    const many = new Set(items.map((i) => i.file.id)).size > 1;
    for (const i of items) if (!tags.has(i.file.id)) tags.set(i.file.id, tags.size);
    const live = new Set(items.map((i) => i.id));
    for (const [id, c] of cards) if (!live.has(id)) { c.cancel?.(); io.unobserve(c.li); c.li.remove(); cards.delete(id); }
    items.forEach((item, i) => {
      let c = cards.get(item.id);
      if (!c) {
        c = build(item);
        cards.set(item.id, c);
        const bar = c.li.querySelector(".pg__bar")!;
        bar.append(
          action("rotateL", "Rotate left", () => rotate(item, -90), "page-rotate-left"),
          action("rotateR", "Rotate right", () => rotate(item, 90), "page-rotate-right"),
          action("trash", "Delete page", () => remove(item), "page-delete"),
          h("button", { class: "pg__btn pg__grip", type: "button", attrs: { "aria-label": "Drag to move page", title: "Drag to move page", "data-testid": "page-grip" } }, icon("grip")),
          action("left", "Move earlier", () => move(item.id, o.items().findIndex((x) => x.id === item.id) - 1), "page-move-earlier"),
          action("right", "Move later", () => move(item.id, o.items().findIndex((x) => x.id === item.id) + 1), "page-move-later"),
        );
      }
      if (ul.children[i] !== c.li) ul.insertBefore(c.li, ul.children[i] ?? null);
      c.label.textContent = `Page ${i + 1}`;
      const sz = item.file.info?.pageSizes[item.page - 1];
      const turned = (((sz?.rotate ?? 0) + item.rotate) / 90) % 2 === 1;
      const [w, hh] = sz ? (turned ? [sz.h, sz.w] : [sz.w, sz.h]) : [3, 4];
      c.skel.style.setProperty("--ar", `${w} / ${hh}`);
      c.skel.classList.toggle("pg__skel--wide", w / hh > 0.75);
      c.skel.lastElementChild!.textContent = String(i + 1);
      c.src.textContent = o.showFile || many ? `${item.file.name}, p. ${item.page}` : item.page !== i + 1 ? `was ${item.page}` : "";
      const tag = tags.get(item.file.id)!;
      if (many) c.li.dataset.tag = String(tag % 3); else delete c.li.dataset.tag;
      c.badge.hidden = !many;
      c.badge.textContent = tag < 26 ? String.fromCharCode(65 + tag) : String(tag + 1);
      const t = c.thumb;
      const desc = `Page ${i + 1} of ${items.length}${item.rotate ? `, rotated ${item.rotate} degrees` : ""}${o.selectable || bulk ? (item.selected ? ", selected" : ", not selected") : ""}${many ? `, from ${item.file.name}` : ""}. Alt plus arrow keys move it.`;
      t.setAttribute("aria-label", desc);
      if (o.selectable || bulk) t.setAttribute("aria-pressed", String(item.selected));
      c.li.classList.toggle("is-selected", item.selected);
      c.li.querySelectorAll<HTMLButtonElement>("[data-testid=page-move-earlier]").forEach((b) => (b.disabled = i === 0));
      c.li.querySelectorAll<HTMLButtonElement>("[data-testid=page-move-later]").forEach((b) => (b.disabled = i === items.length - 1));
      const k = `${item.file.id}:${item.page}:${item.rotate}`;
      if (c.key && c.key !== k) draw(item, c);
    });
    if (tb) {
      const n = sel().length;
      tb.undo.disabled = !hist.canUndo; tb.redo.disabled = !hist.canRedo;
      tb.mode.setAttribute("aria-pressed", String(selectMode));
      for (const b of [tb.rl, tb.rr, tb.up, tb.dn, tb.del]) b.disabled = n === 0;
      tb.count.textContent = n ? `${n} selected` : "";
    }
  }

  sortable(ul, {
    item: ".pg", handle: ".pg__grip", longPress: ".pg__thumb",
    onCommit: () => {
      const byId = new Map(o.items().map((i) => [i.id, i]));
      const order = [...ul.children].map((li) => byId.get(Number((li as HTMLElement).dataset.pageId))!).filter(Boolean);
      if (order.every((x, i) => x === o.items()[i])) return;
      hist.push(snap());
      o.set(order);
      sync();
      o.onChange();
      announce("Page moved.");
    },
  });
  sync();
  return { el: wrap, sync, destroy: () => { io.disconnect(); document.removeEventListener("keydown", keys); cards.forEach((c) => c.cancel?.()); } };
}
