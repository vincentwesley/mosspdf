import { h } from "./dom";

const KEY = "mosspdf.install-dismissed";
interface InstallEvent extends Event { prompt(): Promise<unknown> }

/** Chromium only: offer "Install" in the footer (no modal). iOS never fires the event. */
export function initInstall(nav: HTMLElement): void {
  try { if (localStorage.getItem(KEY) || matchMedia("(display-mode: standalone)").matches) return; } catch { /* storage blocked: still offer */ }
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    const ev = e as InstallEvent;
    const hide = () => box.remove();
    const box = h("span", { class: "install", attrs: { "data-testid": "install" } },
      h("button", { type: "button", text: "Install MossPDF \u2014 works offline", attrs: { "data-testid": "install-btn" }, on: { click: () => { void ev.prompt(); hide(); } } }),
      h("button", { class: "dlg__x", type: "button", text: "\u00d7", attrs: { "aria-label": "Dismiss install offer", "data-testid": "install-close" }, on: { click: () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } hide(); } } }));
    nav.prepend(box);
  }, { once: true });
  addEventListener("appinstalled", () => document.querySelector("[data-testid=install]")?.remove());
}
