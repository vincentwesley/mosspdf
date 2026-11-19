// Shared workspace for every tool: heading, dropzone, file list, warnings, options, page grid, output settings,
// action bar (progress, cancel, status), results and downloads, and the job runner. A tool module only supplies a ToolDef.
import { prefs, store, errorMessage, toIn, isPdfFile, type LoadedFile } from "../core/store";
import { opsRpc } from "../core/engines";
import type { CallOptions } from "../core/rpc";
import { PdfError, type OpResult } from "../ops/types";
import type { Ctx, GridOpts, ToolDef } from "../tools/types";
import { announce, fmtSize, h } from "./dom";
import { toast } from "./toast";
import { dropzone, setFilesHandler } from "./dropzone";
import { fileList } from "./filelist";
import { newItem, pageGrid } from "./pagegrid";
import { saveResult, saveZip } from "./download";

const DROP_TITLE = { pdf: "Drop a PDF here", pdfs: "Drop PDFs here", images: "Drop images here", "pdf-pair": "Drop the two PDFs here" } as const;
const ACCEPT = {
  pdf: ".pdf,application/pdf",
  images: "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif",
} as const;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

export function workspace(tool: ToolDef): { el: HTMLElement; destroy: () => void } {
  const kind: LoadedFile["kind"] = tool.accepts === "images" ? "image" : "pdf";
  const multi = tool.accepts !== "pdf";
  const gridOpts: GridOpts | null = tool.grid ? { open: true, ...(tool.grid === true ? {} : tool.grid) } : null;

  // ---- state ----
  let itemsKey = "";
  let results: OpResult[] = [];
  let abort: AbortController | null = null;
  let jobNote = "";
  let primaryEnabled = false;
  let o: CallOptions = {};
  let local: unknown;
  const ofKind = () => store.files.filter((f) => f.kind === kind);
  /** Single-PDF tools work on the newest file; the others on all of their kind. */
  const mine = () => (tool.accepts === "pdf" ? ofKind().slice(-1) : ofKind());
  const ready = () => mine().filter((f) => f.status === "ready");

  const ctx: Ctx = {
    tool,
    get files() { return ready(); },
    get file() { return ready()[0]; },
    items: [],
    dirty: false,
    pagesOpen: gridOpts?.open ?? true,
    setPagesOpen(open) { ctx.pagesOpen = open; update(); },
    syncGrid() { grid?.sync(); },
    get producerCredit() { return prefs.producerCredit; },
    refresh: () => update(),
    local: <T,>(init: () => T) => (local ??= init()) as T,
    get o() { return o; },
    call: <T,>(op: string, payload: unknown) => opsRpc.call<T>(op, payload, { ...o }),
    input: toIn,
  };

  // ---- skeleton ----
  const h1 = h("h1", { text: tool.heading ?? tool.title, attrs: { tabindex: -1, "data-testid": "view-heading" } });
  setFilesHandler((list) => {
    if (tool.accepts === "pdf") {
      // One PDF at a time: a new one replaces the current one, with an undo.
      const pick = list.find(isPdfFile);
      const olds = ofKind();
      if (!pick || !olds.length) return void store.add(list);
      const snapshot = store.files.slice();
      olds.forEach((f) => store.remove(f.id));
      void store.add([pick]).then((added) => toast(`Replaced ${olds.at(-1)!.name}.`, { label: "Undo", run: () => { added.forEach((f) => store.remove(f.id)); store.restore(snapshot); } }));
      return;
    }
    void store.add(list, kind).then(() => {
      if (tool.accepts !== "pdf-pair" || ofKind().length <= 2) return;
      store.notice = "Pagehold compares two PDFs at a time. Kept the two newest.";
      ofKind().slice(0, -2).forEach((f) => store.remove(f.id));
    });
  });
  const dz = dropzone({ title: tool.dropTitle ?? DROP_TITLE[tool.accepts], accept: ACCEPT[kind === "image" ? "images" : "pdf"] });
  const soon = h("p", { class: "hs-banner hs-banner--info", text: "Coming soon. This tool is not built yet, so nothing here will run.", hidden: !!tool.run, attrs: { "data-testid": "coming-soon" } });
  const notice = h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "notice" }, hidden: true });
  const fl = fileList({
    reorder: multi,
    visible: () => (tool.accepts === "pdf" ? store.files.filter((f) => f.kind === "pdf").slice(-1) : ofKind()),
    label: tool.accepts === "pdf-pair" ? (_f, i) => (i === 0 ? "Original" : "Changed") : undefined,
  });
  const tip = h("p", { class: "tip", hidden: multi }, "Want to combine files? ", h("a", { href: "#/merge", text: "Use Merge", attrs: { "data-testid": "tip-merge" } }));
  const warnBox = h("div", { class: "warns", attrs: { "data-testid": "warnings" } });
  const optSet = h("fieldset", { class: "opts__set" });
  const optBox = h("section", { class: "opts hs-card", hidden: !tool.options, attrs: { "aria-label": "Options" } }, optSet);
  const gridBox = h("section", { class: "gridbox", attrs: { "aria-label": "Pages" } });
  const resultBox = h("section", { class: "results hs-card", hidden: true, attrs: { "data-testid": "results", "aria-labelledby": "res-h" } });
  const status = h("p", { class: "job__status", attrs: { role: "status" } });
  const prog = h("progress", { class: "hs-progress", attrs: { max: 100, value: 0, "aria-label": "Progress" }, hidden: true });
  const primary = h("button", { class: "hs-btn", type: "button", attrs: { "data-testid": "primary-action" } });
  const cancel = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Cancel", hidden: true, attrs: { "data-testid": "cancel-job" } });
  const clearAll = h("button", { class: "hs-btn hs-btn--ghost", type: "button", text: "Clear all", attrs: { "data-testid": "clear-all" } });
  const bar = h("div", { class: "actionbar" }, h("div", { class: "actionbar__in" }, prog, status, h("div", { class: "actionbar__btns" }, primary, cancel, clearAll)));

  // output settings
  const credit = h("input", { class: "hs-check", id: "credit", type: "checkbox", attrs: { "data-testid": "producer-credit" } });
  credit.checked = prefs.producerCredit;
  credit.addEventListener("change", () => { prefs.producerCredit = credit.checked; });
  const settings = h("details", { class: "settings" },
    h("summary", { text: "Output settings" }),
    h("div", { class: "settings__row" }, credit, h("label", { attrs: { for: "credit" }, text: "Mention Pagehold in the file's details (Producer)" })));

  const grid = gridOpts ? pageGrid({
    items: () => ctx.items, set: (p) => { ctx.items = p; }, selectable: !!gridOpts.selectable, showFile: !!gridOpts.showFile,
    onChange: () => { ctx.dirty = true; results = []; tool.onItems?.(ctx); update(false); },
  }) : null;
  if (grid) gridBox.append(grid.el);
  if (tool.options) optSet.append(tool.options(ctx));

  // ---- logic ----
  function syncItems() {
    if (!grid) return;
    const files = ready();
    const key = files.map((f) => `${f.id}:${f.info?.pageCount}`).join("|");
    if (key === itemsKey) return;
    itemsKey = key;
    ctx.dirty = false;
    ctx.items = files.flatMap((f) => Array.from({ length: f.info!.pageCount }, (_, i) => newItem(f, i + 1)));
    results = [];
    grid.sync();
    tool.onItems?.(ctx);
  }

  function update(full = true) {
    const busy = store.busy;
    if (full) fl.render();
    notice.hidden = !store.notice;
    notice.textContent = store.notice;
    syncItems();
    warnBox.replaceChildren(...(tool.warnings?.(ctx) ?? []).map((t) => h("p", { class: "hs-banner hs-banner--warn", text: t, attrs: { role: "note" } })));
    tool.sync?.(ctx);
    gridBox.hidden = !grid || !ctx.pagesOpen || ctx.items.length === 0;
    primaryEnabled = !!tool.run && (tool.ready ? tool.ready(ctx) : tool.accepts === "pdf-pair" ? ctx.files.length === 2 : ctx.files.length > 0);
    primary.textContent = tool.run ? (tool.primaryLabel?.(ctx) ?? tool.title) : "Coming soon";
    primary.disabled = !primaryEnabled || busy;
    cancel.hidden = !busy;
    clearAll.disabled = busy;
    prog.hidden = !busy;
    status.textContent = busy ? jobNote : status.textContent;
    optSet.disabled = busy;
    credit.disabled = busy;
    dz.toggleAttribute("inert", busy);
    dz.classList.toggle("dz--compact", store.files.length > 0);
    resultBox.hidden = results.length === 0;
  }

  async function run() {
    if (!tool.run || !primaryEnabled || store.busy) return;
    results = [];
    resultBox.hidden = true;
    status.textContent = "";
    abort = new AbortController();
    o = { signal: abort.signal, onProgress: (d, t) => { prog.max = t; prog.value = d; jobNote = `Working… ${d} of ${t}`; status.textContent = jobNote; } };
    jobNote = "Working…";
    prog.removeAttribute("value");
    store.setBusy(true);
    try {
      results = await tool.run(ctx);
      status.textContent = "";
      announce(`Done. ${results.length === 1 ? "1 file" : `${results.length} files`} ready to download.`);
    } catch (e) {
      const cancelled = e instanceof PdfError && e.code === "cancelled";
      const inline = e instanceof PdfError && !cancelled && !!tool.onError?.(ctx, e);
      status.textContent = inline ? "" : cancelled ? "Cancelled. Nothing was changed." : errorMessage(e);
      status.setAttribute("role", cancelled ? "status" : "alert");
      results = [];
    } finally {
      abort = null;
      o = {};
      store.setBusy(false);
      renderResults();
      update();
      if (results.length) resultBox.querySelector<HTMLElement>("h2")?.focus();
    }
  }

  function renderResults() {
    resultBox.replaceChildren();
    if (!results.length) return;
    const warns = results.flatMap((r) => r.warnings);
    const zipName = `${stem(ctx.file?.name ?? "pagehold")}-${tool.id}.zip`;
    resultBox.append(
      h("h2", { id: "res-h", text: results.length > 1 ? `Done. ${results.length} files are ready.` : "Done. Your file is ready.", attrs: { tabindex: -1 } }),
      h("ul", { class: "outs", attrs: { role: "list" } }, ...results.map((r) =>
        h("li", { class: "out", attrs: { "data-testid": "result-row" } },
          h("span", { class: "out__name", text: r.name }),
          h("span", { class: "out__size", text: fmtSize(r.bytes.length) }),
          h("button", { class: "hs-btn", type: "button", text: "Download", attrs: { "aria-label": `Download ${r.name}`, "data-testid": "result-download" }, on: { click: () => void saveResult(r) } })))),
      ...(results.length > 1 ? [h("div", { class: "outs__all" }, h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Download all (.zip)", attrs: { "data-testid": "download-zip" }, on: { click: () => void saveZip(results, zipName) } }))] : []),
      ...warns.map((w) => h("p", { class: "hs-banner hs-banner--warn", text: w.message, attrs: { role: "note" } })));
  }

  primary.addEventListener("click", () => void run());
  cancel.addEventListener("click", () => abort?.abort());
  clearAll.addEventListener("click", () => { store.clear(); results = []; status.textContent = ""; itemsKey = ""; ctx.items = []; grid?.sync(); update(); });
  const unsub = store.subscribe(() => update());

  const el = h("div", { class: "view tool" },
    h("header", { class: "view__head" }, h1, h("p", { class: "view__lede", text: tool.lede })),
    dz, soon, notice, fl.el, tip, warnBox, optBox, gridBox, settings, resultBox, bar);
  update();
  return { el, destroy: () => { unsub(); grid?.destroy(); abort?.abort(); } };
}
