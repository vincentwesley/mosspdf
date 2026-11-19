// Shared workspace for Merge, Split, Organize and Extract: files, warnings, options, page grid, job, results.
import { prefs, store, errorMessage, ops, type LoadedFile } from "../core/store";
import type { CallOptions } from "../core/rpc";
import { parseRanges } from "../ops";
import { PdfError, type OpResult, type PageSpec, type SplitMode } from "../ops/types";
import { announce, fmtSize, h, plural } from "./dom";
import { dropzone, setFilesHandler } from "./dropzone";
import { fileList } from "./filelist";
import { newItem, pageGrid, type PageItem } from "./pagegrid";
import { saveResult } from "./download";
import { toolById } from "./catalog";

type Mode = "ranges" | "every" | "size";
const base = (f: LoadedFile) => f.name.replace(/\.pdf$/i, "");
const compress = (nums: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return out.join(", ");
};
const spans = (g: number[]) => compress(g);

export function toolView(id: string): { el: HTMLElement; destroy: () => void } {
  const info = toolById(id)!;
  const multi = id === "merge";
  const hasGrid = id === "organize" || id === "extract" || id === "merge";

  // ---- state ----
  let activeId: number | undefined;
  let items: PageItem[] = [];
  let itemsKey = "";
  let dirty = false;
  let pagesOpen = id !== "merge";
  let mode: Mode = "ranges";
  let results: OpResult[] = [];
  let abort: AbortController | null = null;
  let jobNote = "";
  const active = (): LoadedFile | undefined => {
    const r = store.ready();
    return r.find((f) => f.id === activeId) ?? r[0];
  };

  // ---- skeleton ----
  const title = { merge: "Merge PDFs", split: "Split a PDF", organize: "Organize pages", extract: "Extract pages" }[id] ?? info.title;
  const lede = {
    merge: "Put your PDFs in the order you want, then combine them into one file.",
    split: "Cut one PDF into several smaller files.",
    organize: "Reorder, rotate or delete pages, then save a new PDF.",
    extract: "Pick the pages you want to keep. Your original is never changed.",
  }[id] ?? "";
  const h1 = h("h1", { text: title, attrs: { tabindex: -1, "data-testid": "view-heading" } });
  setFilesHandler((f) => { void store.add(f); });
  const dz = dropzone({ title: multi ? "Drop PDFs to merge" : "Drop a PDF here" });
  const notice = h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "notice" }, hidden: true });
  const fl = fileList({ reorder: multi, activeId: multi ? undefined : () => active()?.id, onPick: multi ? undefined : (i) => { activeId = i; update(); } });
  const warnBox = h("div", { class: "warns", attrs: { "data-testid": "warnings" } });
  const optBox = h("section", { class: "opts hs-card", attrs: { "aria-label": "Options" } });
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

  // ---- tool-specific option widgets ----
  const rangeInput = h("input", { class: "hs-input", id: "ranges", type: "text", attrs: { inputmode: "text", autocomplete: "off", spellcheck: "false", placeholder: "1-3, 5, 8-", "data-testid": "range-input", "aria-describedby": "range-msg" } });
  const rangeMsg = h("p", { class: "field__msg", id: "range-msg", attrs: { role: "status", "data-testid": "range-msg" } });
  const everyInput = h("input", { class: "hs-input", id: "every", type: "number", attrs: { min: 1, value: 2, inputmode: "numeric", "data-testid": "every-input" } });
  const sizeInput = h("input", { class: "hs-input", id: "size", type: "number", attrs: { min: 0.1, step: 0.1, value: 5, inputmode: "decimal", "data-testid": "size-input" } });
  const preview = h("ol", { class: "parts", attrs: { "data-testid": "split-preview", "aria-label": "Files you will get" } });
  const modeBox = h("fieldset", { class: "modes" }, h("legend", { text: "How to split" }));
  for (const [m, label] of [["ranges", "By page ranges"], ["every", "Every N pages"], ["size", "By file size"]] as [Mode, string][]) {
    const r = h("input", { type: "radio", id: `m-${m}`, class: "hs-check hs-check--radio", attrs: { name: "mode", value: m, "data-testid": `mode-${m}` } });
    r.checked = m === mode;
    r.addEventListener("change", () => { mode = m; update(); });
    modeBox.append(h("div", { class: "modes__opt" }, r, h("label", { attrs: { for: `m-${m}` }, text: label })));
  }
  for (const i of [rangeInput, everyInput, sizeInput]) i.addEventListener("input", () => update());

  const field = (label: string, input: HTMLElement, forId: string, extra?: HTMLElement) =>
    h("div", { class: "field" }, h("label", { text: label, attrs: { for: forId } }), input, extra);
  const splitBox = h("div", { class: "split" });
  if (id === "split") splitBox.append(modeBox,
    field("Page ranges. Each range becomes its own file.", rangeInput, "ranges", rangeMsg),
    field("Pages per file", everyInput, "every"),
    field("Largest file size (MB)", sizeInput, "size"), preview);
  const extractBox = h("div", { class: "split" });
  if (id === "extract") extractBox.append(field("Pages to extract, for example 1-3, 5", rangeInput, "ranges", rangeMsg));
  const mergeBar = h("div", { class: "mergebar" });
  const pagesToggle = h("button", { class: "hs-btn hs-btn--secondary", type: "button", attrs: { "aria-expanded": "false", "data-testid": "edit-pages" }, on: { click: () => { pagesOpen = !pagesOpen; update(); } } });
  mergeBar.append(pagesToggle);

  if (id === "split") optBox.append(splitBox);
  else if (id === "extract") optBox.append(extractBox);
  else if (id === "merge") optBox.append(h("p", { class: "opts__hint", text: "Use the arrows or drag the handle to put the files in order." }), mergeBar);
  else optBox.hidden = true;

  const grid = hasGrid ? pageGrid({
    items: () => items, set: (p) => { items = p; }, selectable: id === "extract", showFile: multi,
    onChange: () => { dirty = true; results = []; if (id === "extract") syncRangeText(); update(false); },
  }) : null;
  if (grid) gridBox.append(grid.el);

  // ---- logic ----
  function syncItems() {
    if (!hasGrid) return;
    const files = multi ? store.ready() : [active()].filter((f): f is LoadedFile => !!f);
    const key = files.map((f) => `${f.id}:${f.info?.pageCount}`).join("|");
    if (key === itemsKey) return;
    itemsKey = key;
    dirty = false;
    items = files.flatMap((f) => Array.from({ length: f.info!.pageCount }, (_, i) => newItem(f, i + 1)));
    results = [];
    grid!.sync();
    if (id === "extract") syncRangeText();
  }
  function syncRangeText() {
    const sel = items.map((p, i) => (p.selected ? i + 1 : 0)).filter(Boolean);
    rangeInput.value = compress(sel);
  }
  function pagesFromText(): number[] | null {
    const f = active();
    if (!f) return null;
    try {
      const nums = [...new Set(parseRanges(rangeInput.value, f.info!.pageCount).flat())].sort((a, b) => a - b);
      rangeMsg.textContent = `${plural(nums.length, "page")} selected.`;
      rangeInput.removeAttribute("aria-invalid");
      return nums;
    } catch (e) {
      rangeMsg.textContent = rangeInput.value.trim() ? (e as Error).message : "";
      if (rangeInput.value.trim()) rangeInput.setAttribute("aria-invalid", "true");
      return null;
    }
  }
  function splitMode(): { mode: SplitMode; parts: number[][] | null } | null {
    const f = active();
    if (!f?.info) return null;
    const n = f.info.pageCount;
    if (mode === "ranges") {
      try { const g = parseRanges(rangeInput.value, n); rangeMsg.textContent = ""; rangeInput.removeAttribute("aria-invalid"); return { mode: { kind: "ranges", ranges: g }, parts: g }; }
      catch (e) { rangeMsg.textContent = rangeInput.value.trim() ? (e as Error).message : "Type the pages for each file, for example 1-3, 5."; if (rangeInput.value.trim()) rangeInput.setAttribute("aria-invalid", "true"); return null; }
    }
    if (mode === "every") {
      const k = Math.floor(Number(everyInput.value));
      if (!(k >= 1)) return null;
      return { mode: { kind: "every", n: k }, parts: Array.from({ length: Math.ceil(n / k) }, (_, i) => Array.from({ length: Math.min(k, n - i * k) }, (_, j) => i * k + j + 1)) };
    }
    const mb = Number(sizeInput.value);
    return mb > 0 ? { mode: { kind: "size", maxBytes: Math.round(mb * 1024 * 1024) }, parts: null } : null;
  }

  function warnings(): string[] {
    const files = multi ? store.ready() : [active()].filter((f): f is LoadedFile => !!f);
    const w: string[] = [];
    for (const f of files) {
      const i = f.info!;
      if (i.hasSignatures) w.push(`"${f.name}" has a digital signature. The new file will not carry a valid signature.`);
      if (i.hasXfa) w.push(`"${f.name}" is an XFA form. Its dynamic form parts may not survive.`);
      if (i.hasOutline) w.push(`Bookmarks in "${f.name}" will not be kept.`);
      if (i.hasForms && !i.hasXfa) w.push(`Form fields in "${f.name}" may not stay fillable.`);
      if (i.repaired) w.push(`"${f.name}" had problems and was repaired before reading.`);
    }
    return w;
  }

  let primaryEnabled = false;
  function plan(): { label: string; ok: boolean } {
    const f = active();
    switch (id) {
      case "merge": { const n = store.ready().length; return { label: n >= 2 ? `Merge ${n} files` : "Merge files", ok: n >= 2 }; }
      case "organize": return { label: "Save PDF", ok: !!f && items.length > 0 };
      case "extract": { const n = items.filter((p) => p.selected).length; return { label: n ? `Extract ${plural(n, "page")}` : "Extract pages", ok: n > 0 }; }
      default: { const s = splitMode(); const n = s?.parts?.length; return { label: n ? `Split into ${plural(n, "file")}` : "Split", ok: !!f && !!s }; }
    }
  }

  function update(full = true) {
    const busy = store.busy;
    if (full) fl.render();
    notice.hidden = !store.notice;
    notice.textContent = store.notice;
    syncItems();
    const w = warnings();
    warnBox.replaceChildren(...w.map((t) => h("p", { class: "hs-banner hs-banner--warn", text: t, attrs: { role: "note" } })));
    const f = active();
    if (id === "split") {
      splitBox.hidden = !f;
      rangeInput.closest(".field")!.toggleAttribute("hidden", mode !== "ranges");
      everyInput.closest(".field")!.toggleAttribute("hidden", mode !== "every");
      sizeInput.closest(".field")!.toggleAttribute("hidden", mode !== "size");
      const s = splitMode();
      preview.replaceChildren(...(s?.parts ?? []).map((g) => h("li", { text: `${spans(g)} (${plural(g.length, "page")})`, attrs: { "data-testid": "split-part" } })));
      if (mode === "size") preview.replaceChildren(h("li", { text: "Pagehold picks the page breaks so each file stays under this size." }));
    }
    if (id === "extract") {
      extractBox.hidden = !f;
      const nums = pagesFromText();
      if (nums && document.activeElement === rangeInput) { items.forEach((p, i) => (p.selected = nums.includes(i + 1))); grid?.sync(); }
    }
    if (id === "merge") {
      mergeBar.hidden = store.ready().length < 2;
      pagesToggle.textContent = pagesOpen ? "Hide pages" : "Edit pages";
      pagesToggle.setAttribute("aria-expanded", String(pagesOpen));
    }
    gridBox.hidden = !hasGrid || !pagesOpen || items.length === 0;
    const p = plan();
    primaryEnabled = p.ok;
    primary.textContent = p.label;
    primary.disabled = !p.ok || busy;
    cancel.hidden = !busy;
    clearAll.disabled = busy;
    prog.hidden = !busy;
    status.textContent = busy ? jobNote : status.textContent;
    for (const el of [rangeInput, everyInput, sizeInput, credit]) el.disabled = busy;
    dz.toggleAttribute("inert", busy);
    dz.classList.toggle("dz--compact", store.files.length > 0);
    resultBox.hidden = results.length === 0;
  }

  async function run() {
    if (!primaryEnabled || store.busy) return;
    results = [];
    resultBox.hidden = true;
    status.textContent = "";
    abort = new AbortController();
    const o: CallOptions = { signal: abort.signal, onProgress: (d, t) => { prog.max = t; prog.value = d; jobNote = `Working… ${d} of ${t}`; status.textContent = jobNote; } };
    jobNote = "Working…";
    prog.removeAttribute("value");
    store.setBusy(true);
    try {
      const f = active();
      if (id === "merge" && !(pagesOpen && dirty)) results = [await ops.merge(store.ready(), o)];
      else if (id === "split") results = await ops.split(f!, splitMode()!.mode, o);
      else {
        const files = id === "merge" ? store.ready() : [f!];
        const chosen = id === "extract" ? items.filter((p) => p.selected) : items;
        const specs: PageSpec[] = chosen.map((p) => ({ source: files.indexOf(p.file), page: p.page, rotate: p.rotate as PageSpec["rotate"] }));
        const name = id === "merge" ? "merged.pdf" : `${base(f!)}-${id === "extract" ? "extract" : "organized"}.pdf`;
        results = [await ops.assemble(files, specs, name, o)];
      }
      status.textContent = "";
      announce(`Done. ${plural(results.length, "file")} ready to download.`);
    } catch (e) {
      const cancelled = e instanceof PdfError && e.code === "cancelled";
      status.textContent = cancelled ? "Cancelled. Nothing was changed." : errorMessage(e);
      status.setAttribute("role", cancelled ? "status" : "alert");
      results = [];
    } finally {
      abort = null;
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
    resultBox.append(
      h("h2", { id: "res-h", text: results.length > 1 ? `Done. ${results.length} files are ready.` : "Done. Your file is ready.", attrs: { tabindex: -1 } }),
      h("ul", { class: "outs", attrs: { role: "list" } }, ...results.map((r) =>
        h("li", { class: "out", attrs: { "data-testid": "result-row" } },
          h("span", { class: "out__name", text: r.name }),
          h("span", { class: "out__size", text: fmtSize(r.bytes.length) }),
          h("button", { class: "hs-btn", type: "button", text: "Download", attrs: { "aria-label": `Download ${r.name}`, "data-testid": "result-download" }, on: { click: () => void saveResult(r) } })))),
      ...warns.map((w) => h("p", { class: "hs-banner hs-banner--warn", text: w.message, attrs: { role: "note" } })));
  }

  primary.addEventListener("click", () => void run());
  cancel.addEventListener("click", () => abort?.abort());
  clearAll.addEventListener("click", () => { store.clear(); results = []; status.textContent = ""; itemsKey = ""; items = []; grid?.sync(); update(); });
  const unsub = store.subscribe(() => update());

  const el = h("div", { class: "view tool" },
    h("header", { class: "view__head" }, h1, h("p", { class: "view__lede", text: lede })),
    dz, notice, fl.el, warnBox, optBox, gridBox, settings, resultBox, bar);
  update();
  return { el, destroy: () => { unsub(); grid?.destroy(); abort?.abort(); } };
}
