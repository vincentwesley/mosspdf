// "My workflows": build a chain of 2 to 5 option-only tools, keep it on this device (localStorage, see wf-store.ts) and run it on PDFs.
// Each step reuses its tool's own options panel and `run`, driven through a small stand-in Ctx. Settings are saved as the flat list of
// the panel's control values (never passwords or files), so a tool whose panel changes just falls back to its defaults.
import { toIn, type LoadedFile } from "../core/store";
import { withSuffix } from "../core/workflows";
import { PdfError, type Inspection, type OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { saveResult } from "../ui/download";
import { selectField, textField } from "../ui/fields";
import { stepList } from "../ui/steplist";
import { toast } from "../ui/toast";
import { CATALOG, TOOLS } from "./index";
import type { Ctx, ToolDef } from "./types";
import { CHAIN, MAX_FILE, MAX_FLOWS, MAX_NAME, MAX_STEPS, MAX_VAL, MIN_STEPS, loadFlows, newId, parseExport, parseFlow, runFlow, saveFlows, toExport, type Flow, type Val } from "./wf-store";

/** Every tool by id (filled by all.ts, then by saved workflows). The router reads this. */
export const registry = new Map<string, ToolDef>();
let flows: Flow[] = [];

// ---- control values ----
type Ctl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const ctls = (root: HTMLElement) => [...root.querySelectorAll<Ctl>("input,select,textarea")].filter((c) => !(c instanceof HTMLInputElement && /^(password|file|button|submit|reset|image)$/.test(c.type)));
const isTick = (c: Ctl): c is HTMLInputElement => c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio");
const snap = (root: HTMLElement): Val[] => ctls(root).map((c) => (isTick(c) ? c.checked : c.value.slice(0, MAX_VAL)));
function restore(root: HTMLElement, vals: Val[]): void {
  const cs = ctls(root);
  if (cs.length !== vals.length) return; // the tool's panel changed since: keep its defaults
  cs.forEach((c, i) => {
    const v = vals[i];
    if (isTick(c)) {
      if (typeof v !== "boolean" || c.checked === v || (c.type === "radio" && !v)) return;
      c.checked = v;
      c.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (typeof v === "string" && c.value !== v) {
      c.value = v;
      c.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

/** A stand-in Ctx for one step: `cur` says which file the step sees (none while editing). */
function makeCtx(tool: ToolDef, host: Ctx, cur: () => LoadedFile | undefined, refresh: () => void): Ctx {
  let loc: unknown;
  return {
    tool, get files() { const f = cur(); return f ? [f] : []; }, get file() { return cur(); },
    items: [], dirty: false, pagesOpen: false, setPagesOpen() {}, syncGrid() {},
    get producerCredit() { return host.producerCredit; }, refresh,
    local: <T,>(init: () => T) => (loc ??= init()) as T,
    get o() { return host.o; }, note: (t) => host.note(t), call: (op, p) => host.call(op, p), input: toIn,
  };
}

/** Only used to ask a tool "are these settings fine for some file?" while editing. */
const FAKE = { id: -1, name: "example.pdf", size: 0, bytes: new Uint8Array(0), kind: "pdf", status: "ready", info: { pageCount: 9999, pageSizes: [] } } as unknown as LoadedFile;
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workflow";
const flowFile = (f: Flow, warnings: OpResult["warnings"] = []): OpResult => ({ bytes: new TextEncoder().encode(toExport(f)), name: `${slug(f.name)}.mosspdf-workflow.json`, warnings });

// ---- saved workflows as tools ----
function flowDef(flow: Flow): ToolDef {
  const titles = flow.steps.map((s) => registry.get(s.tool)?.title ?? s.tool);
  const ui = (ctx: Ctx) => ctx.local(() => ({ steps: stepList(titles) }));
  return {
    id: `wf-u-${flow.id}`, title: flow.name, group: "Workflows", blurb: "Your saved workflow.",
    lede: `Runs ${titles.join(", then ")} on each PDF you add.`,
    how: "Add your PDFs, then run the workflow. Each file gets its own result.",
    accepts: "pdf", batch: true, zipSuffix: "workflow",
    options: (ctx) => h("div", { class: "wf" }, ui(ctx).steps.el),
    primaryLabel: () => "Run workflow",
    async run(ctx) {
      const f0 = ctx.file!;
      let cur: LoadedFile = f0;
      const warns: OpResult["warnings"] = [];
      const steps = flow.steps.map((s) => {
        const tool = registry.get(s.tool);
        if (!tool?.options || !tool.run) throw new PdfError("unsupported", "A step of this workflow is not available. Open My workflows and rebuild it.", f0.name);
        const sc = makeCtx(tool, ctx, () => cur, () => undefined);
        restore(tool.options(sc), s.vals);
        return { tool, sc };
      });
      const u = ui(ctx);
      u.steps.reset();
      const out = await runFlow(flow, async (_s, inp, i) => {
        const { tool, sc } = steps[i];
        cur = i === 0 ? f0 : { id: -1, name: inp.name, size: inp.bytes.length, bytes: inp.bytes as Uint8Array, kind: "pdf", status: "ready", info: await ctx.call<Inspection>("inspect", { file: { name: inp.name, bytes: inp.bytes } }) };
        if (tool.ready && !tool.ready(sc)) throw new PdfError("unsupported", `The ${tool.title} step has settings that do not fit this file. Open My workflows and check them.`, f0.name);
        const r = await tool.run!(sc);
        if (r.length !== 1) throw new PdfError("unsupported", `The ${tool.title} step did not give one PDF back.`, f0.name);
        warns.push(...r[0].warnings);
        return { file: r[0], detail: r[0].warnings[0]?.message ?? "Done." };
      }, toIn(f0), u.steps.on, ctx.o.signal);
      return [{ bytes: out.bytes, name: withSuffix(f0.name, "-workflow"), warnings: warns }];
    },
  };
}

function register(f: Flow): void {
  const id = `wf-u-${f.id}`;
  registry.set(id, flowDef(f));
  const meta = TOOLS.find((t) => t.id === id);
  if (meta) { meta.title = f.name; return; }
  const row = { id, title: f.name, blurb: "Your saved workflow.", group: "Workflows" as const };
  TOOLS.push(row);
  CATALOG.find((g) => g.name === "Workflows")?.tools.push(row);
}
function unregister(id: string): void {
  const full = `wf-u-${id}`;
  registry.delete(full);
  const drop = <T extends { id: string }>(a: T[]) => { const i = a.findIndex((t) => t.id === full); if (i >= 0) a.splice(i, 1); };
  drop(TOOLS);
  CATALOG.forEach((g) => drop(g.tools));
}

/** Loads the saved workflows into the tool list and the router. Returns their route ids. Called once, from all.ts. */
export function registerSaved(): string[] {
  flows = loadFlows();
  flows.forEach(register);
  return flows.map((f) => `wf-u-${f.id}`);
}

// ---- the builder ----
function build(ctx: Ctx) {
  interface Slot { tool: ToolDef; sc: Ctx; root: HTMLElement }
  let slots: Slot[] = [];
  let sel = -1;
  let probing = false;
  let live = false; // host.refresh asks for `problem`, which needs this builder to exist
  let editId = "";
  const msg = h("p", { class: "field__msg", attrs: { role: "status", "data-testid": "wfc-msg" } });
  const name = textField({ id: "wfc-name", label: "Name", testid: "wfc-name", placeholder: "Scan clean-up", onInput: () => ctx.refresh() });
  name.input.maxLength = MAX_NAME;
  const pick = selectField({ id: "wfc-add", label: "Add a step", testid: "wfc-add", options: CHAIN.map((id) => [id, registry.get(id)?.title ?? id]) });
  const list = h("ol", { class: "steps__list", attrs: { "aria-label": "Steps", "data-testid": "wfc-steps" } });
  const panel = h("div", { class: "wfc__panel", attrs: { "data-testid": "wfc-panel" } });
  const saved = h("ul", { class: "outs", attrs: { role: "list", "data-testid": "wfc-saved" } });

  const mk = (tool: ToolDef, vals?: Val[]): Slot => {
    const sc: Ctx = makeCtx(tool, ctx, () => (probing ? FAKE : undefined), () => { tool.sync?.(sc); if (live) ctx.refresh(); });
    const root = tool.options!(sc);
    if (vals) restore(root, vals);
    tool.sync?.(sc);
    return { tool, sc, root };
  };
  const btn = (text: string, label: string, run: () => void, testid?: string) =>
    h("button", { class: "hs-btn hs-btn--secondary hs-btn--sm", type: "button", text, attrs: { "aria-label": label, ...(testid ? { "data-testid": testid } : {}) }, on: { click: run } });

  function paint(): void {
    list.replaceChildren(...slots.map((s, i) => h("li", { class: "wfc__row" },
      h("button", { class: `hs-btn hs-btn--sm wfc__step${i === sel ? "" : " hs-btn--secondary"}`, type: "button", text: `${i + 1}. ${s.tool.title}`, attrs: { "aria-pressed": String(i === sel), "data-testid": `wfc-step-${i}` }, on: { click: () => { sel = i; paint(); } } }),
      h("span", { class: "wfc__ctl" },
      ...(i > 0 ? [btn("Up", `Move step ${i + 1} up`, () => { [slots[i - 1], slots[i]] = [slots[i], slots[i - 1]]; sel = i - 1; paint(); })] : []),
      ...(i < slots.length - 1 ? [btn("Down", `Move step ${i + 1} down`, () => { [slots[i + 1], slots[i]] = [slots[i], slots[i + 1]]; sel = i + 1; paint(); })] : []),
      btn("Remove", `Remove step ${i + 1}`, () => { slots.splice(i, 1); if (i < sel) sel--; else sel = Math.min(sel, slots.length - 1); paint(); }, `wfc-remove-${i}`)))));
    panel.replaceChildren(...(sel >= 0 ? [h("h3", { text: `Settings for ${slots[sel].tool.title}` }), slots[sel].root] : [h("p", { class: "field__hint", text: "Add a step, then pick it to set it up." })]));
    if (live) ctx.refresh();
  }
  function load(f: Flow, id: string): void {
    editId = id;
    name.input.value = f.name;
    slots = f.steps.flatMap((s) => { const t = registry.get(s.tool); return t ? [mk(t, s.vals)] : []; });
    sel = slots.length ? 0 : -1;
    msg.textContent = "";
    paint();
  }
  function paintSaved(): void {
    saved.replaceChildren(...flows.map((f) => h("li", { class: "out", attrs: { "data-testid": "wfc-saved-row" } },
      h("span", { class: "out__name", text: f.name }),
      btn("Edit", `Edit ${f.name}`, () => load(f, f.id)),
      btn("Export", `Export ${f.name}`, () => void saveResult(flowFile(f))),
      btn("Delete", `Delete ${f.name}`, () => {
        const at = flows.findIndex((x) => x.id === f.id);
        flows = flows.filter((x) => x.id !== f.id);
        saveFlows(flows);
        unregister(f.id);
        if (editId === f.id) editId = "";
        paintSaved();
        ctx.refresh();
        toast(`Deleted ${f.name}.`, { label: "Undo", run: () => { if (flows.some((x) => x.id === f.id)) return; flows.splice(Math.min(at, flows.length), 0, f); saveFlows(flows); register(f); paintSaved(); ctx.refresh(); } });
      }))));
  }

  const add = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Add step", attrs: { "data-testid": "wfc-add-btn" }, on: { click: () => {
    msg.textContent = "";
    if (slots.length >= MAX_STEPS) { msg.textContent = `A workflow has at most ${MAX_STEPS} steps.`; return; }
    slots.push(mk(registry.get(pick.input.value)!));
    sel = slots.length - 1;
    paint();
  } } });
  const file = h("input", { class: "hs-input", id: "wfc-import", type: "file", attrs: { accept: ".json,application/json", "data-testid": "wfc-import" } });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    if (f.size > MAX_FILE) { msg.textContent = "That file is too big to be a MossPDF workflow."; return; }
    void f.text().then((t) => {
      const flow = parseExport(t);
      if (!flow) { msg.textContent = "That is not a MossPDF workflow file. Nothing was imported."; return; }
      load(flow, "");
      msg.textContent = `Loaded "${flow.name}". Check the steps, then save it.`;
    }, () => { msg.textContent = "That file could not be read."; });
  });

  const problem = (): string => {
    if (!name.input.value.trim()) return "Type a name for the workflow.";
    if (slots.length < MIN_STEPS) return "Add at least two steps.";
    if (!editId && flows.length >= MAX_FLOWS) return `You can keep up to ${MAX_FLOWS} workflows. Delete one first.`;
    probing = true;
    try {
      for (const [i, s] of slots.entries()) if (s.root.querySelector('[aria-invalid="true"]') || (s.tool.ready && !s.tool.ready(s.sc))) return `Check the settings of step ${i + 1}, ${s.tool.title}.`;
    } finally { probing = false; }
    return "";
  };

  function save(): OpResult[] {
    const f = parseFlow({ id: editId || newId(), name: name.input.value.trim(), steps: slots.map((s) => ({ tool: s.tool.id, vals: snap(s.root) })) });
    if (!f) throw new PdfError("unsupported", "This workflow could not be saved. Check the name and the settings, then try again.");
    const next = editId ? flows.map((x) => (x.id === editId ? f : x)) : [...flows, f];
    const ok = saveFlows(next);
    flows = next;
    editId = f.id;
    register(f);
    paintSaved();
    return [flowFile(f, ok ? [] : [{ code: "not-saved", message: "This browser would not keep the workflow (private mode or full storage). Download the file below to keep it, and import it next time." }])];
  }

  paintSaved();
  paint();
  live = true;
  const el = h("div", { class: "wf wfc" },
    h("p", { class: "field__hint" }, "Pick two to five steps. Each step has the settings of its tool. Passwords are never saved, so the password tools are not offered."),
    name.el,
    list,
    h("div", { class: "wfc__add" }, pick.el, add),
    panel, msg,
    h("h3", { text: "Saved on this device" }), saved,
    h("div", { class: "field" }, h("label", { text: "Import a workflow file", attrs: { for: "wfc-import" } }), file));
  return { el, problem, save };
}

const ui = (ctx: Ctx) => ctx.local(() => build(ctx));

export const wfCustom: ToolDef = {
  id: "wf-custom", title: "My workflows", heading: "Build a workflow", group: "Workflows",
  blurb: "Chain your own steps and reuse them.",
  lede: "Chain steps like Rotate, Page numbers and Compress, name the chain, and run it on any PDFs later. It is kept on this device only.",
  how: "Add your steps, set each one, name it, then save. Saved workflows are on the home page under Workflows.",
  accepts: "pdf", noFiles: true,
  options: (ctx) => ui(ctx).el,
  ready: (ctx) => !ui(ctx).problem(),
  whyDisabled: (ctx) => ui(ctx).problem(),
  primaryLabel: () => "Save workflow",
  summary: () => "Saved on this device. Find it under Workflows on the home page. The file below is a copy you can share.",
  run: async (ctx) => ui(ctx).save(),
};
