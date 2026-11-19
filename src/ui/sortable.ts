// Pointer-event drag reordering (mouse, touch, pen). Buttons/keys are provided by callers (WCAG 2.5.7).
export function sortable(list: HTMLElement, o: { item: string; handle: string; onCommit: () => void }): void {
  list.addEventListener("pointerdown", (e) => {
    const handle = (e.target as Element).closest<HTMLElement>(o.handle);
    const item = handle?.closest<HTMLElement>(o.item);
    if (!handle || !item || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
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
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      item.classList.remove("is-dragging");
      o.onCommit();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}
