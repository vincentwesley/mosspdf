// The visible plan of a workflow: one line per step with its state, so progress and results are readable.
import type { StepEvent, StepState } from "../core/workflows";
import { h } from "./dom";

const WORD: Record<StepState, string> = { pending: "Waiting", running: "Working", done: "Done", stopped: "Stopped" };

export function stepList(labels: string[]): { el: HTMLElement; on: StepEvent; reset(): void } {
  const rows = labels.map((label) => {
    const state = h("span", { class: "steps__state", text: WORD.pending });
    const detail = h("span", { class: "steps__detail" });
    const li = h("li", { class: "steps__row", attrs: { "data-testid": "wf-step", "data-state": "pending" } }, h("span", { class: "steps__label", text: label }), state, detail);
    return { li, state, detail };
  });
  const el = h("ol", { class: "steps__list", attrs: { "aria-label": "Steps", "data-testid": "wf-steps" } }, ...rows.map((r) => r.li));
  const set: StepEvent = (i, s, d) => {
    const r = rows[i];
    r.li.dataset.state = s;
    r.state.textContent = WORD[s];
    r.detail.textContent = d ?? "";
  };
  return { el, on: set, reset: () => rows.forEach((_, i) => set(i, "pending")) };
}
