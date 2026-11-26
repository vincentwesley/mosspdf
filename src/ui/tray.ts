// File tray: every file held in memory, with remove and Clear all. On home it lists them all; inside a tool only the files it won't use, dimmed with a reason.
import { store } from "../core/store";
import { unfitReason, type Fit } from "../core/trayfit";
import { announce, h, plural } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

/** `fit` is given inside a tool (dims what it won't use) and omitted on home. */
export function tray(fit?: Fit): { el: HTMLElement; destroy: () => void } {
  const count = h("span", { class: "tray__count", attrs: { "data-testid": "tray-count" } });
  const list = h("ul", { class: "tray__list", attrs: { role: "list", "aria-label": "Files in the tray" } });
  const el = h("section", { class: "tray", hidden: true, attrs: { "aria-label": "File tray", "data-testid": "tray" } },
    h("div", { class: "tray__head" }, count,
      h("span", { class: "tray__note", text: "Kept only while this tab is open.", attrs: { title: "Kept only while this tab is open. Nothing is saved to disk." } }),
      h("button", { class: "hs-btn hs-btn--ghost hs-btn--sm", type: "button", text: "Clear all", attrs: { "data-testid": "tray-clear" }, on: { click: () => {
        if (store.busy) return;
        const snap = store.files.slice();
        store.clear();
        announce("Tray cleared.");
        toast(`Cleared ${plural(snap.length, "file")}.`, { label: "Undo", run: () => store.restore(snap) });
      } } })),
    list);
  const render = () => {
    const files = store.files;
    el.hidden = !files.length;
    count.textContent = `${files.length} ${files.length === 1 ? "file" : "files"} ready`;
    // Inside a tool its own file list already shows the files it uses; the tray then lists only the ones it leaves out, with why.
    const shown = files.map((f) => ({ f, why: unfitReason(f, files, fit) })).filter((x) => !fit || x.why);
    list.hidden = !shown.length;
    list.replaceChildren(...shown.map(({ f, why }) =>
      h("li", { class: `tray__item${why ? " is-dim" : ""}`, attrs: { "data-testid": "tray-item", "data-fit": why ? "no" : "yes" } },
        h("span", { class: "tray__name", text: f.name }),
        why && h("span", { class: "tray__why", text: why, attrs: { "data-testid": "tray-why" } }),
        h("button", { class: "dlg__x", type: "button", disabled: store.busy, attrs: { "aria-label": `Remove ${f.name} from the tray`, "data-testid": "tray-remove" }, on: { click: () => {
          const snap = store.files.slice();
          store.remove(f.id);
          announce(`${f.name} removed.`);
          toast(`Removed ${f.name}.`, { label: "Undo", run: () => store.restore(snap) });
        } } }, icon("close")))));
  };
  render();
  return { el, destroy: store.subscribe(render) };
}
