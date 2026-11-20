// Redact (M6, D17). The page text is read with pdf.js here; detectors (src/core/detect.ts) and a search box propose hits, the user reviews
// them and can draw more boxes. Apply renders each affected page with black boxes painted in, as a JPEG; the ops worker rebuilds those
// pages as pictures plus a hidden text layer of the words outside the boxes, strips the metadata and rewrites the file (src/ops/redact.ts).
import { store } from "../core/store";
import { ALL_DETECT, KIND_LABEL, detect, findText, mask, type Detect, type Kind } from "../core/detect";
import { layoutText, overlaps, rangeRects, type PageText, type Rect, type TextItem } from "../core/textpos";
import type { OcrWord } from "../engines/ocr";
import type { RedactInput, RedactPage } from "../ops";
import { PdfError, type OpResult } from "../ops/types";
import { announce, h, plural } from "../ui/dom";
import { checkField, numberField, textField } from "../ui/fields";
import { formInfo, SIGNED_WARNING } from "../ui/formstate";
import { drawBoxes, place, wireBox } from "../ui/boxlayer";
import { pageView, type Slot } from "../ui/pageview";
import type { Ctx, ToolDef } from "./types";

const DPI = 200;
const MAX_PIXELS = 12_000_000; // as OCR: keeps one page bitmap a few tens of MB
const DETECTORS: (keyof Detect)[] = ["nric", "phone", "email", "address", "postal"];
const ORDER: Kind[] = ["nric", "phone", "email", "address", "postal", "search", "manual"];

interface RHit {
  id: number;
  kind: Kind;
  page: number; // 0-based
  text: string;
  note?: string;
  rects: Rect[];
  checked: boolean;
}
let nextId = 1;

