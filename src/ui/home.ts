import { isPdfFile, store } from "../core/store";
import { getRecent } from "../core/recent";
import { CATALOG, TOOLS, type ToolMeta } from "../tools";
import { matchTool } from "../core/toolsearch";
import { h } from "./dom";
import { dropzone, setFilesHandler } from "./dropzone";
import { toolBox } from "./toolicons";

/** The last category chip, kept while this tab lives (not stored). */
let lastChip = "All";

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
        const t = TOOLS.find((x) => x.id === id)!;
        return h("li", {}, h("a", { class: `hs-btn chooser__opt${i ? " hs-btn--secondary" : ""}`, attrs: { href: `#/${id}`, "data-testid": `choose-${id}` }, on: { click: () => chooser.close() } },
          toolBox(id), h("span", { class: "chooser__txt" }, h("span", { class: "chooser__title", text: `${t.title}${i === 0 ? " (suggested)" : ""}` }), h("span", { class: "chooser__blurb", text: t.blurb }))));
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

  const tile = (t: ToolMeta) => h("li", { class: "tile" }, h("a", { class: "tile__in hs-card", attrs: { href: `#/${t.id}`, "data-testid": `tile-${t.id}` } },
    toolBox(t.id), h("span", { class: "tile__txt" }, h("span", { class: "tile__title", text: t.title }), h("span", { class: "tile__blurb", text: t.blurb }))));

  const groups = CATALOG.map((g, i) => {
    const items = g.tools.map((t) => ({ t, li: tile(t) }));
    const el = h("section", { class: "group", attrs: { "aria-labelledby": `g-${i}` } },
      h("h2", { id: `g-${i}`, class: "hs-eyebrow", text: g.name }),
      h("ul", { class: "tiles", attrs: { role: "list" } }, ...items.map((x) => x.li)));
    return { el, items };
  });

  // "Find a tool": hides non-matching tiles and empty groups as you type.
  const none = h("p", { class: "find__none", text: "No tool matches. Try a different word, like merge or compress.", hidden: true, attrs: { "data-testid": "find-none", role: "status" } });
  // Category chips (toggle buttons) and the search box narrow the same tiles.
  let chip = lastChip;
  const apply = () => {
    const q = find.value;
    let any = false;
    for (const [i, g] of groups.entries()) {
      let shown = 0;
      const inChip = chip === "All" || chip === CATALOG[i].name;
      for (const { t, li } of g.items) { li.hidden = !inChip || !matchTool({ ...t, group: CATALOG[i].name }, q); if (!li.hidden) shown++; }
      g.el.hidden = !shown;
      any ||= !!shown;
    }
    none.hidden = any;
  };
  const find = h("input", { class: "hs-input", id: "find", type: "search", attrs: { autocomplete: "off", "data-testid": "find-tool" }, on: { input: apply } });
  const chipBtns = ["All", ...CATALOG.map((g) => g.name)].map((name) => h("button", { class: "hs-btn hs-btn--secondary hs-btn--sm chip", type: "button", text: name, attrs: { "aria-pressed": String(name === chip), "data-testid": `chip-${name}` }, on: { click: () => {
    chip = lastChip = name;
    chipBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === name)));
    apply();
  } } }));
  const chips = h("div", { class: "chips", attrs: { role: "group", "aria-label": "Tool categories" } }, ...chipBtns);
  if (chip !== "All") apply();
  const findRow = h("div", { class: "find" }, h("label", { class: "find__label", text: "Find a tool", attrs: { for: "find" } }), find, chips, none);

  const recent = getRecent().map((id) => TOOLS.find((t) => t.id === id)).filter((t): t is ToolMeta => !!t);
  const recentRow = h("section", { class: "recent", hidden: !recent.length, attrs: { "aria-labelledby": "recent-h", "data-testid": "recent" } },
    h("h2", { id: "recent-h", class: "hs-eyebrow", text: "Recently used" }),
    h("ul", { class: "recent__list", attrs: { role: "list" } }, ...recent.map((t) => h("li", {}, h("a", { class: "hs-btn hs-btn--secondary", text: t.title, attrs: { href: `#/${t.id}`, "data-testid": `recent-${t.id}` } })))));

  const el = h("div", { class: "view home" },
    h("header", { class: "hero" },
      h("h1", { text: "PDF tools that stay on your device.", attrs: { tabindex: -1, "data-testid": "view-heading" } }),
      h("p", { class: "hero__lede" }, "Your files stay on this device. ", h("a", { href: "#/privacy", text: "See how to check" }), "."),
      h("ol", { class: "steps3", attrs: { "data-testid": "three-steps" } }, ...["Pick a tool.", "Add your file.", "Download."].map((t) => h("li", { text: t })))),
    dropzone({ hint: "or drop them here. You can also paste." }),
    h("p", { class: "trust" }, h("a", { href: "#/privacy", text: "Files stay on this device · No account · Works offline after the first visit", attrs: { "data-testid": "trust-strip" } })),
    findRow,
    recentRow,
    groups[0].el,
    h("div", { class: "groups-soon" }, ...groups.slice(1).map((g) => g.el)),
    chooser);
  return { el, destroy: () => chooser.close() };
}
