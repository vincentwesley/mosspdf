import { expect, test } from "vitest";
import { unfitReason } from "../src/core/trayfit";

const pdf = (id: number) => ({ id, kind: "pdf" as const });
const img = (id: number) => ({ id, kind: "image" as const });

test("tray: unfit reasons by kind and single-PDF rule", () => {
  const all = [pdf(1), img(2), pdf(3)];
  expect(unfitReason(all[0], all)).toBe("");
  expect(unfitReason(all[0], all, { kind: "image" })).toMatch(/pictures/);
  expect(unfitReason(all[1], all, { kind: "pdf" })).toMatch(/PDFs/);
  expect(unfitReason(all[0], all, { kind: "pdf", single: true })).toMatch(/newest/);
  expect(unfitReason(all[2], all, { kind: "pdf", single: true })).toBe("");
  expect(unfitReason(all[0], all, { kind: "pdf" })).toBe("");
});
