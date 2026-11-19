import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], globalSetup: ["tests/globalSetup.ts"], testTimeout: 60_000 },
});
