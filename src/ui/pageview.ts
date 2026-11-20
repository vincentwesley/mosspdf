// Page viewer for fill and sign: the pages of one PDF drawn at the width of their container (pdf.js, only while on screen),
// each in a positioned wrapper with an overlay layer for HTML (form controls, placed signatures).
// Overlay items are positioned in percent of the page (`style.left = "12.5%"`), so they follow resizing without any code;
// text inside them sizes with `cqw` (the wrapper is a size container), so a point size on the page is `size / vp.width * 100` cqw.
import type { PageViewport } from "pdfjs-dist/build/pdf.mjs";
import { renderThumb } from "../core/render";
import { store, type LoadedFile } from "../core/store";
import { h } from "./dom";

export interface Slot {
  /** 0-based. */
  index: number;
  wrap: HTMLElement;
  overlay: HTMLElement;
  /** The page at scale 1 as displayed (rotation and CropBox applied): width and height are the shown page in points. Set once the page is known. */
  vp?: PageViewport;
}

/** A PDF rectangle (user space, [x0, y0, x1, y1]) as fractions of the displayed page, from its top left. Handles rotation and CropBox through pdf.js. */
export function rectToFractions(vp: PageViewport, rect: [number, number, number, number]) {
  const [ax, ay] = vp.convertToViewportPoint(rect[0], rect[1]);
  const [bx, by] = vp.convertToViewportPoint(rect[2], rect[3]);
  return { left: Math.min(ax, bx) / vp.width, top: Math.min(ay, by) / vp.height, width: Math.abs(bx - ax) / vp.width, height: Math.abs(by - ay) / vp.height };
}
/** Fractions from the top left of the displayed page -> PDF user space point. */
export const fractionsToPdf = (vp: PageViewport, fx: number, fy: number): [number, number] => vp.convertToPdfPoint(fx * vp.width, fy * vp.height) as [number, number];

export function pageView(o: { onSlot?: (s: Slot) => void } = {}) {
  const el = h("div", { class: "vw", attrs: { "data-testid": "page-view" } });
  let slots: Slot[] = [];
  let file: LoadedFile | undefined;
  const drawn = new Map<Slot, { width: number; cancel: () => void }>();

  const ensure = async (s: Slot): Promise<PageViewport> => {
    if (s.vp) return s.vp;
    const f = file!;
    const page = await (await store.doc(f)).getPage(s.index + 1);
    const vp = page.getViewport({ scale: 1 });
    if (f !== file) return vp; // the file changed while waiting: this slot is gone
    s.vp ??= vp;
    s.wrap.style.setProperty("--ar", `${s.vp.width} / ${s.vp.height}`);
    o.onSlot?.(s);
    return s.vp;
  };

  async function draw(s: Slot) {
    const canvas = s.wrap.querySelector("canvas")!;
    const width = Math.round(s.wrap.clientWidth);
    if (!file || !width || drawn.get(s)?.width === width) return;
    drawn.get(s)?.cancel();
    const f = file;
    await ensure(s);
    if (f !== file) return;
    const r = renderThumb(await store.doc(f), s.index + 1, 0, canvas, width);
    drawn.set(s, { width, cancel: r.cancel });
    r.done.then(() => s.wrap.classList.add("is-drawn")).catch((e) => { console.warn("page failed", e); drawn.delete(s); });
  }
  function release(s: Slot) {
    drawn.get(s)?.cancel();
    drawn.delete(s);
    s.wrap.classList.remove("is-drawn");
    const c = s.wrap.querySelector("canvas")!;
    c.width = c.height = 0;
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = slots.find((x) => x.wrap === e.target);
      if (!s) continue;
      if (e.isIntersecting) void draw(s); else release(s);
    }
  }, { rootMargin: "600px 0px" });
  // Re-render at the new width (sharp text after a window resize or rotating a phone).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ro = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => drawn.forEach((_, s) => void draw(s)), 200);
  });
  ro.observe(el);

  return {
    el,
    get slots() { return slots; },
    /** Resolves the page's viewport (and fires `onSlot`) without drawing it. */
    ensure: (i: number) => ensure(slots[i]),
    setFile(f: LoadedFile | undefined) {
      if (f === file) return;
      drawn.forEach((d) => d.cancel());
      drawn.clear();
      slots.forEach((s) => io.unobserve(s.wrap));
      file = f;
      const n = f?.info?.pageCount ?? 0;
      slots = Array.from({ length: n }, (_, index) => {
        const sz = f!.info!.pageSizes[index];
        const turned = (sz.rotate / 90) % 2 === 1;
        const overlay = h("div", { class: "vw__overlay", attrs: { "data-testid": "pv-overlay" } });
        const wrap = h("div", { class: "vw__page", attrs: { role: "group", "aria-label": `Page ${index + 1} of ${n}`, "data-testid": "pv-page", "data-page": index } },
          h("canvas", { class: "vw__canvas", attrs: { "aria-hidden": "true" } }), overlay);
        wrap.style.setProperty("--ar", turned ? `${sz.h} / ${sz.w}` : `${sz.w} / ${sz.h}`);
        io.observe(wrap);
        return { index, wrap, overlay };
      });
      el.replaceChildren(...slots.map((s) => h("div", { class: "vw__item" }, s.wrap, h("p", { class: "vw__label", text: `Page ${s.index + 1}`, attrs: { "aria-hidden": "true" } }))));
    },
    destroy() { io.disconnect(); ro.disconnect(); clearTimeout(timer); drawn.forEach((d) => d.cancel()); },
  };
}
