import { describe, expect, it } from "vitest";
import { CHAIN, MAX_FILE, parseExport, parseFlow, runFlow, toExport, type Flow } from "../../src/tools/wf-store";
import { PdfError } from "../../src/ops/types";

const ok = { id: "abcd1234", name: "Scan clean-up", steps: [{ tool: "rotate", vals: ["right", true] }, { tool: "compress", vals: [] }] };

describe("parseFlow", () => {
  it("accepts a good workflow", () => expect(parseFlow(ok)).toEqual(ok));
  it("rejects unknown tool ids, including password tools", () => {
    for (const tool of ["protect", "unprotect", "eval", "__proto__"]) expect(parseFlow({ ...ok, steps: [ok.steps[0], { tool, vals: [] }] })).toBeNull();
    expect(CHAIN).not.toContain("protect");
  });
  it("rejects bad shape, size and values", () => {
    expect(parseFlow({ ...ok, extra: 1 })).toBeNull();
    expect(parseFlow({ ...ok, name: "x".repeat(61) })).toBeNull();
    expect(parseFlow({ ...ok, name: "  " })).toBeNull();
    expect(parseFlow({ ...ok, id: "../x" })).toBeNull();
    expect(parseFlow({ ...ok, steps: [ok.steps[0]] })).toBeNull();
    expect(parseFlow({ ...ok, steps: Array(6).fill(ok.steps[0]) })).toBeNull();
    expect(parseFlow({ ...ok, steps: [ok.steps[0], { tool: "nup", vals: ["x".repeat(201)] }] })).toBeNull();
    expect(parseFlow({ ...ok, steps: [ok.steps[0], { tool: "nup", vals: Array(61).fill("a") }] })).toBeNull();
    expect(parseFlow({ ...ok, steps: [ok.steps[0], { tool: "nup", vals: [1] }] })).toBeNull();
    expect(parseFlow(null)).toBeNull();
  });
});

describe("export and import", () => {
  it("round-trips with a fresh id", () => {
    const f = parseExport(toExport(ok as Flow))!;
    expect(f.name).toBe(ok.name);
    expect(f.steps).toEqual(ok.steps);
    expect(f.id).toMatch(/^[a-z0-9]{8}$/);
  });
  it("rejects junk, wrong format and oversized files", () => {
    expect(parseExport("not json")).toBeNull();
    expect(parseExport(JSON.stringify({ format: "other", version: 1, name: "a", steps: ok.steps }))).toBeNull();
    expect(parseExport(JSON.stringify({ format: "mosspdf-workflow", version: 1, name: "a", steps: [{ tool: "x", vals: [] }, ok.steps[0]] }))).toBeNull();
    expect(parseExport(" ".repeat(MAX_FILE + 1))).toBeNull();
  });
});

describe("runFlow", () => {
  const b = (n: number) => new Uint8Array(n);
  it("runs steps in order with their index, feeding each result on", async () => {
    const seen: string[] = [];
    const out = await runFlow(ok as Flow, async (s, cur, i) => { seen.push(`${i}:${s.tool}:${cur.bytes.length}`); return { file: { name: "o.pdf", bytes: b(cur.bytes.length + 1) }, detail: "" }; }, { name: "i.pdf", bytes: b(5) }, () => undefined);
    expect(seen).toEqual(["0:rotate:5", "1:compress:6"]);
    expect(out.bytes.length).toBe(7);
  });
  it("stops at a failing step", async () => {
    const states: string[] = [];
    await expect(runFlow(ok as Flow, async (_s, _c, i) => { if (i === 1) throw new PdfError("corrupt", "bad"); return { file: { name: "o.pdf", bytes: b(1) }, detail: "" }; }, { name: "i.pdf", bytes: b(1) }, (i, s) => states.push(`${i}${s}`))).rejects.toThrow("bad");
    expect(states.at(-1)).toBe("1stopped");
  });
});
