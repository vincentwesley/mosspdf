// Tiny DOM builder. No innerHTML anywhere (Trusted Types / CSP friendly); styles only via CSSOM.
type Child = Node | string | null | undefined | false;
export interface Props {
  class?: string; text?: string; id?: string; type?: string; href?: string; hidden?: boolean; disabled?: boolean;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
  attrs?: Record<string, string | number | boolean | undefined>;
  vars?: Record<string, string>; // CSS custom properties
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, p: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (p.class) el.className = p.class;
  if (p.id) el.id = p.id;
  if (p.text) el.textContent = p.text;
  if (p.type) (el as unknown as HTMLButtonElement).type = p.type as "button";
  if (p.href) (el as unknown as HTMLAnchorElement).href = p.href;
  if (p.hidden) el.hidden = true;
  if (p.disabled) (el as unknown as HTMLButtonElement).disabled = true;
  for (const [k, v] of Object.entries(p.attrs ?? {})) if (v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  for (const [k, v] of Object.entries(p.vars ?? {})) el.style.setProperty(k, v);
  for (const [k, f] of Object.entries(p.on ?? {})) el.addEventListener(k, f as EventListener);
  el.append(...kids.filter((c): c is Node | string => !!c));
  return el;
}

export const btn = (label: string, onClick: () => void, p: Props = {}) =>
  h("button", { ...p, type: "button", text: label, on: { click: onClick } });

export const clear = (el: Element) => el.replaceChildren();

/** Visually hidden live region for announcements. */
export const live = h("div", { class: "sr-only", attrs: { "aria-live": "polite", role: "status", "data-testid": "live" } });
export const announce = (msg: string) => { live.textContent = ""; setTimeout(() => (live.textContent = msg), 30); };

export const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
