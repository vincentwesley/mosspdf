import { defineConfig, devices } from "@playwright/test";

// BASE_URL set => test that deployment and skip the local server. Port avoids 4397 (unknown process on the owner's machine).
const PORT = 4811;
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
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
        command: `npm run build && npx --yes wrangler@4.165.0 dev --ip 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          WRANGLER_SEND_METRICS: "false",
          XDG_CONFIG_HOME: ".wrangler/xdg",
          WRANGLER_LOG_PATH: ".wrangler/logs",
        },
      },
});
