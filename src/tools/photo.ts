// Photo clean (M6, D17). Each photo is drawn onto a canvas and saved again from it, which leaves out every metadata tag (EXIF, GPS, XMP,
// thumbnails) by construction. Boxes the user draws are blurred or pixelated before saving. There is no face or plate detection (D8):
// the page says so. Orientation is applied on decode (createImageBitmap "from-image"), so the saved picture is upright with no flag.
import type { LoadedFile } from "../core/store";
import { readExif, type ExifSummary } from "../core/exif";
import type { Rect } from "../core/textpos";
import { PdfError, type OpResult } from "../ops/types";
import { announce, h, plural } from "../ui/dom";
import { radioGroup, selectField } from "../ui/fields";
import { drawBoxes, place, wireBox } from "../ui/boxlayer";
import type { Ctx, ToolDef } from "./types";

/** A canvas this big still works on phones (iOS caps one near 16.7 million pixels). */
const MAX_PIXELS = 16_000_000;
const PREVIEW = 1400;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

interface Photo { bmp?: ImageBitmap; boxes: Rect[] }

/** The photo with its boxes blurred or pixelated, onto `c` (sized by the caller). `flat` paints white first so a JPEG has no see-through pixels. */
function paintPhoto(c: HTMLCanvasElement, bmp: ImageBitmap, boxes: Rect[], mode: string, level: number, flat: boolean) {
  const g = c.getContext("2d")!;
  if (flat) { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const canBlur = mode === "blur" && "filter" in g;
  for (const r of boxes) {
    const [x, y, w, hh] = [Math.floor(r.x * c.width), Math.floor(r.y * c.height), Math.ceil(r.w * c.width), Math.ceil(r.h * c.height)];
    if (canBlur) {
      g.save();
      g.beginPath(); g.rect(x, y, w, hh); g.clip();
      g.filter = `blur(${Math.max(4, c.width * 0.01 * level)}px)`;
      g.drawImage(bmp, 0, 0, c.width, c.height);
      g.restore();
    } else {
      const block = Math.max(3, Math.round(c.width * 0.012 * level));
      const t = document.createElement("canvas");
      t.width = Math.max(1, Math.ceil(w / block));
      t.height = Math.max(1, Math.ceil(hh / block));
      t.getContext("2d")!.drawImage(bmp, r.x * bmp.width, r.y * bmp.height, r.w * bmp.width, r.h * bmp.height, 0, 0, t.width, t.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(t, 0, 0, t.width, t.height, x, y, w, hh);
      g.imageSmoothingEnabled = true;
      t.width = t.height = 0;
    }
  }
}

const isPng = async (b: Blob) => { const s = new Uint8Array(await b.slice(0, 4).arrayBuffer()); return s[0] === 0x89 && s[1] === 0x50; };
const isJpeg = async (b: Blob) => { const s = new Uint8Array(await b.slice(0, 2).arrayBuffer()); return s[0] === 0xff && s[1] === 0xd8; };
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new PdfError("unsupported", "This browser could not save the picture."))), type, q));

