import { defineConfig, devices } from "@playwright/test";

// BASE_URL set => test that deployment and skip the local server. Port avoids 4397 (unknown process on the owner's machine).
const PORT = Number(process.env.PH_PORT ?? 4811); // PH_PORT lets parallel worktrees run side by side
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // One retry everywhere: wrangler dev occasionally truncates a large engine asset under 3 parallel browsers (ERR_INCOMPLETE_CHUNKED_ENCODING); a retry shows up as "flaky", never silently green.
  retries: 1,
  expect: { timeout: 10_000 }, // qpdf/pdf.js work in a loaded run outlasts the 5 s default
  forbidOnly: !!process.env.CI,
  timeout: 60_000, // default 30 s is too tight for WASM work under load; a hung test still ends in a minute
  // Never hang silently: local runs end after 40 min whatever happens (pw.mjs adds its own kill-the-tree watchdog). CI has job timeouts.
  globalTimeout: process.env.CI ? undefined : 40 * 60_000,
  workers: process.env.CI ? 2 : process.platform === "win32" ? 2 : 3, // WASM + pdf.js in six parallel browsers exhausts a 16 GB dev machine (Firefox content process crashes)
  use: {
    baseURL: BASE_URL,
    headless: true,
    serviceWorkers: "block", // the spike's measurement strategy: route() is only reliable without a service worker
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
  // Production-faithful: built dist served by wrangler dev, which applies dist/_headers. Wrangler state stays in the repo (.wrangler/ is ignored).
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run build && npx --yes wrangler@4.165.0 dev -c scripts/wrangler.dev.jsonc --ip 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000, // build + wrangler start; fail loudly instead of waiting forever
        env: {
          WRANGLER_SEND_METRICS: "false",
          XDG_CONFIG_HOME: ".wrangler/xdg",
          WRANGLER_LOG_PATH: ".wrangler/logs",
        },
      },
});