const ui = (ctx: Ctx) => ctx.local(() => {
  const s = {
    fileId: undefined as number | undefined,
    signed: false,
    scanning: false,
    pages: [] as PageText[],
    hits: [] as RHit[],
    on: { ...ALL_DETECT } as Detect,
    kinds: Object.fromEntries(DETECTORS.map((k) => [k, checkField({ id: `rd-kind-${k}`, label: KIND_LABEL[k], checked: true, testid: `rd-kind-${k}`, onChange: () => toggle(k) })])) as Record<keyof Detect, ReturnType<typeof checkField>>,
    q: textField({ id: "rd-q", label: "Words to find", testid: "rd-q", hint: "Matches any capitalisation." }),
    whole: checkField({ id: "rd-whole", label: "Whole words only", testid: "rd-whole" }),
    find: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Find", attrs: { "data-testid": "rd-find" } }),
    pageNo: numberField({ id: "rd-pageno", label: "Page number", value: 1, min: 1, step: 1, testid: "rd-pageno" }),
    add: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Add box", attrs: { "data-testid": "rd-add" } }),
    status: h("p", { class: "field__msg", attrs: { role: "status", "data-testid": "rd-status" } }),
    list: h("div", { class: "rd-list", attrs: { "data-testid": "rd-list" } }),
    hint: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "redact-hint" } }),
    pv: pageView({ onSlot: () => undefined }),
    root: h("div", { class: "sign rd" }),
  };
  const step = (n: number, title: string, ...kids: (HTMLElement | null)[]) => h("section", { class: "sg-step" }, h("h3", { text: `${n}. ${title}` }), ...kids.filter((k): k is HTMLElement => !!k));
  s.root.append(
    s.hint,
    h("div", { class: "sg-layout" },
      h("div", { class: "sg-side" },
        step(1, "What to look for",
          h("div", { class: "rd-kinds" }, ...DETECTORS.map((k) => s.kinds[k].el)),
          s.q.el, s.whole.el, s.find),
        step(2, "Or draw a box",
          h("p", { class: "sg-help", text: "Drag on a page to draw a box (mouse or pen). With the keyboard or on a phone, press Add box, then move it: arrow keys or drag; plus and minus resize it; Alt with the arrow keys makes it wider, narrower, taller or shorter; Delete removes it." }),
          h("div", { class: "sg-where" }, s.pageNo.el, s.add)),
        step(3, "Check what will be removed", s.status, s.list),
        h("p", { class: "hs-banner hs-banner--info", attrs: { role: "note", "data-testid": "rd-after" }, text: "Before you share the result, open it and search for a word you redacted to make sure it is gone. The pages you redact become pictures, so the rest of the page can look a little softer." })),
      s.pv.el));

  const active = () => s.hits.filter((x) => !DETECTORS.includes(x.kind as keyof Detect) || s.on[x.kind as keyof Detect]);
  const chosen = () => active().filter((x) => x.checked);
  function toggle(k: keyof Detect) { s.on[k] = s.kinds[k].input.checked; changed(); }
  function changed() { paintAll(); renderList(); ctx.refresh(); }

  // ---- boxes on the pages ----
  function paintAll() { s.pv.slots.forEach(paintSlot); }
  function paintSlot(slot: Slot) {
    slot.overlay.querySelectorAll(".rd-box").forEach((e) => e.remove());
    for (const x of active()) {
      if (x.page !== slot.index) continue;
      x.rects.forEach((r) => {
        const manual = x.kind === "manual";
        const el = h("div", { class: `rd-box${x.checked ? " rd-box--on" : ""}${manual ? " rd-box--manual" : ""}`, attrs: manual ? { tabindex: 0, role: "group", "aria-label": `Box on page ${x.page + 1}. Arrow keys move it, plus and minus resize it, Delete removes it.`, "data-testid": "rd-box" } : { "aria-hidden": "true", "data-testid": "rd-hitbox", "data-hit": x.id } });
        el.dataset.hit = String(x.id);
        place(el, r);
        if (manual) wireManual(el, x, slot);
        slot.overlay.append(el);
      });
    }
  }
  function wireManual(el: HTMLElement, x: RHit, slot: Slot) {
    wireBox(el, x.rects[0], slot.overlay, { onChange: () => undefined, onDelete: () => { s.hits.splice(s.hits.indexOf(x), 1); announce("Box removed."); s.add.focus(); changed(); } });
  }
  /** Drag on a page to draw a box (mouse or pen; touch uses Add box so that scrolling keeps working). */
  function begin(slot: Slot) { drawBoxes(slot.overlay, (r) => addManual(slot.index, r)); }
  function addManual(page: number, r: Rect) {
    s.hits.push({ id: nextId++, kind: "manual", page, text: "", rects: [r], checked: true });
    announce(`Box added on page ${page + 1}.`);
    const hit = s.hits[s.hits.length - 1];
    changed();
    return hit;
  }

  // ---- review list ----
  function renderList() {
    const act = active();
    const groups = ORDER.map((k) => [k, act.filter((x) => x.kind === k)] as const).filter(([, v]) => v.length);
    s.list.replaceChildren(...(groups.length ? groups.map(([k, v]) => {
      const set = (on: boolean) => { v.forEach((x) => (x.checked = on)); changed(); };
      return h("section", { class: "rd-group", attrs: { "aria-label": KIND_LABEL[k], "data-testid": `rd-group-${k}` } },
        h("div", { class: "rd-group__head" },
          h("h4", { text: `${KIND_LABEL[k]} (${v.length})` }),
          h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Select all", attrs: { "aria-label": `Select all of: ${KIND_LABEL[k]}`, "data-testid": `rd-all-${k}` }, on: { click: () => set(true) } }),
          h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Select none", attrs: { "aria-label": `Select none of: ${KIND_LABEL[k]}`, "data-testid": `rd-none-${k}` }, on: { click: () => set(false) } })),
        h("ul", { class: "sg-list", attrs: { role: "list" } }, ...v.map((x) => row(x))));
    }) : [h("p", { class: "sg-help", text: s.scanning ? "" : "Nothing found yet. Search for words, turn on more kinds above, or draw a box on a page." })]));
  }
  function row(x: RHit) {
    const id = `rd-row-${x.id}`;
    const box = h("input", { class: "hs-check", id, type: "checkbox", attrs: { "data-testid": "rd-row-check" } });
    box.checked = x.checked;
    box.addEventListener("change", () => { x.checked = box.checked; paintAll(); ctx.refresh(); });
    const label = x.kind === "manual" ? `Page ${x.page + 1}: box` : `Page ${x.page + 1}: ${x.kind === "search" ? x.text : mask(x.text)}`;
    return h("li", { class: "sg-row", attrs: { "data-testid": "rd-row" } },
      h("span", { class: "field field--check" }, box, h("label", { text: label, attrs: { for: id } })),
      x.note && h("span", { class: "rd-note", text: x.note }),
      h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Show", attrs: { "aria-label": `Show ${label} on the page`, "data-testid": "rd-show" }, on: { click: () => show(x) } }),
      x.kind === "manual" && h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Remove", attrs: { "aria-label": `Remove the box on page ${x.page + 1}` }, on: { click: () => { s.hits.splice(s.hits.indexOf(x), 1); changed(); } } }));
  }
  function show(x: RHit) {
    const slot = s.pv.slots[x.page];
    slot.wrap.scrollIntoView({ block: "center" });
    const el = slot.overlay.querySelector<HTMLElement>(`.rd-box[data-hit="${x.id}"]`);
    el?.classList.add("rd-box--flash");
    setTimeout(() => el?.classList.remove("rd-box--flash"), 1200);
    if (x.kind === "manual") el?.focus({ preventScroll: true });
  }

  // ---- reading the text ----
  async function scan(f: NonNullable<Ctx["file"]>) {
    s.scanning = true;
    s.status.textContent = "Reading the text on each page";
    const doc = await store.doc(f);
    const g = document.createElement("canvas").getContext("2d")!;
    const pages: PageText[] = [];
    const hits: RHit[] = [];
    try {
      for (let i = 0; i < f.info!.pageCount; i++) {
        if (s.fileId !== f.id) return;
        s.status.textContent = `Reading page ${i + 1} of ${f.info!.pageCount}`;
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const measure = (it: TextItem) => {
          if (it.str.length > 400) return undefined;
          g.font = `100px ${tc.styles[it.fontName ?? ""]?.fontFamily ?? "sans-serif"}`; // the font pdf.js names for this item; glyph widths differ, so measure
          return Array.from({ length: it.str.length + 1 }, (_, n) => g.measureText(it.str.slice(0, n)).width);
        };
        const pt = layoutText((tc.items as unknown as TextItem[]).filter((it) => "str" in it), vp.transform, vp.width, vp.height, measure);
        pages.push(pt);
        for (const d of detect(pt.text)) hits.push({ id: nextId++, kind: d.kind, page: i, text: d.text, note: d.note, rects: rangeRects(pt, d.start, d.end), checked: true });
        page.cleanup();
      }
    } finally {
      if (s.fileId === f.id) s.scanning = false;
    }
    if (s.fileId !== f.id) return;
    s.pages = pages;
    s.hits = hits;
    const none = !pages.some((p) => p.text.trim());
    s.status.textContent = none ? "No text was found on these pages. If this is a scan, run OCR first, or draw boxes by hand." : `Found ${plural(hits.length, "item")} to review. Nothing is removed until you save.`;
    announce(s.status.textContent);
    changed();
  }
  function search() {
    s.hits = s.hits.filter((x) => x.kind !== "search");
    for (const [i, pt] of s.pages.entries()) for (const d of findText(pt.text, s.q.input.value, s.whole.input.checked)) s.hits.push({ id: nextId++, kind: "search", page: i, text: d.text, rects: rangeRects(pt, d.start, d.end), checked: true });
    const n = s.hits.filter((x) => x.kind === "search").length;
    s.q.setMessage(s.q.input.value.trim() ? (n ? `Found ${plural(n, "match", "matches")}.` : "No matches.") : "");
    changed();
  }
  s.find.addEventListener("click", search);
  s.q.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  s.add.addEventListener("click", () => {
    const i = Number(s.pageNo.input.value) - 1;
    const slot = s.pv.slots[i];
    if (!slot) { s.status.textContent = "Type a page number that exists in this PDF."; return; }
    slot.wrap.scrollIntoView({ block: "center" });
    const hit = addManual(i, { x: 0.35, y: 0.4, w: 0.3, h: 0.06 });
    slot.overlay.querySelector<HTMLElement>(`.rd-box[data-hit="${hit.id}"]`)?.focus({ preventScroll: true });
  });
  return Object.assign(s, { active, chosen, scan, begin, renderList, paintAll });
});

