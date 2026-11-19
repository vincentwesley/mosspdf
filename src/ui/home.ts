import { isPdfFile, store } from "../core/store";
import { CATALOG, LIVE, isLive } from "../tools";
import type { ToolDef } from "../tools/types";
import { h } from "./dom";
import { dropzone, setFilesHandler } from "./dropzone";

/** Which tool fits the files that were just dropped. */
function suggest(pdfs: number): string[] {
  return pdfs >= 2 ? ["merge", "organize", "split", "extract"] : ["organize", "split", "extract", "merge"];
}

export function homeView(navigate: (hash: string) => void): { el: HTMLElement; destroy: () => void } {
  const chooser = h("dialog", { class: "hs-dialog chooser", attrs: { "aria-labelledby": "chooser-h", "data-testid": "chooser" } });
  const openChooser = (pdfs: number, count: number) => {
    const order = suggest(pdfs);
    chooser.replaceChildren(
      h("div", { class: "dlg__head" }, h("h2", { id: "chooser-h", text: `What should we do with ${count === 1 ? "this file" : `these ${count} files`}?`, attrs: { tabindex: -1 } }),
        h("button", { class: "dlg__x", type: "button", text: "Close", attrs: { "aria-label": "Close", "data-testid": "chooser-close" }, on: { click: () => chooser.close() } })),
      h("ul", { class: "chooser__list", attrs: { role: "list" } }, ...order.map((id, i) => {
        const t = LIVE.find((x) => x.id === id)!;
        return h("li", {}, h("a", { class: `hs-btn${i ? " hs-btn--secondary" : ""}`, text: `${t.title}${i === 0 ? " (suggested)" : ""}`, attrs: { href: `#/${id}`, "data-testid": `choose-${id}` }, on: { click: () => chooser.close() } }));
      })));
    if (!chooser.open) chooser.showModal();
  };
  const intake = (files: File[]) => {
    const pdfs = files.filter(isPdfFile);
    if (pdfs.length) {
      void store.add(files);
      openChooser(pdfs.length, pdfs.length);
    } else void store.add(files, "any").then(() => navigate(store.files.some((f) => f.kind === "image") ? "#/images-to-pdf" : "#/merge"));
  };
  setFilesHandler(intake);

  const tile = (t: ToolDef) => isLive(t)
    ? h("li", { class: "tile" }, h("a", { class: "tile__in hs-card", attrs: { href: `#/${t.id}`, "data-testid": `tile-${t.id}` } },
      h("span", { class: "tile__title", text: t.title }), h("span", { class: "tile__blurb", text: t.blurb })))
    : h("li", { class: "tile" }, h("div", { class: "tile__in hs-card hs-pending", attrs: { "data-testid": `tile-${t.id}`, "data-pending": true } },
      h("span", { class: "tile__title", text: t.title }), h("span", { class: "tile__blurb", text: t.blurb }), h("span", { class: "tile__soon", text: "Coming soon" })));

  const group = (g: (typeof CATALOG)[number], i: number) => h("section", { class: "group", attrs: { "aria-labelledby": `g-${i}` } },
    h("h2", { id: `g-${i}`, class: "hs-eyebrow", text: g.name }),
    h("ul", { class: "tiles", attrs: { role: "list" } }, ...g.tools.map(tile)));

  const el = h("div", { class: "view home" },
    h("header", { class: "hero" },
      h("h1", { text: "PDF tools that stay on your device.", attrs: { tabindex: -1, "data-testid": "view-heading" } }),
      h("p", { class: "hero__lede" }, "Your files never leave this device. ", h("a", { href: "#/privacy", text: "See how to check" }), ".")),
    dropzone({}),
    group(CATALOG[0], 0),
    h("div", { class: "groups-soon" }, ...CATALOG.slice(1).map((g, i) => group(g, i + 1))),
    chooser);
  return { el, destroy: () => chooser.close() };
}
