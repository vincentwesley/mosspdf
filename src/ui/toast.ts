// Closable toast (house .hs-toast). Optional action button (e.g. Undo). Auto-dismisses after 12 s; the X is always there.
import { h } from "./dom";
import { icon } from "./icons";

let box: HTMLElement | undefined;

export function toast(message: string, action?: { label: string; run: () => void }): void {
  if (!box || !box.isConnected) {
    box = h("div", { class: "hs-toasts", attrs: { role: "status", "aria-live": "polite", "data-testid": "toasts" } });
    document.body.append(box);
  }
  const el = h("div", { class: "hs-toast toast", attrs: { "data-testid": "toast" } });
  const close = () => { el.dataset.leaving = "true"; setTimeout(() => el.remove(), 200); clearTimeout(timer); };
  const timer = setTimeout(close, 12_000);
  el.append(
    h("span", { class: "toast__msg", text: message }),
    action ? h("button", { class: "hs-btn hs-btn--sm", type: "button", text: action.label, attrs: { "data-testid": "toast-action" }, on: { click: () => { action.run(); close(); } } }) : "",
    h("button", { class: "dlg__x", type: "button", attrs: { "aria-label": "Close", "data-testid": "toast-close" }, on: { click: close } }, icon("close")));
  box.append(el);
}
