import { btn, h } from "./dom";

export type FilesHandler = (files: File[]) => void;
let handler: FilesHandler = () => undefined;
/** The current view decides what dropped or pasted files do. */
export const setFilesHandler = (f: FilesHandler) => { handler = f; };

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");

export function initGlobalIntake(): void {
  addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.body.classList.remove("is-dropping");
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) handler(files);
  });
  addEventListener("dragenter", (e) => { if (hasFiles(e)) document.body.classList.add("is-dropping"); });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("is-dropping"); });
  addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) { e.preventDefault(); handler(files); }
  });
}

export function dropzone(o: { compact?: boolean; title?: string; accept?: string }): HTMLElement {
  const input = h("input", { type: "file", class: "sr-only", attrs: { multiple: true, accept: o.accept ?? ".pdf,application/pdf,image/*", "data-testid": "file-input", "aria-label": "Choose files", tabindex: -1 } });
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) handler(files);
  });
  return h("div", { class: `dz hs-card${o.compact ? " dz--compact" : ""}`, attrs: { "data-testid": "dropzone" } },
    h("div", { class: "dz__text" },
      h("p", { class: "dz__title", text: o.title ?? "Drop PDFs or images here" }),
      h("p", { class: "dz__hint", text: "or paste them. They stay on this device." })),
    input,
    btn("Choose files", () => input.click(), { class: "hs-btn", attrs: { "data-testid": "choose-files" } }));
}
