// Shared workspace for every tool: heading, dropzone, file list, warnings, options, page grid, output settings,
// action bar (progress, cancel, status), results and downloads, and the job runner. A tool module only supplies a ToolDef.
import { prefs, store, errorMessage, toIn, isPdfFile, type LoadedFile } from "../core/store";
import { opsRpc } from "../core/engines";
import type { CallOptions } from "../core/rpc";
import { PdfError, type OpResult } from "../ops/types";
import type { Ctx, GridOpts, ToolDef } from "../tools/types";
import { nextTools } from "../tools";
import { pushRecent } from "../core/recent";
import { memoryWarning } from "../core/memguard";
import { announce, fmtSize, h } from "./dom";
import { toast } from "./toast";
import { dropzone, setFilesHandler } from "./dropzone";
import { fileList } from "./filelist";
import { openDoc, renderThumb } from "../core/render";
import { newItem, pageGrid } from "./pagegrid";
import { saveResult, saveZip } from "./download";
import { toolBox } from "./toolicons";

const DROP_TITLE = { pdf: "Drop a PDF here", pdfs: "Drop PDFs here", images: "Drop images here", "pdf-pair": "Drop the two PDFs here" } as const;
const CHOOSE = { pdf: "Choose a PDF", pdfs: "Choose PDF files", images: "Choose images", "pdf-pair": "Choose two PDFs" } as const;
const ACCEPT = {
  pdf: ".pdf,application/pdf",
  images: "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif",
} as const;
const TAKES = { pdf: "Takes a PDF.", pdfs: "Takes two or more PDFs.", images: "Takes JPG, PNG or WebP pictures.", "pdf-pair": "Takes two PDFs: the original and the changed one." } as const;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** Tool title last opened, and whether the next open follows a "Use in another tool" hand-off (then carried files are expected). */
let lastTool = "";
let handoff = false;