const ui = (ctx: Ctx) => ctx.local(() => {
  const s = {
    by: new Map<number, Photo>(),
    exif: new Map<number, ExifSummary & { jpeg: boolean }>(),
    cur: undefined as number | undefined,
    key: "",
    mode: radioGroup({ name: "ph-mode", legend: "How to hide", value: "pixelate", testid: (v) => `ph-mode-${v}`, onChange: () => fx(), options: [["pixelate", "Pixelate"], ["blur", "Blur"]] }),
    level: selectField({ id: "ph-level", label: "Strength", testid: "ph-level", value: "2", onInput: () => fx(), options: [["1", "Light"], ["2", "Medium"], ["3", "Strong"]] }),
    pick: selectField({ id: "ph-pick", label: "Photo to edit", testid: "ph-pick", onInput: () => void choose(Number(s.pick.input.value)), options: [] }),
    add: h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Add box", attrs: { "data-testid": "ph-add" } }),
    info: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "ph-exif" } }),
    total: h("p", { class: "field__hint", attrs: { "data-testid": "ph-total" } }),
    list: h("ul", { class: "sg-list", attrs: { role: "list", "data-testid": "ph-list" } }),
    hint: h("p", { class: "hs-banner hs-banner--info", attrs: { role: "status", "data-testid": "photo-hint" } }),
    canvas: h("canvas", { class: "ph-canvas", attrs: { "aria-label": "The photo, as it will be saved", role: "img", "data-testid": "ph-canvas" } }),
    overlay: h("div", { class: "vw__overlay ph-overlay", attrs: { "data-testid": "ph-overlay" } }),
    root: h("div", { class: "sign ph" }),
  };
  const stage = h("div", { class: "ph-stage" }, s.canvas, s.overlay);
  const step = (n: number, title: string, ...kids: (HTMLElement | null)[]) => h("section", { class: "sg-step" }, h("h3", { text: `${n}. ${title}` }), ...kids.filter((k): k is HTMLElement => !!k));
  s.root.append(
    s.hint,
    h("div", { class: "sg-layout" },
      h("div", { class: "sg-side" },
        step(1, "What is in the photo", s.info, s.total),
        step(2, "Hide faces, plates or screens",
          h("p", { class: "sg-help", text: "Draw boxes over faces, number plates or screens. MossPDF doesn't detect them automatically." }),
          h("p", { class: "sg-help", text: "Drag on the photo to draw a box (mouse or pen). With the keyboard or on a phone, press Add box, then move it: arrow keys or drag; plus and minus resize it; Alt with the arrow keys makes it wider, narrower, taller or shorter; Delete removes it." }),
          s.pick.el, h("div", { class: "sg-where" }, s.add), s.mode.el, s.level.el, s.list)),
      stage));

  const cur = () => (s.cur === undefined ? undefined : s.by.get(s.cur));
  /** Redraws the picture (not the boxes). */
  let raf = 0;
  function fx() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const p = cur();
      if (!p?.bmp) return;
      const k = Math.min(1, PREVIEW / Math.max(p.bmp.width, p.bmp.height));
      s.canvas.width = Math.round(p.bmp.width * k);
      s.canvas.height = Math.round(p.bmp.height * k);
      paintPhoto(s.canvas, p.bmp, p.boxes, s.mode.value(), Number(s.level.input.value), false);
    });
  }
  /** Rebuilds the box elements and the list. */
  function boxes() {
    const p = cur();
    stage.hidden = !p?.bmp;
    s.overlay.replaceChildren(...(p?.boxes ?? []).map((r, i) => {
      const el = h("div", { class: "rd-box rd-box--manual rd-box--ph", attrs: { tabindex: 0, role: "group", "aria-label": `Box ${i + 1}. Arrow keys move it, plus and minus resize it, Delete removes it.`, "data-testid": "ph-box" } });
      place(el, r);
      wireBox(el, r, s.overlay, { onChange: fx, onDelete: () => remove(r) });
      return el;
    }));
    s.list.replaceChildren(...(p?.boxes ?? []).map((r, i) => h("li", { class: "sg-row", attrs: { "data-testid": "ph-row" } },
      h("span", { class: "sg-row__what", text: `Box ${i + 1}` }),
      h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Remove", attrs: { "aria-label": `Remove box ${i + 1}` }, on: { click: () => remove(r) } }))));
  }
  function remove(r: Rect) {
    const p = cur();
    if (!p) return;
    p.boxes.splice(p.boxes.indexOf(r), 1);
    announce("Box removed.");
    boxes(); fx();
    s.add.focus();
  }
  function addBox(r: Rect) {
    const p = cur();
    if (!p) return;
    p.boxes.push(r);
    announce(`Box ${p.boxes.length} added.`);
    boxes(); fx();
    return r;
  }
  drawBoxes(s.overlay, addBox);
  s.add.addEventListener("click", () => {
    const r = addBox({ x: 0.35, y: 0.35, w: 0.3, h: 0.2 });
    if (r) s.overlay.querySelectorAll<HTMLElement>(".rd-box")[cur()!.boxes.indexOf(r)]?.focus({ preventScroll: true });
  });

  async function load(f: LoadedFile) {
    let p = s.by.get(f.id);
    if (!p) s.by.set(f.id, (p = { boxes: [] }));
    if (!p.bmp) {
      const bmp = await createImageBitmap(f.blob!, { imageOrientation: "from-image" });
      if (s.by.get(f.id) === p) p.bmp = bmp; else bmp.close();
    }
    return p;
  }
  async function exifOf(f: LoadedFile) {
    if (!s.exif.has(f.id)) {
      const jpeg = await isJpeg(f.blob!);
      s.exif.set(f.id, { ...(jpeg ? readExif(new Uint8Array(await f.blob!.slice(0, 262144).arrayBuffer())) : { hasExif: false, gps: false }), jpeg });
    }
    return s.exif.get(f.id)!;
  }
  function describe(e: ExifSummary & { jpeg: boolean }) {
    if (!e.hasExif) return e.jpeg ? "No camera, date or location details were found in this photo. The saved copy has none either." : "This is not a JPG, so there is no EXIF block to read. The saved copy should carry no camera or location details.";
    const parts = [e.camera && `camera ${e.camera}`, e.date && `taken ${e.date}`, `location (GPS): ${e.gps ? "yes" : "no"}`].filter(Boolean);
    return `Found in this photo: ${parts.join(", ")}. All of it is left out of the saved copy.`;
  }
  async function choose(id: number) {
    const f = ctx.files.find((x) => x.id === id);
    if (!f) return;
    s.cur = id;
    s.pick.input.value = String(id);
    const [, e] = await Promise.all([load(f), exifOf(f)]);
    if (s.cur !== id) return;
    s.info.textContent = describe(e);
    boxes(); fx();
  }
  async function totals(files: LoadedFile[]) {
    const all = await Promise.all(files.map(exifOf));
    if (files.length > 1) s.total.textContent = `${all.filter((e) => e.gps).length} of ${files.length} photos carry a location.`;
    else s.total.textContent = "";
  }
  return Object.assign(s, { choose, totals });
});

export const photo: ToolDef = {
  id: "photo", title: "Photo clean", heading: "Clean a photo", group: "Privacy",
  blurb: "Strip location and details.",
  lede: "Remove location and camera details from photos, and pixelate or blur parts. Draw boxes over faces, number plates or screens. MossPDF doesn't detect them automatically.",
  accepts: "images",
  options(ctx) { return ui(ctx).root; },
  sync(ctx) {
    const u = ui(ctx);
    const files = ctx.files;
    u.hint.hidden = files.length > 0;
    u.hint.textContent = "Add a photo above to start.";
    u.root.querySelectorAll<HTMLElement>(".sg-side").forEach((e) => (e.hidden = !files.length));
    u.pick.el.hidden = files.length < 2;
    const key = files.map((f) => f.id).join(",");
    if (key === u.key) return;
    u.key = key;
    for (const [id, p] of u.by) if (!files.some((f) => f.id === id)) { p.bmp?.close(); u.by.delete(id); }
    u.pick.input.replaceChildren(...files.map((f, i) => h("option", { text: `${i + 1} of ${files.length}: ${f.name}`, attrs: { value: f.id } })));
    if (!files.length) { u.cur = undefined; u.info.textContent = ""; u.total.textContent = ""; return; }
    void u.totals(files);
    void u.choose(files.some((f) => f.id === u.cur) ? u.cur! : files[0].id).catch(() => { u.info.textContent = "This photo could not be read."; });
  },
  primaryLabel(ctx) { return ctx.files.length > 1 ? `Save ${plural(ctx.files.length, "clean photo")}` : "Save clean photo"; },
  destroy(ctx) { const u = ui(ctx); u.by.forEach((p) => p.bmp?.close()); u.by.clear(); },
  async run(ctx) {
    const u = ui(ctx);
    const results: OpResult[] = [];
    const used = new Set<string>();
    let shrunk = false;
    const c = document.createElement("canvas");
    try {
      for (const [k, f] of ctx.files.entries()) {
        if (ctx.o.signal?.aborted) throw new PdfError("cancelled", "Cancelled.");
        ctx.note(`Cleaning photo ${k + 1} of ${ctx.files.length}`);
        const p = { bmp: await createImageBitmap(f.blob!, { imageOrientation: "from-image" }), boxes: u.by.get(f.id)?.boxes ?? [] };
        try {
          let scale = 1;
          if (p.bmp.width * p.bmp.height > MAX_PIXELS) { scale = Math.sqrt(MAX_PIXELS / (p.bmp.width * p.bmp.height)); shrunk = true; }
          c.width = Math.round(p.bmp.width * scale);
          c.height = Math.round(p.bmp.height * scale);
          const png = await isPng(f.blob!);
          paintPhoto(c, p.bmp, p.boxes, u.mode.value(), Number(u.level.input.value), !png);
          const blob = await toBlob(c, png ? "image/png" : "image/jpeg", 0.92);
          let name = `${stem(f.name)}-clean.${png ? "png" : "jpg"}`;
          for (let n = 2; used.has(name); n++) name = `${stem(f.name)}-clean-${n}.${png ? "png" : "jpg"}`;
          used.add(name);
          results.push({ bytes: new Uint8Array(await blob.arrayBuffer()), name, warnings: [] });
        } finally {
          p.bmp.close();
        }
        ctx.o.onProgress?.(k + 1, ctx.files.length);
      }
    } finally {
      c.width = c.height = 0;
    }
    if (shrunk) results[0].warnings.push({ code: "shrunk", message: "A very large photo was saved a little smaller so this device could handle it." });
    return results;
  },
};
