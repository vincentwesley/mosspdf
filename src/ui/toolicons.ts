// Tool icons (path data in ui/icondata.ts): Pixelarticons 2.4.2 (MIT, https://github.com/halfmage/pixelarticons, see licences.txt). 24px grid, filled paths, tinted with currentColor.
// Built with createElementNS (no innerHTML). Always decorative: pair with a text label.
import { GROUPS, type GroupName } from "../tools/types";
import { toolById } from "../tools";
import { h } from "./dom";
let D: Record<string, string> = {};
const pending: [SVGPathElement, string][] = [];
/** Called by ui/icondata once its chunk lands: fills every icon drawn before then. */
export function setIcons(d: Record<string, string>): void {
  D = d;
  for (const [p, id] of pending.splice(0)) p.setAttribute("d", D[id] ?? D["extract"]);
}
/** The pixel icon for a tool id (a generic file icon for an unknown id). */
export function toolIcon(id: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("tico");
  const p = document.createElementNS(ns, "path");
  if (D.extract) p.setAttribute("d", D[id] ?? D.extract); else pending.push([p, id]);
  svg.append(p);
  return svg;
}

const TINTS = 3;
/** Square icon tile for a tool, tinted mint / peach / lavender by its group so the home map reads at a glance. `lg` is the 48px icon for page headings. */
export function toolBox(id: string, lg = false): HTMLSpanElement {
  const g = GROUPS.indexOf(toolById(id)?.group as GroupName);
  return h("span", { class: `ibox tint-${Math.max(g, 0) % TINTS}${lg ? " ibox--lg" : ""}` }, toolIcon(id));
}
