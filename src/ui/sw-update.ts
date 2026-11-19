// Registers the service worker and offers a reload when a new version is waiting. Never reloads by itself, never during a job.
import { store } from "../core/store";
import { scriptUrl } from "../core/tt";
import { h } from "./dom";
import { icon } from "./icons";

export async function watchUpdates(): Promise<void> {
  const reg = await navigator.serviceWorker.register(scriptUrl("/sw.js"));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading) location.reload(); });
  let shown = false;
  const offer = () => {
    if (shown || !reg.waiting || !navigator.serviceWorker.controller) return;
    shown = true;
    const reload = h("button", { class: "hs-btn", type: "button", text: "Reload", attrs: { "data-testid": "update-reload" } });
    const note = h("span", { class: "upd__note", attrs: { "data-testid": "update-note" } });
    const sync = () => { reload.disabled = store.busy; note.textContent = store.busy ? "Finish or cancel your current job first." : ""; };
    const unsub = store.subscribe(sync);
    sync();
    const bar = h("div", { class: "upd hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "update-banner" } },
      h("span", { class: "upd__msg", text: "A new version is ready." }), note, reload,
      h("button", { class: "dlg__x", type: "button", attrs: { "aria-label": "Dismiss", "data-testid": "update-dismiss" }, on: { click: () => { unsub(); bar.remove(); } } }, icon("close")));
    reload.addEventListener("click", () => {
      if (store.busy) return;
      reloading = true;
      reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    document.body.append(bar);
  };
  offer();
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    w?.addEventListener("statechange", () => { if (w.state === "installed") offer(); });
  });
}
