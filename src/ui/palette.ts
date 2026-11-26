// Command palette (Ctrl/Cmd+K) and the shortcuts list ("?"). Native <dialog>; the search box is an ARIA 1.2 combobox over a listbox.
import { store } from "../core/store";
import { scoreTool } from "../core/toolsearch";
import { CATALOG } from "../tools";
import { h } from "./dom";
import { icon } from "./icons";
import { toolBox } from "./toolicons";
import { toast } from "./toast";

interface Cmd { id: string; label: string; hint: string; blurb: string; run: () => void }
export interface PaletteActions { switchTheme(): void; openPrivacy(opener: HTMLElement): void }

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = mac ? "⌘" : "Ctrl";

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function dialogShell(label: string, id: string, testid: string, cls: string, ...kids: (Node | string)[]) {
  const d: HTMLDialogElement = h("dialog", { class: `hs-dialog ${cls}`, attrs: { "aria-labelledby": id, "data-testid": testid } },
    h("div", { class: "dlg__head" },
      h("h2", { id, text: label, attrs: { tabindex: -1 } }),
      h("button", { class: "dlg__x", type: "button", attrs: { "aria-label": "Close", "data-testid": `${testid}-close` }, on: { click: () => d.close() } }, icon("close"))),
    ...kids);
  return d;
}

export function initPalette(act: PaletteActions): { open(opener?: HTMLElement): void } {
  let opener: HTMLElement | null = null;
  let skipRefocus = false;
  let shown: Cmd[] = [];
  let active = 0;

  const go = (id: string) => () => { skipRefocus = true; location.hash = `#/${id}`; };
  const toolCmds = () => CATALOG.flatMap((g) => g.tools.map((t): Cmd => ({ id: `tool-${t.id}`, label: t.title, hint: g.name, blurb: `${t.blurb} ${g.name}`, run: go(t.id) })));
  const cmds: Cmd[] = [
    { id: "cmd-theme", label: "Switch theme", hint: "Command", blurb: "dark light appearance", run: () => act.switchTheme() },
    { id: "cmd-privacy", label: "Privacy log", hint: "Command", blurb: "requests seal network", run: () => { skipRefocus = true; act.openPrivacy(opener ?? document.body); } },
    { id: "cmd-help", label: "Help", hint: "Command", blurb: "faq questions offline limits browsers", run: () => { location.href = "/help/"; } },
    { id: "cmd-clear", label: "Clear all files", hint: "Command", blurb: "remove delete files", run: () => {
      const snap = store.files.slice();
      store.clear();
      if (snap.length) toast(snap.length === 1 ? `Cleared ${snap[0].name}.` : `Cleared ${snap.length} files.`, { label: "Undo", run: () => store.restore(snap) });
    } },
  ];
  const all = () => [...toolCmds(), ...cmds];

  const list = h("ul", { class: "pal__list", id: "pal-list", attrs: { role: "listbox", "aria-label": "Tools and commands", "data-testid": "palette-list" } });
  const none = h("p", { class: "pal__none", text: "Nothing matches. Try a different word, like merge or compress.", hidden: true, attrs: { role: "status", "data-testid": "palette-none" } });
  const input = h("input", { class: "hs-input", id: "pal-q", type: "text", attrs: { role: "combobox", "aria-label": "Search tools and commands", "aria-controls": "pal-list", "aria-expanded": "true", "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false", "data-testid": "palette-input" } });
  const dialog = dialogShell("Search tools", "pal-h", "palette", "pal", input, list, none);

  const mark = () => {
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    const cur = list.children[active] as HTMLElement | undefined;
    if (cur) { input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    const q = input.value;
    shown = q.trim()
      ? all().map((c) => ({ c, s: scoreTool({ title: c.label, blurb: c.blurb, group: c.hint as never }, q) })).filter((x) => x.s).sort((a, b) => b.s - a.s).map((x) => x.c)
      : all();
    active = 0;
    list.replaceChildren(...shown.map((c, i) => h("li", { class: "pal__opt", id: `pal-o-${i}`, attrs: { role: "option", "data-testid": "palette-option", "data-id": c.id }, on: { click: () => pick(c) } },
      c.id.startsWith("tool-") ? toolBox(c.id.slice(5)) : h("span", { class: "ibox ibox--blank" }), h("span", { class: "pal__label", text: c.label }), h("span", { class: "pal__hint", text: c.hint }))));
    list.hidden = !shown.length;
    none.hidden = !!shown.length;
    mark();
  };
  const pick = (c: Cmd) => { dialog.close(); c.run(); };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) { active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length; mark(); }
    } else if (e.key === "Enter" && shown[active]) { e.preventDefault(); pick(shown[active]); }
  });
  dialog.addEventListener("close", () => { if (!skipRefocus && opener?.isConnected) opener.focus(); skipRefocus = false; });

  // ---- shortcuts list ----
  const rows: [string[], string][] = [
    [[MOD, "K"], "Search tools and commands"], [["?"], "Show this list"], [["Esc"], "Close a dialog"],
    [["↑", "↓"], "Move through search results"], [["Enter"], "Open the chosen result"],
    [["Alt", "← →"], "Move the focused page (page grids)"], [["Delete"], "Remove the focused page (page grids)"], [["Enter", "Space"], "Select the focused page (Extract)"],
  ];
  const keys = h("dl", { class: "keys", attrs: { "data-testid": "shortcut-list" } }, ...rows.flatMap(([k, d]) => [
    h("dt", {}, ...k.flatMap((x, i) => [i ? " + " : "", h("kbd", { text: x })])), h("dd", { text: d })]));
  const help = dialogShell("Keyboard shortcuts", "kbd-h", "shortcuts", "kbdlg", keys);
  help.addEventListener("close", () => { if (opener?.isConnected) opener.focus(); });
  document.body.append(dialog, help);

  const open = (from?: HTMLElement) => {
    opener = from ?? (document.activeElement as HTMLElement | null);
    input.value = "";
    render();
    dialog.showModal();
    input.focus();
  };
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else if (!document.querySelector("dialog[open]")) open();
    } else if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      opener = document.activeElement as HTMLElement | null;
      help.showModal();
      help.querySelector<HTMLElement>("#kbd-h")?.focus();
    }
  });
  return { open };
}
