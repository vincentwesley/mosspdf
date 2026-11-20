import { errorMessage } from "../core/store";
import { a11yReportText } from "../core/a11yreport";
import type { A11yCheck, A11yReport, A11yStatus } from "../ops/a11y";
import { h } from "../ui/dom";
import type { Ctx, ToolDef } from "./types";

const WORD: Record<A11yStatus, string> = { pass: "Pass", warn: "Look at this", fail: "Fix this" };

interface State { key: string; status: "idle" | "checking" | "done" | "error"; report?: A11yReport; error?: string }

const ui = (ctx: Ctx) => ctx.local(() => {
  const out = h("div", { class: "scan", attrs: { "data-testid": "a11y-result" } });
  return { s: { key: "", status: "idle" } as State, out, box: h("div", { class: "scanbox" }, out) };
});

const row = (c: A11yCheck) => h("li", { class: `scan__item a11y a11y--${c.status}`, attrs: { "data-testid": "a11y-check", "data-id": c.id, "data-status": c.status } },
  h("p", { class: "scan__what" }, h("strong", { text: c.label }), h("span", { class: "a11y__tag", text: ` · ${WORD[c.status]}` })),
  h("p", { class: "scan__why", text: c.detail }),
  c.fix && h("p", { class: "scan__detail" }, h("strong", { text: "How to fix: " }), c.fix));

function draw(ctx: Ctx) {
  const { s, out } = ui(ctx);
  const kids: HTMLElement[] = [];
  if (s.status === "checking") kids.push(h("p", { class: "hs-banner hs-banner--info", text: "Checking…", attrs: { role: "status" } }));
  if (s.status === "error") kids.push(h("p", { class: "hs-banner hs-banner--danger", text: s.error ?? "", attrs: { role: "alert" } }));
  if (s.report) {
    const n = (k: A11yStatus) => s.report!.checks.filter((c) => c.status === k).length;
    kids.push(
      s.report.repaired ? h("p", { class: "hs-banner hs-banner--warn", text: "This file was damaged and had to be repaired before it could be checked." }) : h("span"),
      h("p", { class: "hs-banner hs-banner--info", text: `${n("pass")} passed, ${n("warn")} to look at, ${n("fail")} to fix.`, attrs: { role: "status", "data-testid": "a11y-summary" } }),
      h("ul", { class: "scan__list", attrs: { role: "list" } }, ...s.report.checks.map(row)));
  }
  kids.push(h("p", { class: "field__hint", text: "This is a basic check of the signals screen readers rely on. It is not a PDF/UA validation or a certificate.", attrs: { "data-testid": "a11y-disclaimer" } }));
  out.replaceChildren(...kids);
}

export const a11yCheck: ToolDef = {
  id: "a11y-check", title: "Accessibility check", group: "Edit",
  blurb: "See how well screen readers can use a PDF.",
  lede: "Checks tags, language, title, picture descriptions, fonts, real text and bookmarks, with a plain note on how to fix each.",
  accepts: "pdf",
  options(ctx) { draw(ctx); return ui(ctx).box; },
  sync(ctx) {
    const u = ui(ctx);
    const f = ctx.file;
    u.box.hidden = !f;
    const key = f ? `${f.id}:${f.password ?? ""}` : "";
    if (key === u.s.key) return;
    Object.assign(u.s, { key, status: f ? "checking" : "idle", report: undefined, error: undefined });
    draw(ctx);
    if (!f) return;
    void ctx.call<A11yReport>("accessibilityCheck", { file: ctx.input(f) })
      .then((r) => { if (u.s.key === key) Object.assign(u.s, { status: "done", report: r }); })
      .catch((e) => { if (u.s.key === key) Object.assign(u.s, { status: "error", error: errorMessage(e) }); })
      .finally(() => { if (u.s.key === key) draw(ctx); ctx.refresh(); });
  },
  ready: (ctx) => !!ui(ctx).s.report,
  primaryLabel: () => "Save report (.txt)",
  summary: () => "The report is a plain text file.",
  async run(ctx) {
    const f = ctx.file!;
    const text = a11yReportText(f.name, ui(ctx).s.report!);
    return [{ bytes: new TextEncoder().encode(text), name: `${f.name.replace(/\.pdf$/i, "")}-accessibility.txt`, warnings: [] }];
  },
};
