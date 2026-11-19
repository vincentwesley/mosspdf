import { store, type LoadedFile } from "../core/store";
import { announce, fmtSize, h, plural } from "./dom";
import { icon } from "./icons";
import { sortable } from "./sortable";

export function fileList(o: { reorder: boolean; visible?: () => LoadedFile[] }): { el: HTMLElement; render: () => void } {
  const ul = h("ul", { class: "files", attrs: { role: "list", "data-testid": "file-list", "aria-label": "Your files" } });

  const iconBtn = (name: "up" | "down" | "close" | "grip", label: string, fn: (() => void) | null, testid: string, disabled = false) =>
    h("button", { class: `pg__btn${name === "grip" ? " files__grip" : ""}`, type: "button", disabled, attrs: { "aria-label": label, title: label, "data-testid": testid }, on: fn ? { click: fn } : {} }, icon(name));

  function row(f: LoadedFile, i: number, n: number): HTMLElement {
    const meta = f.status === "ready" && f.info ? `${plural(f.info.pageCount, "page")} · ${fmtSize(f.size)}` : f.status === "loading" ? "Reading…" : fmtSize(f.size);
    const li = h("li", { class: "file", attrs: { "data-testid": "file-row", "data-file-id": f.id, "data-status": f.status } },
      h("span", { class: "file__icon" }, icon(f.status === "locked" ? "lock" : "file")),
      h("div", { class: "file__main" },
        h("p", { class: "file__name", text: f.name }),
        h("p", { class: "file__meta", text: meta, attrs: { "data-testid": "file-meta" } }),
        f.status === "error" && f.error && h("p", { class: "file__err", text: f.error, attrs: { role: "alert" } }),
        f.status === "locked" && passwordForm(f)),
      h("div", { class: "file__acts" },
        o.reorder && iconBtn("grip", `Drag ${f.name} to reorder`, null, "file-grip"),
        o.reorder && iconBtn("up", `Move ${f.name} up`, () => { store.move(f.id, i - 1); announce(`${f.name} moved to position ${i}.`); focusRow(f.id, "file-up"); }, "file-up", i === 0),
        o.reorder && iconBtn("down", `Move ${f.name} down`, () => { store.move(f.id, i + 1); announce(`${f.name} moved to position ${i + 2}.`); focusRow(f.id, "file-down"); }, "file-down", i === n - 1),
        iconBtn("close", `Remove ${f.name}`, () => { store.remove(f.id); announce(`${f.name} removed.`); }, "file-remove")));
    return li;
  }
  const focusRow = (id: number, tid: string) => queueMicrotask(() => {
    const b = ul.querySelector<HTMLButtonElement>(`[data-file-id="${id}"] [data-testid=${tid}]`);
    (b && !b.disabled ? b : ul.querySelector<HTMLElement>(`[data-file-id="${id}"] button`))?.focus();
  });

  function passwordForm(f: LoadedFile): HTMLElement {
    const id = `pw-${f.id}`;
    const input = h("input", { class: "hs-input", id, type: "password", attrs: { autocomplete: "off", "data-testid": "file-password", "aria-describedby": `${id}-d` } });
    const form = h("form", { class: "pw", on: { submit: (e) => { e.preventDefault(); void store.unlock(f, input.value); } } },
      h("label", { class: "pw__label", text: "This file is locked. Password", attrs: { for: id } }),
      h("div", { class: "pw__row" }, input, h("button", { class: "hs-btn", type: "submit", text: "Unlock", attrs: { "data-testid": "file-unlock" } })),
      h("p", { class: "file__hint", id: `${id}-d`, text: f.error ?? "The password is only used here, on this device." }));
    return form;
  }

  sortable(ul, {
    item: ".file", handle: ".files__grip",
    onCommit: () => { store.reorder([...ul.children].map((li) => Number((li as HTMLElement).dataset.fileId))); announce("File moved."); },
  });

  function render() {
    const refocus = (document.activeElement as HTMLElement | null)?.dataset.testid === "file-password";
    const files = o.visible ? o.visible() : store.files;
    ul.replaceChildren(...files.map((f, i) => row(f, i, files.length)));
    if (refocus) ul.querySelector<HTMLElement>("[data-testid=file-password]")?.focus();
  }
  render();
  return { el: ul, render };
}
