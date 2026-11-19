// Page grid: lazy thumbnails, rotate/delete/select, reorder by drag handle, buttons or Alt+Arrow keys.
import { store, type LoadedFile } from "../core/store";
import { renderThumb } from "../core/render";
import { announce, h } from "./dom";
import { icon, type IconName } from "./icons";
import { sortable } from "./sortable";

export interface PageItem { id: number; file: LoadedFile; page: number; rotate: number; selected: boolean }
interface Card { li: HTMLLIElement; canvas: HTMLCanvasElement; skel: HTMLElement; key: string; cancel?: () => void; label: HTMLElement; thumb: HTMLElement; src: HTMLElement }

let uid = 1;
export const newItem = (file: LoadedFile, page: number): PageItem => ({ id: uid++, file, page, rotate: 0, selected: false });

export function pageGrid(o: { items: () => PageItem[]; set: (p: PageItem[]) => void; selectable: boolean; showFile: boolean; onChange: () => void }) {
  const cards = new Map<number, Card>();
  const ul = h("ul", { class: "pg-grid", attrs: { role: "list", "data-testid": "page-grid", "aria-label": "Pages" } });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = o.items().find((i) => cards.get(i.id)?.li === e.target);
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
    items.splice(to, 0, ...items.splice(from, 1));
    o.set(items);
    sync();
    announce(`Page moved to position ${to + 1} of ${items.length}.`);
    if (focus) cards.get(id)?.li.querySelector<HTMLElement>("[data-focus]")?.focus();
    o.onChange();
  };
  const rotate = (item: PageItem, d: number) => {
    item.rotate = (item.rotate + d + 360) % 360;
    sync();
    o.onChange();
    announce(`Page rotated to ${item.rotate} degrees.`);
  };
  const remove = (item: PageItem) => {
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
    const thumb = o.selectable
      ? h("button", { class: "pg__thumb", type: "button", attrs: { "data-focus": true, "data-testid": "page-select" } }, skel, canvas)
      : h("div", { class: "pg__thumb", attrs: { tabindex: 0, "data-focus": true, role: "group" } }, skel, canvas);
    const label = h("span", { class: "pg__label" });
    const src = h("span", { class: "pg__src" });
    const li = h("li", { class: "pg", attrs: { "data-testid": "page-card", "data-page-id": item.id } }, thumb, h("div", { class: "pg__meta" }, label, src), h("div", { class: "pg__bar" }));
    thumb.addEventListener("click", () => { if (o.selectable) { item.selected = !item.selected; sync(); o.onChange(); } });
    (thumb as HTMLElement).addEventListener("keydown", (e: KeyboardEvent) => {
      const i = o.items().findIndex((x) => x.id === item.id);
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowUp")) { e.preventDefault(); move(item.id, i - 1); }
      else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) { e.preventDefault(); move(item.id, i + 1); }
      else if (e.key === "Delete") { e.preventDefault(); remove(item); }
    });
    io.observe(li);
    return { li, canvas, skel, key: "", label, thumb, src };
  }

  function sync() {
    const items = o.items();
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
      c.src.textContent = o.showFile ? `${item.file.name}, p. ${item.page}` : item.page !== i + 1 ? `was ${item.page}` : "";
      const t = c.thumb;
      const desc = `Page ${i + 1} of ${items.length}${item.rotate ? `, rotated ${item.rotate} degrees` : ""}${o.selectable ? (item.selected ? ", selected" : ", not selected") : ""}. Alt plus arrow keys move it.`;
      t.setAttribute("aria-label", desc);
      if (o.selectable) t.setAttribute("aria-pressed", String(item.selected));
      c.li.classList.toggle("is-selected", item.selected);
      c.li.querySelectorAll<HTMLButtonElement>("[data-testid=page-move-earlier]").forEach((b) => (b.disabled = i === 0));
      c.li.querySelectorAll<HTMLButtonElement>("[data-testid=page-move-later]").forEach((b) => (b.disabled = i === items.length - 1));
      const k = `${item.file.id}:${item.page}:${item.rotate}`;
      if (c.key && c.key !== k) draw(item, c);
    });
  }

  sortable(ul, {
    item: ".pg", handle: ".pg__grip", longPress: ".pg__thumb",
    onCommit: () => {
      const byId = new Map(o.items().map((i) => [i.id, i]));
      const order = [...ul.children].map((li) => byId.get(Number((li as HTMLElement).dataset.pageId))!).filter(Boolean);
      o.set(order);
      sync();
      o.onChange();
      announce("Page moved.");
    },
  });
  sync();
  return { el: ul, sync, destroy: () => { io.disconnect(); cards.forEach((c) => c.cancel?.()); } };
}