/** Black out `rects` (fractions of the page) on the canvas. */
function paint(canvas: HTMLCanvasElement, rects: Rect[]) {
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  for (const r of rects) g.fillRect(Math.floor(r.x * canvas.width), Math.floor(r.y * canvas.height), Math.ceil(r.w * canvas.width) + 1, Math.ceil(r.h * canvas.height) + 1);
}
const toJpeg = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not save the redacted page."))), "image/jpeg", 0.85));

export const redact: ToolDef = {
  id: "redact", title: "Redact", heading: "Redact a PDF", group: "Privacy",
  blurb: "Remove text for good.",
  lede: "Find NRIC and FIN numbers, phone numbers, emails and addresses, or search for words, then remove them from the file for good, not just cover them.",
  accepts: "pdf",
  options(ctx) { return ui(ctx).root; },
  sync(ctx) {
    const u = ui(ctx);
    const f = ctx.file;
    if (f?.id !== u.fileId) {
      u.fileId = f?.id;
      u.signed = false;
      u.hits = [];
      u.pages = [];
      u.scanning = false;
      u.status.textContent = "";
      u.pv.setFile(f);
      u.pv.slots.forEach((slot) => u.begin(slot));
      u.renderList();
      if (f) {
        void u.scan(f).catch((e) => { console.warn("scan failed", e); u.scanning = false; u.status.textContent = "The text on this PDF could not be read. You can still draw boxes by hand."; ctx.refresh(); });
        formInfo(ctx, f).then((i) => { if (u.fileId === f.id && i.signed !== u.signed) { u.signed = i.signed; ctx.refresh(); } }, () => undefined);
      }
    }
    u.pageNo.input.max = String(f?.info?.pageCount ?? 1);
    u.hint.hidden = !!f;
    u.hint.textContent = "Add a PDF above to start.";
    u.root.querySelectorAll<HTMLElement>(".sg-side, .vw").forEach((e) => (e.hidden = !f));
  },
  warnings(ctx) { return ui(ctx).signed ? [SIGNED_WARNING] : []; },
  ready(ctx) { const u = ui(ctx); return !!ctx.file && !u.scanning && u.chosen().length > 0; },
  primaryLabel(ctx) { const n = ui(ctx).chosen().length; return n ? `Redact ${plural(n, "item")}` : "Redact"; },
  destroy(ctx) { ui(ctx).pv.destroy(); },
  async run(ctx) {
    const u = ui(ctx);
    const f = ctx.file!;
    const signal = ctx.o.signal;
    const doc = await store.doc(f);
    const chosen = u.chosen();
    const byPage = new Map<number, Rect[]>();
    for (const x of chosen) byPage.set(x.page, [...(byPage.get(x.page) ?? []), ...x.rects]);
    const affected = [...byPage.keys()].sort((a, b) => a - b);
    const pages: RedactPage[] = [];
    const canvas = document.createElement("canvas");
    try {
      for (const [k, i] of affected.entries()) {
        if (signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
        ctx.note(`Redacting page ${i + 1} (${k + 1} of ${affected.length})`);
        const page = await doc.getPage(i + 1);
        let scale = DPI / 72;
        const base = page.getViewport({ scale });
        if (base.width * base.height > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / (base.width * base.height));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvas, viewport, background: "#ffffff" });
        const stop = () => task.cancel();
        signal?.addEventListener("abort", stop);
        try { await task.promise; } catch (e) {
          if (e instanceof Error && e.name === "RenderingCancelledException") throw new PdfError("cancelled", "Cancelled.");
          throw e;
        } finally { signal?.removeEventListener("abort", stop); }
        const rects = byPage.get(i)!;
        paint(canvas, rects);
        const jpeg = new Uint8Array(await (await toJpeg(canvas)).arrayBuffer());
        const words: OcrWord[] = u.pages[i].words.filter((w) => !rects.some((r) => overlaps(w.r, r))).map((w) => ({
          text: w.text, conf: 100, eol: false, eop: false, x0: w.r.x * canvas.width, y0: w.r.y * canvas.height, x1: (w.r.x + w.r.w) * canvas.width, y1: (w.r.y + w.r.h) * canvas.height,
        }));
        pages.push({ page: i, jpeg, width: canvas.width, height: canvas.height, words });
        page.cleanup();
        ctx.o.onProgress?.(k + 1, affected.length);
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    // What stays readable: every page that is not rebuilt, plus the kept words of those that are. A redacted string that is still there on purpose can't be checked for.
    const kept = [...u.pages.flatMap((p, i) => (byPage.has(i) ? [] : [p.text])), ...pages.flatMap((p) => p.words.map((w) => w.text))].join(" ").toLowerCase();
    const needles = [...new Set(chosen.flatMap((x) => x.text.split("\n").map((t) => t.trim())).filter((t) => t.length >= 4 && !kept.includes(t.toLowerCase())))];
    const input: RedactInput = { pages, needles, items: chosen.length };
    ctx.note("Removing the text and rewriting the file");
    const r = await ctx.call<OpResult>("redact", { file: ctx.input(f), input, o: { producerCredit: ctx.producerCredit } });
    r.warnings.push({ code: "check-before-sharing", message: "Before you share it, open the file and search for a word you redacted to make sure it is gone." });
    return [r];
  },
};
