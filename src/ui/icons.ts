// Small stroke icons (24px grid), built with createElementNS (no innerHTML). Always decorative: pair with a text label.
const PATHS = {
  rotateL: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  rotateR: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  left: "M19 12H5M11 6l-6 6 6 6",
  right: "M5 12h14M13 6l6 6-6 6",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  close: "M6 6l12 12M18 6L6 18",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z",
  check: "M5 12l5 5 9-10",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
} as const;
export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ico");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", PATHS[name]);
  svg.append(p);
  return svg;
}
