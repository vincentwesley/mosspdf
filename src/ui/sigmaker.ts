// Signature maker: draw, type or upload. The result is a trimmed canvas with a transparent background (kept in memory only: no storage).
// Previews are canvases, never <img>: after the seal the page CSP allows no image sources.
import { h } from "./dom";

const W = 1200;
const trimTo = (src: HTMLCanvasElement, pad = 6): HTMLCanvasElement | null => {
  const { width: w, height: hh } = src;
  const d = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hh - 1, y1 + pad);
  const out = Object.assign(document.createElement("canvas"), { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  out.getContext("2d")!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
};

/** Near-white pixels become transparent (soft edge), then the picture is cropped to what is left. Null when nothing is left. */
export function whiteToClear(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.min(d[i], d[i + 1], d[i + 2]);
    if (m >= 235) d[i + 3] = 0;
    else if (m > 195) d[i + 3] = Math.round((d[i + 3] * (235 - m)) / 40);
  }
  ctx.putImageData(img, 0, 0);
  return trimTo(src);
}

export const PEN = { black: "#111111", blue: "#1a3cc8" } as const;
type Tab = "draw" | "type" | "upload";

export function sigMaker(o: { id: string; name: string; colour: () => string; onChange: () => void }) {
  let tab: Tab = "draw";
  const results: Record<Tab, HTMLCanvasElement | null> = { draw: null, type: null, upload: null };
  const changed = () => o.onChange();

  // ---- draw ----
  const pad = Object.assign(document.createElement("canvas"), { width: W, height: 400 });
  pad.className = "sm__pad";
  pad.setAttribute("aria-label", `Drawing area for your ${o.name}. Draw with a finger, pen or mouse. To type it instead, use the Type tab.`);
  pad.setAttribute("role", "img");
  pad.setAttribute("data-testid", `${o.id}-pad`);
  const g = pad.getContext("2d", { willReadFrequently: true })!;
  g.lineCap = g.lineJoin = "round";
  g.lineWidth = 7;
  let last: { x: number; y: number } | null = null;
  const at = (e: PointerEvent) => { const r = pad.getBoundingClientRect(); return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * pad.height) / r.height }; };
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    last = at(e);
    g.strokeStyle = g.fillStyle = o.colour();
    g.beginPath(); g.arc(last.x, last.y, 3.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(last.x, last.y);
  });
  pad.addEventListener("pointermove", (e) => {
    if (!last) return;
    for (const ev of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
      const p = at(ev);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }; // curve through midpoints = smooth strokes
      g.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      g.stroke();
      g.beginPath(); g.moveTo(mid.x, mid.y);
      last = p;
    }
  });
  const end = () => { if (!last) return; last = null; results.draw = trimTo(pad); changed(); };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  const clear = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Clear", attrs: { "data-testid": `${o.id}-clear` }, on: { click: () => { g.clearRect(0, 0, W, pad.height); results.draw = null; changed(); } } });

  // ---- type ----
  const word = h("input", { class: "hs-input", id: `${o.id}-word`, type: "text", attrs: { maxlength: 40, autocomplete: "off", spellcheck: "false", "data-testid": `${o.id}-name` } });
  const prev = Object.assign(document.createElement("canvas"), { width: W, height: 300 });
  prev.className = "sm__pad sm__pad--static";
  prev.setAttribute("aria-hidden", "true");
  const drawWord = () => {
    const t = prev.getContext("2d", { willReadFrequently: true })!;
    t.clearRect(0, 0, W, prev.height);
    const text = word.value.trim();
    if (text) {
      let size = 220;
      t.font = `${size}px Caveat`;
      while (t.measureText(text).width > W - 40 && size > 20) { size -= 8; t.font = `${size}px Caveat`; }
      t.fillStyle = o.colour();
      t.textBaseline = "middle";
      t.fillText(text, 20, prev.height / 2);
    }
    results.type = text ? trimTo(prev) : null;
  };
  word.addEventListener("input", () => { drawWord(); changed(); });

  // ---- upload ----
  const note = h("p", { class: "field__msg", attrs: { role: "status", "data-testid": `${o.id}-upload-msg` } });
  const shown = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
  shown.className = "sm__shown";
  shown.hidden = true;
  shown.setAttribute("aria-hidden", "true");
  const file = h("input", { class: "hs-input", id: `${o.id}-file`, type: "file", attrs: { accept: "image/png,image/jpeg", "data-testid": `${o.id}-file` } });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    results.upload = null;
    note.textContent = "";
    shown.hidden = true;
    if (f) {
      try {
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, W / Math.max(bmp.width, bmp.height));
        const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(bmp.width * k)), height: Math.max(1, Math.round(bmp.height * k)) });
        c.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        results.upload = whiteToClear(c);
        if (!results.upload) note.textContent = "That picture looks blank. Use a photo or scan of your signature in dark ink on white paper.";
        else { shown.width = results.upload.width; shown.height = results.upload.height; shown.getContext("2d")!.drawImage(results.upload, 0, 0); shown.hidden = false; }
      } catch {
        note.textContent = "That file couldn't be read as a PNG or JPG picture.";
      }
    }
    changed();
  });

  // ---- tabs ----
  const names: [Tab, string][] = [["draw", "Draw"], ["type", "Type"], ["upload", "Upload"]];
  const panels: Record<Tab, HTMLElement> = {
    draw: h("div", { class: "sm__panel", id: `${o.id}-p-draw`, attrs: { role: "tabpanel", "aria-labelledby": `${o.id}-t-draw` } }, pad, h("div", { class: "sm__row" }, clear)),
    type: h("div", { class: "sm__panel", id: `${o.id}-p-type`, hidden: true, attrs: { role: "tabpanel", "aria-labelledby": `${o.id}-t-type` } },
      h("div", { class: "field" }, h("label", { text: `Type your ${o.name}`, attrs: { for: word.id } }), word), prev),
    upload: h("div", { class: "sm__panel", id: `${o.id}-p-upload`, hidden: true, attrs: { role: "tabpanel", "aria-labelledby": `${o.id}-t-upload` } },
      h("div", { class: "field" }, h("label", { text: "A photo or scan of your signature (PNG or JPG)", attrs: { for: file.id } }), file), note, shown),
  };
  const tabs = names.map(([t, label]) => h("button", { class: "sm__tab", id: `${o.id}-t-${t}`, type: "button", text: label, attrs: { role: "tab", "aria-controls": `${o.id}-p-${t}`, "data-testid": `${o.id}-tab-${t}` } }));
  const select = (t: Tab, focus = false, notify = true) => {
    tab = t;
    tabs.forEach((b, i) => { const on = names[i][0] === t; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    names.forEach(([k]) => (panels[k].hidden = k !== t));
    if (notify) changed();
  };
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => select(names[i][0]));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); select(names[(i + d + names.length) % names.length][0], true); }
    });
  });
  const el = h("div", { class: "sm", attrs: { "data-testid": `${o.id}-maker` } }, h("div", { class: "sm__tabs", attrs: { role: "tablist", "aria-label": `How to make your ${o.name}` } }, ...tabs), ...names.map(([t]) => panels[t]));
  select("draw", false, false);
  return {
    el,
    /** The made picture (trimmed, transparent), or null while nothing is drawn, typed or chosen. */
    result: () => results[tab],
    /** The pen colour changed: retype the name. (Drawn strokes keep the colour they were drawn in.) */
    refresh() { if (word.value.trim()) { drawWord(); changed(); } },
  };
}

export const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((ok, fail) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => ok(new Uint8Array(a)), fail) : fail(new Error("Could not make the picture."))), "image/png"));
