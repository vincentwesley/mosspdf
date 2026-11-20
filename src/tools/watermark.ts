import type { WatermarkOptions } from "../ops/stamp";
import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { colourField, numberField, radioGroup, textField } from "../ui/fields";
import { pdfLossWarnings } from "./pages";
import { pageChoice } from "./pagesel";
import type { Ctx, ToolDef } from "./types";

// The op draws in Helvetica (WinAnsi). This is the same rule, duplicated because importing stamp.ts would pull pdf-lib into the main bundle.
// Printable ASCII, Latin-1 and the extra WinAnsi characters in 0x80-0x9F.
const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]$/;
export const badChars = (text: string) => [...new Set([...text])].filter((c) => !WIN_ANSI.test(c));

const ui = (ctx: Ctx) => ctx.local(() => ({
  text: textField({ id: "wm-text", label: "Watermark text", placeholder: "CONFIDENTIAL", testid: "wm-text", msgTestId: "wm-text-msg", reserve: true, onInput: () => ctx.refresh() }),
  opacity: numberField({ id: "wm-opacity", label: "Opacity (%)", value: 25, min: 1, max: 100, step: 1, testid: "wm-opacity", onInput: () => ctx.refresh() }),
  angle: radioGroup({ name: "wm-angle", legend: "Angle", value: "45", testid: (v) => `angle-${v}`, onChange: () => ctx.refresh(), options: [["0", "Flat"], ["45", "Diagonal"], ["90", "Upright"], ["custom", "Custom"]] }),
  custom: numberField({ id: "wm-angle-custom", label: "Custom angle (degrees)", value: 30, min: -360, max: 360, step: 1, testid: "wm-angle-custom", onInput: () => ctx.refresh() }),
  size: numberField({ id: "wm-size", label: "Text size (pt)", value: 64, min: 4, max: 400, step: 1, testid: "wm-size", onInput: () => ctx.refresh() }),
  colour: colourField({ id: "wm-colour", label: "Colour", value: "#808080", testid: "wm-colour", onInput: () => ctx.refresh() }),
  layer: radioGroup({ name: "wm-layer", legend: "Put it", value: "over", testid: (v) => `layer-${v}`, onChange: () => ctx.refresh(), options: [["over", "On top of the page"], ["under", "Behind the page"]] }),
  pages: pageChoice(ctx, "wm"),
}));

function plan(ctx: Ctx) {
  const u = ui(ctx);
  const text = u.text.input.value;
  const bad = badChars(text);
  const num = (f: { input: HTMLInputElement }) => (f.input.value === "" ? NaN : Number(f.input.value));
  const opacity = num(u.opacity), size = num(u.size);
  const angle = u.angle.value() === "custom" ? num(u.custom) : Number(u.angle.value());
  return {
    text, bad, opacity, size, angle,
    sel: u.pages.read(ctx.file?.info?.pageCount),
    opacityOk: opacity >= 1 && opacity <= 100,
    sizeOk: size >= 4 && size <= 400,
    angleOk: angle >= -360 && angle <= 360,
  };
}

export const watermark: ToolDef = {
  id: "watermark", title: "Watermark", heading: "Add a watermark", group: "Edit",
  blurb: "Stamp text on every page.",
  lede: "Stamp a line of text across your pages, such as DRAFT or CONFIDENTIAL.",
  accepts: "pdf", batch: true,
  options(ctx) {
    const u = ui(ctx);
    return h("div", { class: "stampopts" }, u.text.el, u.opacity.el, u.angle.el, u.custom.el, u.size.el, u.colour.el, u.layer.el, u.pages.el);
  },
  sync(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    u.custom.el.hidden = u.angle.value() !== "custom";
    u.text.setMessage(
      p.bad.length ? `These characters cannot be used yet: ${p.bad.map((c) => `"${c}"`).join(" ")}. Use Western European letters, digits and basic punctuation.` : p.text.trim() ? "" : "Type the text to stamp on each page.",
      p.bad.length > 0,
    );
    u.opacity.setError(p.opacityOk ? null : "Use a number from 1 to 100.");
    u.size.setError(p.sizeOk ? null : "Use a size from 4 to 400.");
    u.custom.setError(p.angleOk ? null : "Use an angle from -360 to 360.");
  },
  warnings: pdfLossWarnings,
  ready(ctx) { const p = plan(ctx); return !!ctx.file && !!p.text.trim() && !p.bad.length && !!p.sel && p.opacityOk && p.sizeOk && p.angleOk; },
  primaryLabel: () => "Add watermark",
  async run(ctx) {
    const u = ui(ctx);
    const p = plan(ctx);
    const options: WatermarkOptions = { text: p.text, opacity: p.opacity / 100, angle: p.angle, fontSize: p.size, color: u.colour.input.value, layer: u.layer.value() as "over" | "under", pages: p.sel!.all ? undefined : p.sel!.pages };
    return [await ctx.call<OpResult>("watermark", { file: ctx.input(ctx.file!), options, o: { producerCredit: ctx.producerCredit } })];
  },
};
