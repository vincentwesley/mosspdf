import "./core/netlog"; // start observing requests as early as possible
import "./style.css";
import "./credits/credits.js";
import "./brand/logo-resize";
import "./core/engines";
import { applyTheme, nextTheme, type Theme } from "./theme";
import { bootAndSeal, seal } from "./core/seal";
import { netlog } from "./core/netlog";
import { badgeText, privacyDialog, privacyPage, VERSION } from "./ui/privacy";
import { homeView } from "./ui/home";
import { workspace } from "./ui/workspace";
import { toolById } from "./tools";
import { live } from "./ui/dom";
import { initGlobalIntake } from "./ui/dropzone";
import { initPalette, MOD } from "./ui/palette";
import { routeOf } from "./core/ocrlangs";

const KEY = "theme";
const store = {
  get: (): Theme => {
    try {
      return localStorage.getItem(KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  },
  set: (t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage blocked: theme just won't persist */
    }
  },
};

const btn = document.querySelector<HTMLButtonElement>("#theme")!;
function sync(t: Theme): void {
  applyTheme(t);
  btn.setAttribute("aria-pressed", String(t === "light"));
}
sync(store.get());
btn.addEventListener("click", () => {
  const t = nextTheme(store.get());
  store.set(t);
  sync(t);
});

// ---- seal badge + privacy dialog ----
document.querySelector<HTMLElement>("#app-version")!.textContent = VERSION;
document.body.append(live);
const badge = document.querySelector<HTMLButtonElement>("#seal-badge")!;
const privacy = privacyDialog();
document.body.append(privacy.dialog);
const paintBadge = () => {
  document.querySelector("#seal-text")!.textContent = badgeText();
  badge.dataset.state = seal.status;
};
seal.subscribe(paintBadge);
netlog.subscribe(paintBadge);
badge.addEventListener("click", () => privacy.open(badge));

// ---- command palette ----
const palette = initPalette({ switchTheme: () => btn.click(), openPrivacy: (o) => privacy.open(o) });
const searchBtn = document.querySelector<HTMLButtonElement>("#palette-btn")!;
searchBtn.querySelector("kbd")!.textContent = `${MOD} K`;
searchBtn.addEventListener("click", () => palette.open(searchBtn));

// ---- router ----
const app = document.querySelector<HTMLElement>("#app")!;
let current: { destroy: () => void } | null = null;
initGlobalIntake();

function resolve(): { el: HTMLElement; destroy: () => void } {
  const route = routeOf(location.hash);
  if (route === "privacy") return privacyPage();
  const tool = toolById(route);
  if (tool) return workspace(tool);
  return homeView((h) => { location.hash = h; });
}

let first = true;
function render(): void {
  const swap = () => {
    current?.destroy();
    const v = resolve();
    current = v;
    app.replaceChildren(v.el);
    const h1 = app.querySelector<HTMLElement>("h1");
    document.title = h1 && location.hash.length > 2 ? `${h1.textContent} · Pagehold` : "Pagehold";
    if (!first) { scrollTo(0, 0); h1?.focus({ preventScroll: true }); }
    first = false;
  };
  if ("startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches && !first) {
    // A newer navigation skips the running transition; its promises then reject with AbortError, which is harmless.
    const vt = (document as Document & { startViewTransition(f: () => void): { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> } }).startViewTransition(swap);
    for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p.catch(() => undefined);
  } else swap();
}
addEventListener("hashchange", render);
render();

void bootAndSeal();
