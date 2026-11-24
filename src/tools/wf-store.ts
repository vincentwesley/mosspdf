// Saved custom workflows: the schema, storage and chain runner. Pure (no DOM), so Node tests can drive it.
// A workflow is 2 to 5 steps; each step names a tool and keeps that tool's option controls as a flat list of values.
import type { InFile, OpResult } from "../ops/types";
import { runChain, type Step, type StepEvent } from "../core/workflows";

/** Tools a step may use: one PDF in, one PDF out, options only. No passwords are ever stored, so protect and unprotect are not here. */
export const CHAIN = ["repair", "rotate", "crop", "flatten", "watermark", "page-numbers", "add-pages", "nup", "compress"] as const;
export const KEY = "mosspdf.workflows";
export const MAX_FLOWS = 20, MAX_NAME = 60, MIN_STEPS = 2, MAX_STEPS = 5, MAX_VALS = 60, MAX_VAL = 200, MAX_FILE = 64 * 1024;

export type Val = string | boolean;
export interface FlowStep { tool: string; vals: Val[] }
export interface Flow { id: string; name: string; steps: FlowStep[] }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const exactly = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);

function parseStep(x: unknown): FlowStep | null {
  if (!isObj(x) || !exactly(x, ["tool", "vals"])) return null;
  const { tool, vals } = x;
  if (typeof tool !== "string" || !(CHAIN as readonly string[]).includes(tool)) return null;
  if (!Array.isArray(vals) || vals.length > MAX_VALS) return null;
  if (!vals.every((v) => typeof v === "boolean" || (typeof v === "string" && v.length <= MAX_VAL))) return null;
  return { tool, vals: vals as Val[] };
}

const cleanName = (n: unknown) => (typeof n === "string" && n.trim().length > 0 && n.trim().length <= MAX_NAME && ![...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ? n.trim() : null);

/** A stored workflow: `{id, name, steps}`, nothing else. Null when anything is off. */
export function parseFlow(x: unknown): Flow | null {
  if (!isObj(x) || !exactly(x, ["id", "name", "steps"])) return null;
  const name = cleanName(x.name);
  if (!name || typeof x.id !== "string" || !/^[a-z0-9]{4,12}$/.test(x.id)) return null;
  if (!Array.isArray(x.steps) || x.steps.length < MIN_STEPS || x.steps.length > MAX_STEPS) return null;
  const steps = x.steps.map(parseStep);
  return steps.every((s): s is FlowStep => !!s) ? { id: x.id, name, steps } : null;
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** The shareable file: `{format, version, name, steps}`. */
export const toExport = (f: Flow) => JSON.stringify({ format: "mosspdf-workflow", version: 1, name: f.name, steps: f.steps });

/** Reads a shared file as text. Strict: size cap, exact keys, known tools only. Never evaluates anything. */
export function parseExport(text: string): Flow | null {
  if (text.length > MAX_FILE) return null;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return null; }
  if (!isObj(x) || !exactly(x, ["format", "version", "name", "steps"]) || x.format !== "mosspdf-workflow" || x.version !== 1) return null;
  return parseFlow({ id: newId(), name: x.name, steps: x.steps });
}

/** Stored workflows; anything invalid or beyond the cap is dropped. */
export function loadFlows(): Flow[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v.slice(0, MAX_FLOWS).map(parseFlow).filter((f): f is Flow => !!f && !seen.has(f.id) && !!seen.add(f.id));
  } catch { return []; }
}

/** False when storage is blocked or full. */
export function saveFlows(list: Flow[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_FLOWS))); return true; } catch { return false; }
}

/** Runs a workflow's steps in order on one file. `exec` does one step (and gets its index). */
export type Exec = (step: FlowStep, cur: InFile, i: number) => Promise<{ file: InFile | OpResult; detail: string }>;
export const flowSteps = (f: Flow, exec: Exec): Step[] => f.steps.map((s, i) => ({ label: s.tool, run: (cur) => exec(s, cur, i) }));
export const runFlow = (f: Flow, exec: Exec, start: InFile, on: StepEvent, signal?: AbortSignal): Promise<InFile> => runChain(flowSteps(f, exec), start, on, signal);