export function workspace(tool: ToolDef): { el: HTMLElement; destroy: () => void } {
  const prevTool = lastTool;
  lastTool = tool.title;
  const carried = handoff || prevTool === tool.title ? "" : store.files.map((f) => f.id).join();
  handoff = false;
  const kind: LoadedFile["kind"] = tool.accepts === "images" ? "image" : "pdf";
  const multi = tool.accepts !== "pdf";
  /** One PDF at a time (new replaces old) unless the tool is a batch tool. */
  const single = tool.accepts === "pdf" && !tool.batch;
  const gridOpts: GridOpts | null = tool.grid ? { open: true, ...(tool.grid === true ? {} : tool.grid) } : null;

  // ---- state ----
  let itemsKey = "";
  let results: OpResult[] = [];
  let abort: AbortController | null = null;
  let jobNote = "";
  let inBytes = 0;
  let primaryEnabled = false;
  let o: CallOptions = {};
  let local: unknown;
  let batchFile: LoadedFile | undefined;
  let batchNote = "";
  const ofKind = () => store.files.filter((f) => f.kind === kind);
  /** Single-PDF tools work on the newest file; the others on all of their kind. */
  const mine = () => (single ? ofKind().slice(-1) : ofKind());
  const ready = () => mine().filter((f) => f.status === "ready");

  const ctx: Ctx = {
    tool,
    get files() { return batchFile ? [batchFile] : ready(); },
    get file() { return batchFile ?? ready()[0]; },
    items: [],
    dirty: false,
    pagesOpen: gridOpts?.open ?? true,
    setPagesOpen(open) { ctx.pagesOpen = open; update(); },
    syncGrid() { grid?.sync(); },
    get producerCredit() { return prefs.producerCredit; },
    refresh: () => update(),
    local: <T,>(init: () => T) => (local ??= init()) as T,
    get o() { return o; },
    note(text) { jobNote = text; status.textContent = text; },
    call: <T,>(op: string, payload: unknown) => opsRpc.call<T>(op, payload, { ...o }),
    input: toIn,
  };

  // ---- skeleton ----
  const h1 = h("h1", { text: tool.heading ?? tool.title, attrs: { tabindex: -1, "data-testid": "view-heading" } });
  setFilesHandler((list) => {
    if (single) {
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
      store.notice = "MossPDF compares two PDFs at a time. Kept the two newest.";
      ofKind().slice(0, -2).forEach((f) => store.remove(f.id));
    });
  });
  const dz = dropzone({ title: tool.dropTitle ?? DROP_TITLE[tool.accepts], accept: ACCEPT[kind === "image" ? "images" : "pdf"], label: CHOOSE[tool.accepts], hint: `${TAKES[tool.accepts]} They stay on this device.` });
  const soon = h("p", { class: "hs-banner hs-banner--info", text: "Coming soon. This tool is not built yet, so nothing here will run.", hidden: !!tool.run, attrs: { "data-testid": "coming-soon" } });
  const notice = h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "notice" }, hidden: true });
  const fl = fileList({
    reorder: multi,
    visible: () => (single ? ofKind().slice(-1) : ofKind()),
    label: tool.accepts === "pdf-pair" ? (_f, i) => (i === 0 ? "Original" : "Changed") : undefined,
  });
  const carryTxt = h("span", { attrs: { "data-testid": "carry-text" } });
  const carryBox = h("p", { class: "hs-banner hs-banner--info", hidden: true, attrs: { role: "status", "data-testid": "carry-over" } }, carryTxt,
    h("button", { class: "hs-btn hs-btn--ghost", type: "button", text: "Clear", attrs: { "data-testid": "carry-clear" }, on: { click: () => startOver() } }));
  const tip = h("p", { class: "tip", hidden: multi }, "Want to combine files? ", h("a", { href: "#/merge", text: "Use Merge", attrs: { "data-testid": "tip-merge" } }));
  const warnBox = h("div", { class: "warns", attrs: { "data-testid": "warnings" } });
  const optSet = h("fieldset", { class: "opts__set" });
  const optBox = h("section", { class: "opts hs-card", hidden: !tool.options, attrs: { "aria-label": "Options" } }, optSet);
  const gridBox = h("section", { class: "gridbox", attrs: { "aria-label": "Pages" } });
  const resultBox = h("section", { class: "results hs-card", hidden: true, attrs: { "data-testid": "results", "aria-labelledby": "res-h" } });
  // One stable status region for progress and done; failures go to the separate alert so the status element never changes role.
  const status = h("p", { class: "job__status", attrs: { role: "status" } });
  const errBox = h("p", { class: "job__status job__status--err", attrs: { role: "alert", "data-testid": "job-error" } });
  const prog = h("progress", { class: "hs-progress", attrs: { max: 100, value: 0, "aria-label": "Progress" }, hidden: true });
  const why = h("p", { class: "tip", id: "primary-why", hidden: true, attrs: { "data-testid": "primary-why" } });
  const primary = h("button", { class: "hs-btn", type: "button", attrs: { "data-testid": "primary-action" } });
  const cancel = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Cancel", hidden: true, attrs: { "data-testid": "cancel-job" } });
  const clearAll = h("button", { class: "hs-btn hs-btn--ghost", type: "button", text: "Clear all", attrs: { "data-testid": "clear-all" } });
  // Memory guard: a plain warning before a big job, never a block.
  const memText = h("span", { attrs: { "data-testid": "mem-warning-text" } });
  const memOk = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Try anyway", attrs: { "data-testid": "mem-try-anyway" } });
  const memBox = h("p", { class: "hs-banner hs-banner--warn", hidden: true, attrs: { role: "alert", "data-testid": "mem-warning" } }, memText, " ", memOk);
  let memKey = ""; // the files the owner already said "try anyway" for
  const bar = h("div", { class: "actionbar" }, h("div", { class: "actionbar__in" }, memBox, prog, status, errBox, why, h("div", { class: "actionbar__btns" }, primary, cancel, clearAll)));

  // output settings
  const credit = h("input", { class: "hs-check", id: "credit", type: "checkbox", attrs: { "data-testid": "producer-credit" } });
  credit.checked = prefs.producerCredit;
  credit.addEventListener("change", () => { prefs.producerCredit = credit.checked; });
  const settings = h("details", { class: "settings" },
    h("summary", { text: "More settings" }),
    h("div", { class: "settings__row" }, credit, h("label", { attrs: { for: "credit" }, text: "Mention MossPDF in the file's details (Producer)" })));

  const kbd = h("details", { class: "kbd", attrs: { "data-testid": "kbd-help" } },
    h("summary", { text: "Keyboard shortcuts" }),
    h("ul", {}, ...[
      "Tab moves between pages.",
      "Alt plus an arrow key moves the focused page.",
      "Delete removes the focused page.",
      ...(gridOpts?.selectable ? ["Enter or Space selects or unselects the focused page."] : []),
    ].map((t) => h("li", { text: t }))));
  const grid = gridOpts ? pageGrid({
    items: () => ctx.items, set: (p) => { ctx.items = p; }, selectable: !!gridOpts.selectable, showFile: !!gridOpts.showFile,
    onChange: () => { ctx.dirty = true; results = []; tool.onItems?.(ctx); update(false); },
  }) : null;
  if (grid) gridBox.append(grid.el, kbd);
  if (tool.run) pushRecent(tool.id);
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
    memBox.hidden = true;
    notice.hidden = !store.notice;
    notice.textContent = store.notice;
    syncItems();
    warnBox.replaceChildren(...(tool.warnings?.(ctx) ?? []).map((t) => h("p", { class: "hs-banner hs-banner--warn", text: t, attrs: { role: "note" } })));
    tool.sync?.(ctx);
    gridBox.hidden = !grid || !ctx.pagesOpen || ctx.items.length === 0;
    primaryEnabled = !!tool.run && (tool.ready ? tool.ready(ctx) : tool.accepts === "pdf-pair" ? ctx.files.length === 2 : ctx.files.length > 0);
    primary.textContent = tool.run ? (tool.primaryLabel?.(ctx) ?? tool.title) + (tool.batch && ctx.files.length > 1 ? ` (${ctx.files.length} files)` : "") : "Coming soon";
    primary.disabled = !primaryEnabled || busy;
    why.textContent = primaryEnabled || busy ? "" : (tool.whyDisabled?.(ctx) ?? "");
    why.hidden = !why.textContent;
    if (why.hidden) primary.removeAttribute("aria-describedby"); else primary.setAttribute("aria-describedby", "primary-why");
    // Files from another tool stay flagged until the user adds or removes any (the hand-off button is the intended carry-over).
    const n = ofKind().length;
    const stillCarried = !!carried && n > 0 && store.files.map((f) => f.id).join() === carried;
    carryBox.hidden = !stillCarried;
    if (stillCarried) carryTxt.textContent = `${n === 1 ? "1 file" : `${n} files`} carried over from ${prevTool}. `;
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
    const key = ctx.files.map((f) => f.id).join();
    const mem = memoryWarning(tool.id, ctx.files.reduce((n, f) => n + f.size, 0));
    memBox.hidden = !mem || memKey === key;
    if (!memBox.hidden) { memText.textContent = mem; memOk.focus(); return; }
    results = [];
    resultBox.hidden = true;
    status.textContent = "";
    errBox.textContent = "";
    inBytes = ctx.files.reduce((n, f) => n + f.size, 0);
    abort = new AbortController();
    o = { signal: abort.signal, onProgress: (d, t) => { prog.max = t; prog.value = d; jobNote = `${batchNote}Working… ${d} of ${t}`; status.textContent = jobNote; } };
    jobNote = inBytes > 50 * 1024 * 1024 ? "Working… Large files can take a minute or more." : "Working…";
    prog.removeAttribute("value");
    store.setBusy(true);
    try {
      if (tool.batch && ctx.files.length > 1) {
        // Batch: the same options on every file in turn; ctx.file is the current one while its run is going.
        const list = ctx.files;
        for (const [i, f] of list.entries()) {
          if (o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
          batchFile = f;
          batchNote = `File ${i + 1} of ${list.length}. `;
          jobNote = `${batchNote}Working…`;
          status.textContent = jobNote;
          prog.removeAttribute("value");
          try { results.push(...await tool.run(ctx)); } finally { batchFile = undefined; }
        }
      } else results = await tool.run(ctx);
      status.textContent = "";
      announce(`Done. ${results.length === 1 ? "1 file" : `${results.length} files`} ready to download.`);
    } catch (e) {
      const cancelled = e instanceof PdfError && e.code === "cancelled";
      const inline = e instanceof PdfError && !cancelled && !!tool.onError?.(ctx, e);
      status.textContent = cancelled ? "Cancelled. Nothing was changed." : "";
      errBox.textContent = inline || cancelled ? "" : errorMessage(e);
      results = [];
    } finally {
      abort = null;
      o = {};
      batchNote = "";
      store.setBusy(false);
      renderResults();
      update();
      if (results.length) resultBox.querySelector<HTMLElement>("h2")?.focus();
    }
  }

  let dropThumb = () => {};
  /** Small local preview of the first output: page 1 of a single PDF, or the first picture. Null for zip/txt. No object URLs: the CSP has no img-src blob:. */
  function thumb(): HTMLElement | null {
    const r = results[0];
    const img = /\.(png|jpe?g)$/i.test(r.name);
    if (!img && !(results.length === 1 && /\.pdf$/i.test(r.name))) return null;
    const alt = img ? `Preview of ${r.name}` : "Preview of page 1";
    const canvas = h("canvas", { class: "out__thumb", attrs: { role: "img", "aria-label": alt, "data-testid": "result-thumb" } });
    let dead = false, cancel = () => {}, doc: Awaited<ReturnType<typeof openDoc>> | undefined;
    dropThumb = () => { dead = true; cancel(); void doc?.loadingTask.destroy(); };
    if (img) { // decoded to a canvas, not a blob: URL, so the page CSP needs no img-src blob:
      createImageBitmap(new Blob([r.bytes as BlobPart])).then((b) => {
        if (dead) return b.close();
        canvas.width = 72 * 2; canvas.height = Math.round((b.height / b.width) * canvas.width);
        canvas.getContext("2d")?.drawImage(b, 0, 0, canvas.width, canvas.height);
        b.close();
      }).catch(() => canvas.remove());
      return canvas;
    }
    openDoc(r.bytes).then((d) => { doc = d; if (dead) return void d.loadingTask.destroy(); const t = renderThumb(d, 1, 0, canvas, 72); cancel = t.cancel; return t.done; }).catch(() => canvas.remove());
    return canvas;
  }

  function renderResults() {
    dropThumb(); dropThumb = () => {};
    resultBox.replaceChildren();
    if (!results.length) return;
    const warns = results.flatMap((r) => r.warnings);
    const outBytes = results.reduce((n, r) => n + r.bytes.length, 0);
    const delta = inBytes ? Math.round(((inBytes - outBytes) / inBytes) * 100) : 0;
    // Only a saving is news; most tools add a little (fonts, a text layer), and "67% larger" on a 2 KB file reads like a fault.
    const change = delta > 0 ? `Saved ${delta}%.` : "";
    const single = results.length === 1 && /\.pdf$/i.test(results[0].name);
    const next = single ? nextTools(tool) : [];
    const zipName = `${stem(ctx.file?.name ?? "mosspdf")}-${tool.zipSuffix ?? tool.id}.zip`;
    resultBox.append(
      h("h2", { id: "res-h", text: results.length > 1 ? `Done. ${results.length} files are ready.` : "Done. Your file is ready.", attrs: { tabindex: -1 } }),
      ...(tool.summary ? [h("p", { class: "res__sum", text: tool.summary(ctx), attrs: { "data-testid": "result-summary" } })] : inBytes ? [h("p", { class: "res__sum", text: `${fmtSize(inBytes)} → ${fmtSize(outBytes)}. ${change}`.trim(), attrs: { "data-testid": "result-summary" } })] : []),
      h("ul", { class: "outs", attrs: { role: "list" } }, ...results.map((r) =>
        h("li", { class: "out", attrs: { "data-testid": "result-row" } },
          ...(r === results[0] ? [thumb()] : []),
          h("span", { class: "out__name", text: r.name }),
          h("span", { class: "out__size", text: fmtSize(r.bytes.length) }),
          h("button", { class: "hs-btn out__dl", type: "button", text: "Download", attrs: { "aria-label": `Download ${r.name}`, "data-testid": "result-download" }, on: { click: () => void saveResult(r) } })))),
      ...(results.length > 1 ? [h("div", { class: "outs__all" }, h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Download all (.zip)", attrs: { "data-testid": "download-zip" }, on: { click: () => void saveZip(results, zipName) } }))] : []),
      ...warns.map((w) => h("p", { class: "hs-banner hs-banner--warn", text: w.message, attrs: { role: "note" } })),
      h("div", { class: "res__next" },
        ...(next.length ? [h("h3", { id: "next-h", text: "Continue with" }), h("ul", { class: "res__tools", attrs: { role: "list", "aria-labelledby": "next-h" } }, ...next.map((t) =>
          h("li", {}, h("button", { class: "hs-btn hs-btn--secondary", type: "button", attrs: { "data-testid": `next-${t.id}` }, on: { click: () => void useIn(results[0], t.id) } }, toolBox(t.id), t.title))))] : []),
        h("button", { class: "hs-btn hs-btn--ghost", type: "button", text: "Start over", attrs: { "data-testid": "start-over" }, on: { click: startOver } })));
  }

  /** Replaces the loaded files with a result and opens another tool on it. The store is global, so it survives the route change. */
  async function useIn(r: OpResult, id: string) {
    store.clear();
    handoff = true;
    await store.add([new File([r.bytes as BlobPart], r.name, { type: "application/pdf" })]);
    location.hash = `#/${id}`;
  }
  function startOver() {
    const snapshot = store.files.slice();
    store.clear(); results = []; status.textContent = ""; errBox.textContent = ""; itemsKey = ""; ctx.items = []; grid?.sync(); update();
    if (snapshot.length) toast(snapshot.length === 1 ? `Cleared ${snapshot[0].name}.` : `Cleared ${snapshot.length} files.`, { label: "Undo", run: () => store.restore(snapshot) });
  }
  primary.addEventListener("click", () => void run());
  memOk.addEventListener("click", () => { memKey = ctx.files.map((f) => f.id).join(); void run(); });
  cancel.addEventListener("click", () => abort?.abort());
  clearAll.addEventListener("click", startOver);
  const unsub = store.subscribe(() => update());

  const el = h("div", { class: "view tool" },
    h("header", { class: "view__head" }, toolBox(tool.id, true), h1, h("p", { class: "view__lede", text: tool.lede }), ...(tool.how ? [h("p", { class: "view__how", text: tool.how, attrs: { "data-testid": "tool-how" } })] : [])),
    dz, soon, notice, carryBox, fl.el, tip, warnBox, optBox, gridBox, settings, resultBox, bar);
  update();
  return { el, destroy: () => { dropThumb(); unsub(); grid?.destroy(); abort?.abort(); tool.destroy?.(ctx); } };
}
