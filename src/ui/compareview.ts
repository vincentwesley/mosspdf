// The three views of a comparison (D18): the change list, the two documents side by side with the changed words boxed, and a pixel
// overlay of one page pair. Tabs are a plain ARIA tablist; everything is drawn from the pure `Comparison` plus the open pdf.js documents.
import type { PDFDocumentProxy } from "pdfjs-dist/build/pdf.mjs";
import { changeLabel, clip, plural, type Change, type Comparison, type Span } from "../core/compare";
import { mergeRects, type Word } from "../core/pagewords";
import { ADDED_RGB, REMOVED_RGB, pixelDiff } from "../core/pixeldiff";
import type { LoadedFile } from "../core/store";
import { h } from "./dom";
import { selectField } from "./fields";
import { pageView, rectToFractions, type Slot } from "./pageview";

export interface ViewData {
  cmp: Comparison;
  files: [LoadedFile, LoadedFile];
  docs: [PDFDocumentProxy, PDFDocumentProxy];
  words: [Word[][], Word[][]];
  summary: string;
  notes: string[];
  /** A side has pages but no text at all. */
  scans: boolean;
}
type TabId = "changes" | "side" | "overlay";
type Side = 0 | 1;
const TABS: [TabId, string][] = [["changes", "Changes"], ["side", "Side by side"], ["overlay", "Overlay"]];
const LIST_MAX = 500;
const rgb = (c: readonly number[]) => `rgb(${c.join(" ")})`;

