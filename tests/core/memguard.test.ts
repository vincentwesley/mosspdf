import { describe, expect, it } from "vitest";
import { memoryWarning } from "../../src/core/memguard";

const MB = 1024 * 1024;
describe("memoryWarning", () => {
  it("is silent for small files, whatever the device", () => expect(memoryWarning("compress", 20 * MB, 0.25)).toBe(""));
  it("warns for a big file on a low-memory device", () => expect(memoryWarning("repair", 200 * MB, 2)).toMatch(/large file/));
  it("is silent for a big file on a roomy device", () => expect(memoryWarning("organize", 100 * MB, 8)).toBe(""));
  it("compress needs more than organize", () => expect(memoryWarning("compress", 120 * MB, 2)).not.toBe(""));
  it("unknown memory uses a 1.5 GB budget", () => { expect(memoryWarning("organize", 600 * MB)).not.toBe(""); expect(memoryWarning("organize", 100 * MB)).toBe(""); });
});
