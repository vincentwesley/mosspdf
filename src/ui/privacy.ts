import { netlog, type NetEntry } from "../core/netlog";
import { seal } from "../core/seal";
import { h } from "./dom";
import { icon } from "./icons";

export const VERSION = __APP_VERSION__;

export function badgeText(): string {
  if (seal.status === "sealed") {
    const after = netlog.after();
    const n = after.filter((e) => !e.blocked).length;
    const b = after.length - n;
    return `Sealed · ${n} ${n === 1 ? "request" : "requests"}${b ? ` · ${b} blocked` : ""}`;
  }
  return seal.status === "failed" ? "Not sealed" : "Getting ready…";
}

const short = (u: string) => { try { const x = new URL(u); return x.origin === location.origin ? x.pathname : x.href; } catch { return u; } };

/** The how-to-check steps, shared by the dialog and the privacy page. */
export function howToCheck(): HTMLElement {
  return h("ol", { class: "steps" },
    h("li", { text: "Open your browser's developer tools (F12) and choose the Network tab. Reload, then add a file and run a tool. Nothing new appears." }),
    h("li", { text: "Turn on airplane mode, or go offline in the Network tab, and keep working. The tools still run." }),
    h("li", { text: "Look at the page's response headers. The Content-Security-Policy only allows this site, and after loading the page locks itself down further." }));
}

export function privacyDialog(): { dialog: HTMLDialogElement; open: (opener: HTMLElement) => void } {
  const rows = h("tbody");
  const summary = h("p", { class: "pv__sum", attrs: { "data-testid": "seal-summary", role: "status" } });
  const table = h("div", { class: "pv__tablewrap", attrs: { tabindex: 0, role: "region", "aria-label": "Requests since page load" } },
    h("table", { class: "pv__table", attrs: { "data-testid": "request-log" } },
      h("thead", {}, h("tr", {}, ...["Request", "Result"].map((t) => h("th", { text: t, attrs: { scope: "col" } })))), rows));
  let opener: HTMLElement | null = null;

  const render = () => {
    const sealed = seal.status === "sealed";
    const after = netlog.after();
    summary.textContent = sealed
      ? `Sealed at ${seal.sealedAt!.toLocaleTimeString()}. ${after.filter((e) => !e.blocked).length} requests have left this page since then, and ${after.filter((e) => e.blocked).length} were blocked.`
      : seal.status === "failed" ? `The page could not seal itself (${seal.error}). The site's own security policy still only allows this site.` : "Getting ready. Loading the PDF engines, then the page locks down.";
    const all = netlog.all();
    rows.replaceChildren(...(all.length ? all : [{ url: "", blocked: false, t: 0 } as NetEntry]).map((e) => {
      if (!e.url) return h("tr", {}, h("td", { text: "No requests recorded yet.", attrs: { colspan: 2 } }));
      const phase = netlog.sealPerf !== null && e.t >= netlog.sealPerf ? "after seal" : "before seal";
      return h("tr", { class: phase === "after seal" ? "is-after" : "" },
        h("td", {}, h("span", { class: "mono", text: short(e.url) }), h("small", { class: "pv__when", text: `${phase}, ${(e.t / 1000).toFixed(1)}s` })),
        h("td", { text: e.blocked ? `blocked (${e.directive})` : "ok" }));
    }));
  };

  const dialog: HTMLDialogElement = h("dialog", { class: "hs-dialog pv", attrs: { "aria-labelledby": "pv-h", "data-testid": "privacy-dialog" } },
    h("div", { class: "dlg__head" },
      h("h2", { id: "pv-h", text: "Your files stay here", attrs: { tabindex: -1 } }),
      h("button", { class: "dlg__x", type: "button", attrs: { "aria-label": "Close", "data-testid": "privacy-close" }, on: { click: () => dialog.close() } }, icon("close"))),
    h("p", { text: "Pagehold loads its PDF engines first, then seals the page. After that the browser blocks every request, so your files cannot be sent anywhere. Nothing is uploaded, and there are no accounts, cookies or analytics." }),
    summary,
    h("p", { class: "pv__sum", text: "If you opened Pagehold on the OCR page, the OCR engine (about 6 MB) was loaded before the page sealed, like the other engines. It is listed below as a request before seal." }),
    h("h3", { text: "Requests since this page loaded" }),
    table,
    h("h3", { text: "Check it yourself" }),
    howToCheck(),
    h("p", { class: "pv__foot" }, h("a", { href: "#/privacy", text: "Read the privacy page", on: { click: () => { dialog.close(); } } }), ` · Version ${VERSION}`));

  dialog.addEventListener("close", () => { unsub(); opener?.focus(); });
  let unsub = () => undefined as void;
  return {
    dialog,
    open(o) {
      opener = o;
      render();
      unsub = netlog.subscribe(render);
      const u2 = seal.subscribe(render);
      const prev = unsub;
      unsub = () => { prev(); u2(); };
      dialog.showModal();
      dialog.querySelector<HTMLElement>("#pv-h")?.focus();
    },
  };
}

export function privacyPage(): { el: HTMLElement; destroy: () => void } {
  return {
    destroy: () => undefined,
    el: h("div", { class: "view prose" },
      h("h1", { text: "Privacy", attrs: { tabindex: -1, "data-testid": "view-heading" } }),
      h("p", { text: "Pagehold is a set of PDF tools that run entirely in your browser. Your files are opened, changed and saved on your own device." }),
      h("h2", { text: "What Pagehold does not do" }),
      h("ul", {}, ...["Upload your files or send them anywhere.", "Use analytics, trackers or advertising.", "Set cookies or ask you to make an account.", "Make any network request after the page has loaded and sealed itself."].map((t) => h("li", { text: t }))),
      h("h2", { text: "What it stores" }),
      h("p", { text: "Your files stay in memory until you remove them or close the tab. Your theme, logo size and, if you change it, the Output settings choice are saved in this browser. The offline copy of the app is stored by your browser so Pagehold works without a connection." }),
      h("h2", { text: "How to check" }),
      howToCheck(),
      h("p", {}, "The ", h("strong", { text: "Sealed" }), " badge at the top lists every request this page has made. The code is open source on ",
        h("a", { href: "https://github.com/vincentwesley/pagehold", text: "GitHub", attrs: { target: "_blank", rel: "noopener" } }), ".")),
  };
}
