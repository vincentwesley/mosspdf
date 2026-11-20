import { isSafeLink } from "../core/links";
import { errorMessage } from "../core/store";
import type { OpResult } from "../ops/types";
import type { CleanResult, SafetyItem, SafetyKind, SafetyReport, Severity } from "../ops/types-m3";
import { h, plural } from "../ui/dom";
import { saveResult } from "../ui/download";
import { checkField, passwordField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

export const TITLE: Record<SafetyKind, string> = {
  javascript: "Script (JavaScript)", "open-action": "Runs when opened", "additional-actions": "Event triggers", launch: "Opens a program or file",
  "embedded-file": "Hidden attached file", "file-attachment": "File attachment", "submit-form": "Sends form data", "import-data": "Loads form data",
  uri: "Web link", "go-to-remote": "Link into another PDF", "go-to-embedded": "Link into an embedded PDF", "rich-media": "Video, audio, 3D or app", "media-action": "Plays media or an app", "hide-action": "Hides or shows parts of the page", xfa: "Dynamic form (XFA)",
  "object-streams": "Compressed internals", jbig2: "JBIG2 images",
};
const GROUP: [Severity, string][] = [
  ["high", "High: can run code, open files or send data"],
  ["medium", "Medium: acts on its own or points elsewhere"],
  ["info", "Notes: normal, listed for completeness"],
];
const SHOW = 60;

interface State { key: string; status: "idle" | "scanning" | "done" | "error"; report?: SafetyReport; error?: string; clean?: CleanResult; keepLinks: boolean; drawn: string }

const ui = (ctx: Ctx) => ctx.local(() => {
  const keep = checkField({ id: "keep-links", label: "Keep web links", testid: "keep-links", onChange: () => ctx.refresh() });
  const owner = passwordField({ id: "pw-owner", label: "Owner password", hint: "This file has restrictions, so a cleaned copy needs its owner password. Pagehold can only use a password you know.", autocomplete: "current-password", testid: "pw-input", msgTestId: "pw-msg", onInput: () => { owner.setError(null); ctx.refresh(); } });
  owner.el.hidden = true;
  const out = h("div", { class: "scan", attrs: { "data-testid": "scan-result" } });
  const box = h("div", { class: "scanbox" }, out, keep.el, owner.el);
  const s: State = { key: "", status: "idle", keepLinks: false, drawn: "" };
  return { s, keep, owner, out, box };
});

const where = (i: SafetyItem) => (i.where === "document" ? "Whole document" : `Page ${i.where}`);
const itemEl = (i: SafetyItem) => h("li", { class: "scan__item", attrs: { "data-testid": "scan-item", "data-kind": i.kind } },
  h("p", { class: "scan__what" }, h("strong", { text: TITLE[i.kind] }), h("span", { class: "scan__where", text: ` · ${where(i)}` })),
  i.detail && h("p", { class: "scan__detail" }, h("code", { text: i.detail })),
  h("p", { class: "scan__why", text: i.explanation }));

function groups(items: SafetyItem[]): HTMLElement[] {
  return GROUP.flatMap(([sev, title]) => {
    const list = items.filter((i) => i.severity === sev);
    if (!list.length) return [];
    return [h("section", { class: `scan__group scan__group--${sev}`, attrs: { "data-testid": `group-${sev}`, "aria-label": title } },
      h("h3", { text: `${title} (${list.length})` }),
      h("ul", { class: "scan__list", attrs: { role: "list" } }, ...list.slice(0, SHOW).map(itemEl)),
      list.length > SHOW && h("p", { class: "field__hint", text: `and ${list.length - SHOW} more of the same kind.` }))];
  });
}

const NOTHING = () => h("p", { class: "hs-banner hs-banner--ok", text: "Nothing risky found.", attrs: { role: "status", "data-testid": "nothing-risky" } });

function draw(ctx: Ctx) {
  const u = ui(ctx);
  const { s } = u;
  const sig = `${s.key}|${s.status}|${s.clean ? "c" : ""}`;
  if (sig === s.drawn) return;
  s.drawn = sig;
  const kids: (HTMLElement | false)[] = [];
  if (s.status === "scanning") kids.push(h("p", { class: "hs-banner hs-banner--info", text: "Scanning…", attrs: { role: "status", "data-testid": "scanning" } }));
  if (s.status === "error") kids.push(h("p", { class: "hs-banner hs-banner--danger", text: s.error ?? "", attrs: { role: "alert" } }));
  if (s.report) {
    const r = s.report;
    kids.push(
      r.repaired && h("p", { class: "hs-banner hs-banner--warn", text: "This file was damaged and had to be repaired before it could be scanned." }),
      r.risky ? h("p", { class: "hs-banner hs-banner--warn", text: `Found ${plural(r.items.filter((i) => i.severity !== "info").length, "item")} worth a look.`, attrs: { role: "status", "data-testid": "risky-found" } }) : NOTHING(),
      ...groups(r.items));
  }
  if (s.clean) {
    const left = s.clean.remaining.filter((i) => i.severity !== "info" && !(s.keepLinks && i.kind === "uri" && isSafeLink(i.detail)));
    const links = s.clean.remaining.filter((i) => i.kind === "uri" && isSafeLink(i.detail)).length;
    kids.push(h("section", { class: "scan__after", attrs: { "data-testid": "rescan", "aria-label": "Re-scan of the cleaned copy" } },
      h("h3", { text: "Re-scan of the cleaned copy" }),
      left.length ? h("p", { class: "hs-banner hs-banner--warn", text: `Still contains ${plural(left.length, "flagged item")}. Do not treat it as cleaned.`, attrs: { role: "status" } }) : NOTHING(),
      s.keepLinks && links ? h("p", { class: "field__hint", text: `${plural(links, "web link")} kept, as you asked.` }) : false,
      ...groups(left)));
  }
  kids.push(h("p", { class: "field__hint", text: "This check looks for features that can run code or reach the internet. It is not an antivirus and can't prove a file is safe.", attrs: { "data-testid": "scan-disclaimer" } }));
  u.out.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
}

export const safetyScan: ToolDef = {
  id: "safety-scan", title: "Safety scan", heading: "Safety scan", group: "Protect",
  blurb: "Check a PDF for risky parts.",
  lede: "Look for scripts, links and hidden parts, then save a cleaned copy.",
  accepts: "pdf",
  options(ctx) { return ui(ctx).box; },
  sync(ctx) {
    const u = ui(ctx);
    const { s } = u;
    const f = ctx.file;
    u.box.hidden = !f;
    const key = f ? `${f.id}:${f.password ?? ""}` : "";
    if (key !== s.key) {
      Object.assign(s, { key, status: f ? "scanning" : "idle", report: undefined, error: undefined, clean: undefined, drawn: "" });
      u.owner.el.hidden = true;
      u.owner.input.value = "";
      if (f) {
        void ctx.call<SafetyReport>("safetyScan", { file: ctx.input(f) })
          .then((r) => { if (s.key === key) Object.assign(s, { status: "done", report: r }); })
          .catch((e) => { if (s.key === key) Object.assign(s, { status: "error", error: errorMessage(e) }); })
          .finally(() => ctx.refresh());
      }
    }
    u.keep.el.hidden = !s.report?.risky;
    draw(ctx);
  },
  ready: (ctx) => !!ui(ctx).s.report?.risky,
  primaryLabel: () => "Download cleaned copy",
  async run(ctx) {
    const u = ui(ctx);
    const file = ctx.input(ctx.file!);
    if (u.owner.input.value) file.password = u.owner.input.value;
    const keepLinks = u.keep.input.checked;
    const r = await ctx.call<CleanResult>("cleanCopy", { file, c: { keepLinks }, o: { producerCredit: ctx.producerCredit } });
    Object.assign(u.s, { clean: r, keepLinks, drawn: "" });
    u.owner.el.hidden = true;
    void saveResult(r as OpResult);
    return [r];
  },
  onError(ctx, e) {
    if (e.code !== "wrong-password" && e.code !== "encrypted") return false;
    const { owner } = ui(ctx);
    owner.el.hidden = false;
    owner.setError(e.message);
    queueMicrotask(() => owner.input.focus());
    return true;
  },
};
