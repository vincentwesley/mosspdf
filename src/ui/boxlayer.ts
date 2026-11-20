// Boxes the user draws on a page or a photo (redact, photo clean). Positions are fractions of the overlay, so they follow resizing.
// Pointer: drag on empty overlay to draw (mouse or pen; touch uses an "Add box" button so scrolling keeps working), drag a box to move it.
// Keyboard (WCAG 2.5.7): arrows move (Shift = 10 px), Alt+arrows change width/height, plus and minus resize, Delete removes.
import type { Rect } from "../core/textpos";
import { h } from "./dom";

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
export function place(el: HTMLElement, r: Rect) {
  el.style.left = `${r.x * 100}%`; el.style.top = `${r.y * 100}%`; el.style.width = `${r.w * 100}%`; el.style.height = `${r.h * 100}%`;
}

/** Makes `el` (already in `overlay`) draggable and keyboard-operable; `r` is edited in place. */
export function wireBox(el: HTMLElement, r: Rect, overlay: HTMLElement, o: { onChange: () => void; onDelete: () => void }) {
  const apply = () => {
    r.w = clamp(r.w, 0.01, 1); r.h = clamp(r.h, 0.01, 1);
    r.x = clamp(r.x, 0, 1 - r.w); r.y = clamp(r.y, 0, 1 - r.h);
    place(el, r);
    o.onChange();
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault(); e.stopPropagation();
    el.focus();
    el.setPointerCapture(e.pointerId);
    const b = overlay.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, x: r.x, y: r.y };
    const move = (m: PointerEvent) => { r.x = start.x + (m.clientX - start.px) / b.width; r.y = start.y + (m.clientY - start.py) / b.height; apply(); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  });
  el.addEventListener("keydown", (e) => {
    const b = overlay.getBoundingClientRect();
    const px = e.shiftKey ? 10 : 1;
    const [dx, dy] = [px / b.width, px / b.height];
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); o.onDelete(); return; }
    if (e.key === "+" || e.key === "=") { r.w *= 1.1; r.h *= 1.1; }
    else if (e.key === "-") { r.w /= 1.1; r.h /= 1.1; }
    else if (e.altKey && e.key === "ArrowRight") r.w += dx;
    else if (e.altKey && e.key === "ArrowLeft") r.w -= dx;
    else if (e.altKey && e.key === "ArrowDown") r.h += dy;
    else if (e.altKey && e.key === "ArrowUp") r.h -= dy;
    else if (e.key === "ArrowLeft") r.x -= dx;
    else if (e.key === "ArrowRight") r.x += dx;
    else if (e.key === "ArrowUp") r.y -= dy;
    else if (e.key === "ArrowDown") r.y += dy;
    else return;
    e.preventDefault();
    apply();
  });
}

/** Drag on the empty overlay to draw a box; `onRect` gets it when the pointer is released (tiny drags are ignored). */
export function drawBoxes(overlay: HTMLElement, onRect: (r: Rect) => void) {
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target !== overlay || e.pointerType === "touch" || e.button !== 0) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    const b = overlay.getBoundingClientRect();
    const at = (ev: PointerEvent): [number, number] => [clamp((ev.clientX - b.left) / b.width, 0, 1), clamp((ev.clientY - b.top) / b.height, 0, 1)];
    const [x0, y0] = at(e);
    const ghost = h("div", { class: "rd-box rd-box--on rd-box--ghost", attrs: { "aria-hidden": "true" } });
    overlay.append(ghost);
    const rect = (ev: PointerEvent): Rect => { const [x, y] = at(ev); return { x: Math.min(x, x0), y: Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0) }; };
    const move = (m: PointerEvent) => place(ghost, rect(m));
    const end = (u: PointerEvent, ok: boolean) => {
      overlay.removeEventListener("pointermove", move); overlay.removeEventListener("pointerup", up); overlay.removeEventListener("pointercancel", cancel);
      ghost.remove();
      const r = rect(u);
      if (ok && r.w * b.width > 4 && r.h * b.height > 4) onRect(r);
    };
    const up = (u: PointerEvent) => end(u, true);
    const cancel = (u: PointerEvent) => end(u, false);
    overlay.addEventListener("pointermove", move); overlay.addEventListener("pointerup", up); overlay.addEventListener("pointercancel", cancel);
  });
}
