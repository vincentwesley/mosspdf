// Workflows: a fixed chain of existing ops run in order on one PDF. Pure (no DOM), so Node tests can drive it.
import { PdfError, type InFile, type OpResult } from "../ops/types";

export type StepState = "pending" | "running" | "done" | "stopped";
export interface Step {
  label: string;
  /** Gets the file so far, returns the next one and a plain-language line about what happened. */
  run(cur: InFile): Promise<{ file: InFile | OpResult; detail: string }>;
}
export type StepEvent = (i: number, state: StepState, detail?: string) => void;

/** Runs the steps in order. Checks `signal` between steps (the ops themselves also stop on it). Reports every step through `on`. */
export async function runChain(steps: Step[], start: InFile, on: StepEvent, signal?: AbortSignal): Promise<InFile> {
  let cur = start;
  for (const [i, s] of steps.entries()) {
    if (signal?.aborted) { on(i, "stopped", "Cancelled before this step."); throw new PdfError("cancelled", "Cancelled."); }
    on(i, "running");
    try {
      const r = await s.run(cur);
      cur = { name: r.file.name, bytes: r.file.bytes };
      on(i, "done", r.detail);
    } catch (e) {
      on(i, "stopped", e instanceof PdfError && e.code === "cancelled" ? "Cancelled." : "Could not finish this step.");
      throw e;
    }
  }
  return cur;
}

/** "report.pdf" + "-email" -> "report-email.pdf". */
export const withSuffix = (name: string, suffix: string) => `${name.replace(/\.pdf$/i, "")}${suffix}.pdf`;