export function compareView() {
  const root = h("section", { class: "cmp", hidden: true, attrs: { "data-testid": "compare-view", "aria-label": "Comparison" } });
  const pvs = [pageView({ onSlot: (s) => paint(0, s) }), pageView({ onSlot: (s) => paint(1, s) })] as const;
  let d: ViewData | undefined;
  let marks: Map<number, { n: number; span: Span }[]>[] = [];
  let tab: TabId = "changes";
  let overlayDirty = true;
  let renderOverlay: () => void = () => undefined;
  let quiet = 0; // scroll events before this time came from our own scrolling
  const follow = [undefined, undefined] as (ReturnType<typeof setTimeout> | undefined)[];
  const tabs = new Map<TabId, HTMLButtonElement>();
  const panels = new Map<TabId, HTMLElement>();
  const cols: HTMLElement[] = [];

  function paint(side: Side, slot: Slot) {
    if (!d || !slot.vp) return;
    for (const m of marks[side]?.get(slot.index) ?? []) {
      for (const r of mergeRects(d.words[side][slot.index].slice(m.span.from, m.span.to).flatMap((w) => w.rects))) {
        const f = rectToFractions(slot.vp, r);
        const el = h("div", { class: `cmp__hl cmp__hl--${side ? "b" : "a"}`, attrs: { "aria-hidden": "true", "data-testid": "cmp-hl", "data-change": m.n } });
        el.style.left = `${f.left * 100}%`; el.style.top = `${f.top * 100}%`; el.style.width = `${f.width * 100}%`; el.style.height = `${f.height * 100}%`;
        slot.overlay.append(el);
      }
    }
  }

  function select(id: TabId, focus = false) {
    tab = id;
    for (const [k, b] of tabs) { b.setAttribute("aria-selected", String(k === id)); b.tabIndex = k === id ? 0 : -1; panels.get(k)!.hidden = k !== id; }
    if (focus) tabs.get(id)!.focus();
    if (id === "overlay" && overlayDirty) renderOverlay();
  }

  const scrollTo = (col: HTMLElement, el: HTMLElement) => {
    quiet = performance.now() + 400;
    col.scrollTop += el.getBoundingClientRect().top - col.getBoundingClientRect().top - col.clientHeight / 3;
  };
  async function goTo(c: Change) {
    select("side");
    root.querySelectorAll(".cmp__hl.is-current").forEach((e) => e.classList.remove("is-current"));
    root.querySelectorAll(`.cmp__hl[data-change="${c.n}"]`).forEach((e) => e.classList.add("is-current"));
    for (const side of [0, 1] as const) {
      const s = side ? c.b : c.a;
      if (!s) continue;
      await pvs[side].ensure(s.pages[0]);
      const slot = pvs[side].slots[s.pages[0]];
      const hl = slot.overlay.querySelector<HTMLElement>(`[data-change="${c.n}"]`);
      hl?.classList.add("is-current");
      scrollTo(cols[side], hl ?? slot.wrap);
    }
  }

  /** Keeps the other document at the page that goes with the one the reader scrolled. */
  function sync(side: Side) {
    if (!d || performance.now() < quiet) return;
    const top = cols[side].getBoundingClientRect().top;
    const page = pvs[side].slots.findIndex((s) => s.wrap.getBoundingClientRect().bottom > top + 4);
    const to = d.cmp.align.find((p) => p[side ? "b" : "a"] === page)?.[side ? "a" : "b"];
    if (to == null) return;
    const other = cols[1 - side], slot = pvs[(1 - side) as Side].slots[to];
    if (slot && Math.abs(slot.wrap.getBoundingClientRect().top - other.getBoundingClientRect().top) > 8) {
      quiet = performance.now() + 300;
      other.scrollTop += slot.wrap.getBoundingClientRect().top - other.getBoundingClientRect().top;
    }
  }

  function changesPanel(v: ViewData) {
    const line = (cls: string, label: string, text: string | undefined, present: boolean) =>
      present ? h("span", { class: `cmp__line cmp__line--${cls}` }, h("strong", { text: label }), " ", text ? clip(text) : "the whole page") : null;
    const items = v.cmp.changes.slice(0, LIST_MAX).map((c) =>
      h("li", {}, h("button", { class: "cmp__chg", type: "button", attrs: { "data-testid": "cmp-change", "data-n": c.n }, on: { click: () => void goTo(c) } },
        h("span", { class: "cmp__chg-h", text: `Change ${c.n}: ${changeLabel(c)}` }),
        line("a", "Removed:", c.a?.text, !!c.a), line("b", "Added:", c.b?.text, !!c.b))));
    if (!v.cmp.changes.length) return [h("p", { class: "cmp__hint", text: "No text changes to list. The Overlay tab compares how the pages look." })];
    return [
      h("p", { class: "cmp__hint", text: "Select a change to see it in both documents." }),
      h("ol", { class: "cmp__list", attrs: { "data-testid": "cmp-changes" } }, ...items),
      ...(v.cmp.changes.length > LIST_MAX ? [h("p", { class: "cmp__hint", text: `Showing the first ${LIST_MAX} of ${v.cmp.changes.length} changes. The report lists them all.` })] : []),
    ];
  }

  function sidePanel(v: ViewData) {
    marks = [0, 1].map((side) => {
      const m = new Map<number, { n: number; span: Span }[]>();
      for (const c of v.cmp.changes) for (const span of (side ? c.b : c.a)?.spans ?? []) (m.get(span.page) ?? m.set(span.page, []).get(span.page)!).push({ n: c.n, span });
      return m;
    });
    pvs[0].setFile(v.files[0]);
    pvs[1].setFile(v.files[1]);
    const col = (side: Side, title: string) => {
      const scroller = h("div", { class: "cmp__scroll", attrs: { tabindex: 0, role: "region", "aria-label": `${title}: ${v.files[side].name}`, "data-testid": `cmp-col-${side ? "changed" : "original"}` } }, pvs[side].el);
      scroller.addEventListener("scroll", () => { clearTimeout(follow[side]); follow[side] = setTimeout(() => sync(side), 120); }, { passive: true });
      cols[side] = scroller;
      return h("div", { class: "cmp__colwrap" }, h("h3", { text: `${title}: ${v.files[side].name}` }), scroller);
    };
    return [
      ...(v.cmp.coarse ? [h("p", { class: "hs-banner hs-banner--info", text: "Changed words are not boxed here because the documents are too long for a word by word comparison." })] : []),
      h("p", { class: "cmp__legend" }, h("span", { class: "cmp__sw cmp__sw--a" }), " Boxed in the Original: removed or changed. ", h("span", { class: "cmp__sw cmp__sw--b" }), " Boxed in the Changed: added or changed."),
      h("div", { class: "cmp__cols" }, col(0, "Original"), col(1, "Changed")),
    ];
  }

  function overlayPanel(v: ViewData) {
    const pairs = v.cmp.align;
    const lab = (p: { a: number | null; b: number | null }) => `${p.a === null ? "Original: no page" : `Original page ${p.a + 1}`}, ${p.b === null ? "Changed: no page" : `Changed page ${p.b + 1}`}`;
    const first = v.cmp.changes[0];
    const start = Math.max(0, first ? pairs.findIndex((p) => p.a === (first.a?.pages[0] ?? -1) || p.b === (first.b?.pages[0] ?? -1)) : 0);
    const pick = selectField({ id: "cmp-ov-page", label: "Page pair", testid: "cmp-ov-page", options: pairs.map((p, i) => [String(i), lab(p)]), value: String(start), onInput: () => renderOverlay() });
    const fade = h("input", { class: "cmp__range", id: "cmp-ov-fade", type: "range", attrs: { min: 5, max: 100, step: 5, value: 35, "data-testid": "cmp-ov-fade" } });
    const fadeOut = h("output", { attrs: { for: "cmp-ov-fade" }, text: "35%" });
    const base = h("canvas", { class: "cmp__base", attrs: { "aria-hidden": "true", "data-testid": "cmp-ov-base" } });
    const mark = h("canvas", { class: "cmp__mark", attrs: { "aria-hidden": "true", "data-testid": "cmp-ov-mark" } });
    const stage = h("div", { class: "cmp__stage", attrs: { role: "img", "data-testid": "cmp-ov-stage" } }, base, mark);
    const status = h("p", { class: "cmp__hint", attrs: { role: "status", "data-testid": "cmp-ov-status" } });
    base.style.opacity = "0.35";
    fade.addEventListener("input", () => { base.style.opacity = String(Number(fade.value) / 100); fadeOut.textContent = `${fade.value}%`; });
    let ticket = 0;
    let chain: Promise<void> = Promise.resolve();
    renderOverlay = () => {
      overlayDirty = false;
      const t = ++ticket;
      const p = pairs[Number(pick.input.value)];
      status.textContent = "Drawing the page…";
      chain = chain.then(async () => {
        if (t !== ticket) return;
        try {
          const n = await pixelDiff(v.docs[0], p.a === null ? null : p.a + 1, v.docs[1], p.b === null ? null : p.b + 1, Math.min(900, Math.round(stage.clientWidth) || 800), base, mark);
          if (t !== ticket) return;
          stage.dataset.changed = String(n);
          stage.setAttribute("aria-label", `${lab(p)}. The Original faded, with ${n ? `${plural(n, "pixel")} that differ marked` : "no differences"}.`);
          status.textContent = n ? `${plural(n, "pixel")} differ on this page pair.` : "No visible differences on this page pair.";
        } catch (e) {
          console.warn("overlay failed", e);
          status.textContent = "This page pair could not be drawn.";
        }
      });
    };
    const key = (c: readonly number[], t: string) => h("span", {}, h("span", { class: "cmp__sw", vars: { "--sw": rgb(c) } }), ` ${t} `);
    return [
      h("div", { class: "cmp__ctl" }, pick.el, h("div", { class: "field" }, h("label", { attrs: { for: "cmp-ov-fade" }, text: "How much of the Original shows" }), h("div", { class: "cmp__fade" }, fade, fadeOut))),
      h("p", { class: "cmp__legend" }, key(REMOVED_RGB, "Only in the Original."), key(ADDED_RGB, "Only in the Changed.")),
      status, stage,
    ];
  }

  function tabKeys(e: KeyboardEvent) {
    const ids = TABS.map((t) => t[0]);
    const i = ids.indexOf(tab);
    const to = e.key === "ArrowRight" ? ids[(i + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(i + ids.length - 1) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids.at(-1) : undefined;
    if (to) { e.preventDefault(); select(to, true); }
  }

  return {
    el: root,
    show(v: ViewData) {
      d = v; overlayDirty = true; tabs.clear(); panels.clear();
      const bar = h("div", { class: "cmp__tabs", attrs: { role: "tablist", "aria-label": "Views" } });
      for (const [id, label] of TABS) {
        const b = h("button", { class: "cmp__tab", id: `cmp-tab-${id}`, type: "button", text: label, attrs: { role: "tab", "aria-controls": `cmp-panel-${id}`, "data-testid": `cmp-tab-${id}` }, on: { click: () => select(id), keydown: tabKeys } });
        tabs.set(id, b);
        bar.append(b);
      }
      const body: Record<TabId, HTMLElement[]> = { changes: changesPanel(v), side: sidePanel(v), overlay: overlayPanel(v) };
      for (const [id] of TABS) panels.set(id, h("div", { class: "cmp__panel", id: `cmp-panel-${id}`, attrs: { role: "tabpanel", "aria-labelledby": `cmp-tab-${id}`, "data-testid": `cmp-panel-${id}` } }, ...body[id]));
      root.replaceChildren(
        h("p", { class: "cmp__sum", text: v.summary, attrs: { "data-testid": "cmp-summary" } }),
        ...v.notes.map((n) => h("p", { class: "hs-banner hs-banner--info", text: n, attrs: { role: "note", "data-testid": "cmp-note" } })),
        ...(v.scans ? [h("p", { class: "hs-banner hs-banner--warn", attrs: { role: "note", "data-testid": "cmp-scans" } }, "These look like scans. ", h("a", { href: "#/ocr", text: "Run OCR first", attrs: { "data-testid": "cmp-ocr-link" } }), " to compare their words. The Overlay tab still compares how the pages look.")] : []),
        bar, ...panels.values());
      root.hidden = false;
      select("changes");
    },
    reset() {
      d = undefined; marks = []; renderOverlay = () => undefined;
      pvs[0].setFile(undefined); pvs[1].setFile(undefined);
      root.hidden = true;
      root.replaceChildren();
    },
    destroy() { follow.forEach(clearTimeout); pvs[0].destroy(); pvs[1].destroy(); },
  };
}
