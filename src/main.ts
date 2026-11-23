import "./core/netlog"; // start observing requests as early as possible
import "./style.css";
import "./credits/credits.js";
import "./brand/logo-resize";
import "./core/engines";
import { applyTheme, nextTheme, type Theme } from "./theme";
import { bootAndSeal, registerEngine, seal } from "./core/seal";
import { netlog } from "./core/netlog";
import { badgeText, privacyDialog, privacyPage, VERSION } from "./ui/privacy";
import { homeView } from "./ui/home";
import { h } from "./ui/dom";
import { workspace } from "./ui/workspace";
import { toolById } from "./tools";
import type { ToolDef } from "./tools/types";
import { live } from "./ui/dom";
import { initGlobalIntake } from "./ui/dropzone";
import { initInstall } from "./ui/install";
import { initPalette, MOD } from "./ui/palette";
import { routeOf } from "./core/ocrlangs";
import { cjkLang, LANG_NAME, LANGS, setCjkLang, type Lang } from "./core/zhfont";

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

// ---- optional CJK font (D24, D30): choosing a language reloads the tab so the font loads before the seal ----
const zh = document.querySelector<HTMLSelectElement>("#zh-toggle")!;
for (const [v, t] of [["off", "Off"], ...LANGS.map((l) => [l, LANG_NAME[l]])]) zh.append(h("option", { attrs: { value: v } }, t));
zh.value = cjkLang() ?? "off";
document.querySelector<HTMLElement>("#zh-hint")!.textContent = cjkLang() ? "Changing it reloads the page." : "Adds 2 to 3 MB, reloads the page.";
zh.addEventListener("change", () => { setCjkLang(zh.value === "off" ? undefined : (zh.value as Lang)); location.reload(); });

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
initInstall(document.querySelector<HTMLElement>(".appfoot")!);

// D25: tool code is one chunk, imported before the seal (an engine entry) so nothing loads afterwards.
let defs: Map<string, ToolDef> | undefined;
const toolsReady = import("./tools/all").then((m) => { defs = new Map(m.DEFS.map((d) => [d.id, d])); });
registerEngine({ name: "tools", load: () => toolsReady });

function resolve(): { el: HTMLElement; destroy: () => void } {
  const route = routeOf(location.hash);
  if (route === "privacy") return privacyPage();
  const tool = defs?.get(route);
  if (tool) return workspace(tool);
  return homeView((h) => { location.hash = h; });
}

let first = true;
function render(): void {
  if (!defs && toolById(routeOf(location.hash))) { void toolsReady.then(render, () => { location.hash = "#/"; }); return; } // on failure the tool code is missing: show home (the seal badge reports the failure)
  const swap = () => {
    current?.destroy();
    const v = resolve();
    current = v;
    app.replaceChildren(v.el);
    const h1 = app.querySelector<HTMLElement>("h1");
    document.title = h1 && location.hash.length > 2 ? `${h1.textContent} · MossPDF` : "MossPDF";
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
