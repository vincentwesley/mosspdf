// Pointer-event drag reordering (mouse, touch, pen). Buttons/keys are provided by callers (WCAG 2.5.7).
// `longPress`: on touch, holding this selector's element (the thumbnail) for 450 ms also starts a drag.
export function sortable(list: HTMLElement, o: { item: string; handle: string; longPress?: string; onCommit: () => void }): void {
  let dragging = false;
  list.addEventListener("touchmove", (e) => { if (dragging) e.preventDefault(); }, { passive: false });

  function drag(handle: HTMLElement, item: HTMLElement, id: number) {
    dragging = true;
    handle.setPointerCapture(id);
    item.classList.add("is-dragging");
    const move = (m: PointerEvent) => {
      if (m.clientY < 70) window.scrollBy(0, -14);
      else if (m.clientY > innerHeight - 90) window.scrollBy(0, 14);
      const under = document.elementsFromPoint(m.clientX, m.clientY).find((n) => n !== item && n.closest(o.item)?.parentElement === list)?.closest<HTMLElement>(o.item);
      if (!under) return;
      const r = under.getBoundingClientRect();
      const after = m.clientY > r.bottom - r.height / 2 && (m.clientX > r.left + r.width / 2 || m.clientY > r.bottom - r.height / 4);
      const ref = after ? under.nextElementSibling : under;
      if (ref !== item && ref !== item.nextElementSibling) list.insertBefore(item, ref);
    };
    const end = () => {
      dragging = false;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      item.classList.remove("is-dragging");
      o.onCommit();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  list.addEventListener("pointerdown", (e) => {
    const target = e.target as Element;
    const handle = target.closest<HTMLElement>(o.handle);
    const item = (handle ?? target).closest<HTMLElement>(o.item);
    if (handle && item && (e.pointerType !== "mouse" || e.button === 0)) {
      e.preventDefault();
      return drag(handle, item, e.pointerId);
    }
    const pressed = o.longPress && e.pointerType === "touch" ? target.closest<HTMLElement>(o.longPress) : null;
    if (!pressed || !item) return;
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
    const timer = setTimeout(() => { off(); navigator.vibrate?.(15); drag(pressed, item, id); }, 450);
    const cancel = (m: PointerEvent) => { if (m.type !== "pointermove" || Math.hypot(m.clientX - x0, m.clientY - y0) > 10) { clearTimeout(timer); off(); } };
    const off = () => ["pointermove", "pointerup", "pointercancel"].forEach((t) => pressed.removeEventListener(t, cancel as EventListener));
    ["pointermove", "pointerup", "pointercancel"].forEach((t) => pressed.addEventListener(t, cancel as EventListener));
  });
}
