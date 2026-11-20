import { describe, expect, it } from "vitest";
import { runChain, withSuffix, type StepState } from "../../src/core/workflows";
import { PdfError } from "../../src/ops/types";

const bytes = (n: number) => new Uint8Array(n);
const step = (label: string, size: number) => ({ label, run: async (cur: { name: string; bytes: Uint8Array }) => ({ file: { name: cur.name, bytes: bytes(size) }, detail: `${label} done` }) });

describe("runChain", () => {
  it("runs steps in order, feeding each result to the next, and reports each step", async () => {
    const seen: string[] = [];
    const out = await runChain([step("a", 30), step("b", 10)], { name: "x.pdf", bytes: bytes(100) }, (i, s, d) => seen.push(`${i}:${s}:${d ?? ""}`));
    expect(out.bytes.length).toBe(10);
    expect(seen).toEqual(["0:running:", "0:done:a done", "1:running:", "1:done:b done"]);
  });
  it("stops between steps when cancelled and marks the next step stopped", async () => {
    const ac = new AbortController();
    const states: StepState[] = [];
    const first = { label: "a", run: async (c: { name: string; bytes: Uint8Array }) => { ac.abort(); return { file: c, detail: "" }; } };
    await expect(runChain([first, step("b", 1)], { name: "x.pdf", bytes: bytes(5) }, (i, s) => { if (i === 1) states.push(s); }, ac.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(states).toEqual(["stopped"]);
  });
  it("marks the failing step stopped and rethrows", async () => {
    const bad = { label: "bad", run: async () => { throw new PdfError("corrupt", "broken"); } };
    const seen: string[] = [];
    await expect(runChain([bad], { name: "x.pdf", bytes: bytes(1) }, (_i, s) => seen.push(s))).rejects.toThrow("broken");
    expect(seen).toEqual(["running", "stopped"]);
  });
  it("withSuffix swaps the extension position", () => {
    expect(withSuffix("report.PDF", "-email")).toBe("report-email.pdf");
    expect(withSuffix("a.b.pdf", "-safe")).toBe("a.b-safe.pdf");
  });
});
