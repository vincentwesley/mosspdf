// Runs the Playwright CLI with project-local browsers (PLAYWRIGHT_BROWSERS_PATH=0 = node_modules/playwright-core/.local-browsers).
// `--prod` as first arg points BASE_URL at production (the config then skips the local web server).
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout, clearTimeout } from "node:timers";

const args = process.argv.slice(2);
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" };
if (args[0] === "--prod") {
  args.shift();
  env.BASE_URL ||= "https://mosspdf.pages.dev";
}
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env });
// Kill the whole tree (wrangler, workerd, browsers) on exit, Ctrl-C, or the watchdog: a killed run must not leave WebKitWebProcess/workerd behind.
const killTree = () => {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
};
// Hard cap: 50 min locally (playwright.config globalTimeout is 40), override with PW_WATCHDOG_MIN. Not in CI (job timeouts).
const cap = process.env.CI ? 0 : Number(process.env.PW_WATCHDOG_MIN ?? 50);
const dog = cap ? setTimeout(() => { console.error(`pw.mjs: watchdog fired after ${cap} min, killing the process tree`); killTree(); process.exit(124); }, cap * 60_000) : null;
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => { killTree(); process.exit(130); });
process.on("exit", killTree);
child.on("exit", (code) => { if (dog) clearTimeout(dog); process.exit(code ?? 1); });
